import type { StateCreator } from 'zustand';
import { computeDescendants, connectionKey, executeChain } from '@get-enlace/core';
import { referencedIncompleteCredentials } from '../../utils/workflowDocument.js';
import type {
  RunControl,
  RunResult,
  RunStepRequest,
  RunStepStatus,
  WorkflowConnection,
  WorkflowNode,
} from '../../types.js';
import { isLocked, type WorkflowState } from '../types.js';

/**
 * Whether two nodes have the same effective config — used by
 * `buildFromLastRunSeed` below as its staleness check. Content comparison
 * (`JSON.stringify`), not reference equality: `lastRunNodesById` can now
 * come back from `persistence/`'s IndexedDB restore (see
 * `restoreRunResult`) as freshly-deserialized objects that will never be
 * reference-equal to anything, even an untouched node, so a reference
 * check would treat every restored node as stale and defeat "Rerun failed"
 * surviving a refresh entirely. `WorkflowNode` is plain JSON-safe data (no
 * functions, no `File` — those live separately in `uploadedFiles`, see
 * types.ts's `uploadedFileKey`), so this is safe; the only known false
 * positive is a same-content node whose keys happen to serialize in a
 * different order (e.g. one came through `parseCollection`, the other was
 * built in-session) — always the *safe* direction (an unnecessary re-run,
 * never a stale result silently reused), so not worth a canonical
 * key-sorted comparison here.
 */
function nodeConfigEqual(a: WorkflowNode | undefined, b: WorkflowNode | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * What "Rerun failed" (`run({ fromLastRun: true })`) seeds the next
 * `executeChain` call with — every node from `previousRunResult` that
 * completed without error AND isn't stale, as `ChainExecutorOptions.previousRun`.
 * A pure function, deliberately independent of the store, so this can be
 * unit-tested without going through a real `executeChain` call.
 *
 * "Stale" means: this node (or an ancestor of it) completed last run, but
 * its config has since changed — see `nodeConfigEqual`. Staleness cascades
 * forward via `computeDescendants`: a node downstream of an edited one may
 * have consumed its now-stale mapped output, even though the downstream
 * node's own config didn't change.
 *
 * Returns `undefined` when there's nothing to resume from (never run
 * before this session, and nothing restored from IndexedDB either) —
 * callers should treat that as "run fresh," not an error; the "Rerun
 * failed" button is also hidden in that case (see App.tsx), so this only
 * matters as a defensive fallback.
 */
export function buildFromLastRunSeed(
  nodes: WorkflowNode[],
  connections: WorkflowConnection[],
  previousRunResult: RunResult | null,
  lastRunNodesById: Map<string, WorkflowNode> | null
): RunResult | undefined {
  if (!previousRunResult || !lastRunNodesById) return undefined;

  const currentNodesById = new Map(nodes.map((n) => [n.id, n]));
  const completedNodeIds = previousRunResult.steps.filter((s) => !s.error).map((s) => s.nodeId);

  const staleNodeIds = new Set<string>();
  for (const id of completedNodeIds) {
    if (nodeConfigEqual(currentNodesById.get(id), lastRunNodesById.get(id))) continue;
    staleNodeIds.add(id);
    for (const descendantId of computeDescendants(nodes, connections, id)) staleNodeIds.add(descendantId);
  }

  return { steps: previousRunResult.steps.filter((s) => !s.error && !staleNodeIds.has(s.nodeId)) };
}

/**
 * Whether "Rerun failed" has anything to actually do — gates the button's
 * visibility (App.tsx), not just its behavior. True when the last run left
 * at least one node without a settled, error-free step: an explicit
 * failure (`error` set), or a node that never got a `RunStep` at all this
 * run (skipped, paused, never reached — or simply added to the graph since
 * the last run, which "Rerun failed" also happily picks up, since it never
 * re-derives resumability from *why* a node is missing).
 */
