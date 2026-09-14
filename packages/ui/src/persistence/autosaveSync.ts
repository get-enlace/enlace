import type { RunStepStatus } from '../types.js';
import { useWorkflowStore } from '../store/workflowStore.js';
import { formatUnknownOperationsError, parseCollection, serializeCollection } from '../utils/workflowDocument.js';
import { clearRunResult, loadAutosave, loadRunResult, saveAutosave, saveRunResult } from './autosave.js';

const AUTOSAVE_DEBOUNCE_MS = 500;

/**
 * Subscribes to every field that feeds a `.enlace` export (see
 * `utils/workflowDocument.ts`'s `serializeCollection`) and debounces a
 * write to IndexedDB on each change — the "don't lose my work" layer from
 * ROADMAP.md's "Client-side IndexedDB for local persistence" entry.
 * Always serializes with `includeSecrets: false`: credential *values*
 * never touch disk (same rule a stripped `.enlace` export already
 * follows) — only credential stubs persist, so a restored session still
 * needs its secrets re-entered, same tradeoff a stripped import already
 * has. Run results, `armedBreakpoints`, and uploaded file blobs are
 * deliberately not part of this — same scope `serializeCollection` itself
 * already draws for an export.
 *
 * Call once at app boot (`App.tsx`); the returned cleanup unsubscribes and
 * cancels any pending debounced write — safe to call from a `useEffect`
 * cleanup under React StrictMode's mount/unmount/mount dance.
 */
export function startAutosave(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;
    const state = useWorkflowStore.getState();
    const collection = serializeCollection({
      name: state.workflowName,
      includeSecrets: false,
      nodes: state.nodes,
      connections: state.connections,
      nodePositions: state.nodePositions,
      groups: state.groups,
      presetsCollapsed: state.presetsCollapsed,
      credentials: state.credentials,
      specInfo: state.specInfo,
    });
    void saveAutosave(collection);
  };

  const schedule = () => {
    if (timer != null) clearTimeout(timer);
    timer = setTimeout(flush, AUTOSAVE_DEBOUNCE_MS);
  };

  const unsubscribe = useWorkflowStore.subscribe((state, prevState) => {
    if (
      state.nodes !== prevState.nodes ||
      state.connections !== prevState.connections ||
      state.nodePositions !== prevState.nodePositions ||
      state.groups !== prevState.groups ||
      state.presetsCollapsed !== prevState.presetsCollapsed ||
      state.credentials !== prevState.credentials ||
      state.workflowName !== prevState.workflowName
    ) {
      schedule();
    }
  });

  return () => {
    unsubscribe();
    if (timer != null) clearTimeout(timer);
  };
}

/**
 * Applies the last autosaved canvas, if any — same `parseCollection`
 * validation a `.enlace` import runs, so a stale/corrupt record (an
 * autosave written by an older app version, say) is discarded rather than
 * thrown as an error; a genuinely empty autosave (nothing ever put on the
 * canvas) is a no-op too, so a first-ever visit doesn't disturb the
 * default `Untitled` empty-canvas state at all.
 *
 * Call once at boot, after `operations` has loaded (see `App.tsx`) so the
 * unknown-operation-id check has a spec to check against — restoring
 * before that would silently skip that check rather than get it wrong,
 * but the warning is only meaningful once there's a spec loaded.
 *
 * No confirmation prompt: this only ever runs against the still-empty
 * boot-time canvas (nothing the user did in this tab could be lost), the
 * same reasoning `WorkflowFileMenu`'s own import flow uses to skip its
 * "replace current workflow?" confirm when the canvas is already empty.
 */
export async function restoreAutosave(): Promise<void> {
  const raw = await loadAutosave();
  if (raw == null) return;

  const { operations, replaceWorkflow, setCredentialReview } = useWorkflowStore.getState();
  const result = parseCollection(raw, { operations });
  if (!result.ok) {
    console.warn('enlace: discarding an unreadable autosaved workflow.', result.error);
    return;
  }

  const { collection, warnings } = result;
  if (collection.workflows[0].nodes.length === 0 && collection.credentials.length === 0) return;

  replaceWorkflow(collection);
  useWorkflowStore.setState({ error: formatUnknownOperationsError(warnings) });
  const needsValueIds = warnings.credentialsNeedingSecrets.map((c) => c.id);
  setCredentialReview(
    needsValueIds.length > 0 || warnings.unexpectedSecretsDiscarded
      ? { needsValueIds, secretsDiscarded: warnings.unexpectedSecretsDiscarded }
      : null
  );
}

/**
 * Subscribes to two discrete, explicit moments — not a debounced stream —
 * for what "Rerun failed" (`runSlice.ts`'s `buildFromLastRunSeed`) needs
 * to keep working across a refresh:
 *
 * - A run just settled (`isRunning` went `true` -> `false`) — whether it
 *   ran to completion, failed partway, or was Stopped, `run()`'s own
 *   `finally` block (runSlice.ts) is the one place that transition happens,
 *   exactly once per run. `runResult` itself changes many times *during*
 *   a run (once per settled step, via `onEvent`) but none of those
 *   intermediate values are worth a separate disk write — unlike the
 *   canvas autosave, a run's "last known good state" is only meaningful
 *   once the run is actually over, so there's nothing to debounce here.
 * - `runResult` was explicitly reset to `null` (`replaceWorkflow` does
 *   this — see documentSlice.ts) — the canvas moved on to a different
 *   workflow, so whatever the old one's run left on disk no longer
 *   applies to anything on screen and would otherwise linger indefinitely.
 *
 * Request secrets are stripped before the write ever happens — see
 * `autosave.ts`'s `saveRunResult`, not this function's concern.
 *
 * Call once at app boot; the returned cleanup unsubscribes — safe under
 * React StrictMode's mount/unmount/mount dance.
 */
export function startRunResultAutosave(): () => void {
  return useWorkflowStore.subscribe((state, prevState) => {
    const runJustSettled = prevState.isRunning && !state.isRunning;
    if (runJustSettled) {
      const { runResult, lastRunNodesById } = state;
      if (runResult && lastRunNodesById) void saveRunResult(runResult, lastRunNodesById);
      return;
    }
    if (prevState.runResult !== null && state.runResult === null) {
      void clearRunResult();
    }
  });
}

/**
 * Applies the last persisted run result, if any — restores `runResult`,
 * `lastRunNodesById` (so `buildFromLastRunSeed`'s staleness check has
 * something to compare against), and a derived `stepStatusByNodeId` (so
 * the Results pane shows the prior outcome immediately, consistent with
 * "Rerun failed" reappearing — see `hasResumableFailure`) instead of
 * looking empty until the user clicks it.
 *
 * Call once at boot, **after** `restoreAutosave` — `replaceWorkflow`
 * (which that calls) resets `runResult` to `null`, so restoring run
 * results first would just get immediately wiped.
 */
export async function restoreRunResult(): Promise<void> {
  const persisted = await loadRunResult();
  if (!persisted || persisted.runResult.steps.length === 0) return;

  const stepStatusByNodeId: Record<string, RunStepStatus> = {};
  for (const step of persisted.runResult.steps) {
    stepStatusByNodeId[step.nodeId] = step.error ? 'failed' : 'completed';
  }

  useWorkflowStore.setState({
    runResult: persisted.runResult,
    lastRunNodesById: new Map(persisted.lastRunNodes),
    stepStatusByNodeId,
  });
}