export function hasResumableFailure(runResult: RunResult | null, nodes: WorkflowNode[]): boolean {
  if (!runResult) return false;
  if (runResult.steps.length < nodes.length) return true;
  return runResult.steps.some((s) => s.error);
}

export interface RunSlice {
  runResult: RunResult | null;
  stepStatusByNodeId: Record<string, RunStepStatus>;
  armedBreakpoints: Set<string>;
  previewRequestByNodeId: Record<string, RunStepRequest>;
  activeControl: RunControl | null;
  isRunning: boolean;
  isDebugRun: boolean;
  debugConsoleOpen: boolean;
  error: string | null;
  /**
   * Every node exactly as it was at the start of the most recent run —
   * `run()`'s own snapshot for the *next* "Rerun failed" to diff against
   * (see `buildFromLastRunSeed`). Reference-equal to the actual `WorkflowNode`
   * objects that were live at that moment (not a clone) — cheap, and exactly
   * what the staleness check needs. `null` until the first run of the
   * session.
   */
  lastRunNodesById: Map<string, WorkflowNode> | null;
  toggleBreakpoint: (fromNodeId: string, toNodeId: string) => void;
  continueExecution: () => void;
  stepNode: (nodeId: string) => void;
  stopExecution: () => void;
  clearResults: () => void;
  /**
   * `fromLastRun`: seeds this run from the previous one (see
   * `buildFromLastRunSeed`) so nodes that already completed — and whose
   * config hasn't changed since — are skipped instead of re-run. Composable
   * with `useBreakpoints` — that's exactly what "Debug failed"
   * (RunControls' caret on Debug) fires: resume past whatever already
   * succeeded, then honor breakpoints for the rest, so a user can arm a
   * breakpoint on the node that failed and step into it without re-running
   * everything upstream of it first. `executeChain` (core) composes the two
   * independently already — a `previousRun`-seeded node just starts
   * `'completed'`, breakpoint gating is a separate check applied to
   * whatever's left — so no engine change was needed for this.
   */
  run: (options?: { useBreakpoints?: boolean; fromLastRun?: boolean }) => Promise<void>;
}

export const createRunSlice: StateCreator<WorkflowState, [], [], RunSlice> = (set, get) => ({
  runResult: null,
  stepStatusByNodeId: {},
  armedBreakpoints: new Set(),
  previewRequestByNodeId: {},
  activeControl: null,
  isRunning: false,
  isDebugRun: false,
  debugConsoleOpen: false,
  error: null,
  lastRunNodesById: null,

  toggleBreakpoint: (fromNodeId, toNodeId) =>
    set((state) => {
      if (isLocked(state)) return state;
      const key = connectionKey(fromNodeId, toNodeId);
      const armedBreakpoints = new Set(state.armedBreakpoints);
      if (armedBreakpoints.has(key)) armedBreakpoints.delete(key);
      else armedBreakpoints.add(key);
      return { armedBreakpoints };
    }),

  continueExecution: () => get().activeControl?.continue(),
  stepNode: (nodeId) => get().activeControl?.step(nodeId),
  stopExecution: () => get().activeControl?.stop(),

  clearResults: () => {
    if (get().isRunning) return;
    set({
      // Keep runResult — TagConfigModal / mapping chips still need last responses.
      stepStatusByNodeId: {},
      previewRequestByNodeId: {},
      error: null,
      debugConsoleOpen: false,
    });
  },

  run: async (options) => {
    const useBreakpoints = options?.useBreakpoints ?? false;
    const fromLastRun = options?.fromLastRun ?? false;
    const { nodes, connections, armedBreakpoints, credentials, runResult, lastRunNodesById } = get();
    const incomplete = referencedIncompleteCredentials(nodes, credentials);
    if (incomplete.length > 0) {
      const names = incomplete.map((c) => `"${c.name}"`).join(', ');
      set({
        error:
          incomplete.length === 1
            ? `Credential ${names} needs a secret before this chain can run.`
            : `Credentials ${names} need a secret before this chain can run.`,
      });
      return;
    }

    // Computed against the *previous* run's result/snapshot, before
    // anything below overwrites either — see buildFromLastRunSeed's own
    // doc. `undefined` for an ordinary run, or defensively when there's
    // nothing to resume from yet.
    const previousRun = fromLastRun ? buildFromLastRunSeed(nodes, connections, runResult, lastRunNodesById) : undefined;

    set({
      isRunning: true,
      isDebugRun: useBreakpoints,
      // Debug opens the REPL; a plain Run closes any leftover debug console.
      debugConsoleOpen: useBreakpoints,
      error: null,
      runResult: { steps: [] },
      stepStatusByNodeId: nodes.reduce<Record<string, RunStepStatus>>((acc, n) => {
        acc[n.id] = 'pending';
        return acc;
      }, {}),
      // Cleared here, not in the `finally` below — a paused/skipped node's
      // preview, and the statuses above, are meant to survive right up
      // until the *next* run starts (real review value on their own), not
      // just until this run happens to finish. Only activeControl resets
      // on completion (below): it's a live handle into a call that's now
      // over, not session state worth keeping around.
      previewRequestByNodeId: {},
      // Snapshotted every run, resume or not — this run's own nodes become
      // the reference point a *future* "Rerun failed" diffs against.
      lastRunNodesById: new Map(nodes.map((n) => [n.id, n])),
      // activeControl deliberately NOT cleared here — it's re-set once
      // executeChain's onControl fires, a moment after this.
    });
    try {
      const { connections, operations, credentials, baseUrl, uploadedFiles } = get();
      // baseUrl is only ever null here if run() somehow fires before
      // loadOperations() has resolved (App.tsx gates the canvas on that, so
      // this is a defensive last resort, not an expected path) —
      // resolveBaseUrl (types.ts) itself always resolves to a string once a
      // spec has loaded, spec-declared servers or not.
      if (!baseUrl) {
        throw new Error('No spec loaded yet — cannot determine a target base URL.');
      }
      const operationsById = new Map(operations.map((o) => [o.id, o]));
      const credentialsById = new Map(credentials.map((c) => [c.id, c]));
      const result = await executeChain({ nodes, connections }, operationsById, credentialsById, {
        baseUrl,
        uploadedFiles,
        // Streams progress into the store as each node settles, instead of
        // only setting `runResult` once at the very end — see
        // components/DebugPane/, which renders `runResult.steps` live. A
        // seeded 'completed' node from `previousRun` (below) flows through
        // this exact same path — executeChain emits for it too, so it needs
        // no separate handling here.
        onEvent: (event) => {
          set((state) => ({
            stepStatusByNodeId: { ...state.stepStatusByNodeId, [event.nodeId]: event.status },
            runResult: event.step
              ? { steps: [...(state.runResult?.steps ?? []), event.step] }
              : state.runResult,
            previewRequestByNodeId: event.request
              ? { ...state.previewRequestByNodeId, [event.nodeId]: event.request }
              : state.previewRequestByNodeId,
          }));
        },
        // Always capture RunControl so Stop works for plain Run and Debug.
        // Breakpoints are only snapshotted for Debug — a plain Run never
        // pauses, so Continue/Step stay unused (chrome uses isDebugRun to
        // pick spinner+Stop vs Continue/Step/Stop).
        onControl: (control) => set({ activeControl: control }),
        ...(useBreakpoints
          ? {
              // Snapshotted at the start of this run — arming/disarming a
              // breakpoint mid-run has no effect on a run already in
              // progress (see ChainExecutorOptions.armedBreakpoints's own
              // doc comment).
              armedBreakpoints: new Set(armedBreakpoints),
            }
          : {}),
        ...(previousRun ? { previousRun } : {}),
      });
      set({ runResult: result });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ isRunning: false, isDebugRun: false, activeControl: null, debugConsoleOpen: false });
    }
  },
});
