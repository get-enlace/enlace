import type { EnlaceCollection, RunResult, WorkflowNode } from '../types.js';
import { redactStep } from '../utils/redactRequest.js';
import { idbDelete, idbGet, idbSet, isIndexedDbAvailable } from './indexedDb.js';

/** Single fixed key — v1 is one autosave slot, not a list of saved workflows (see ROADMAP.md's "Client-side IndexedDB for local persistence" entry). */
const AUTOSAVE_KEY = 'current';
/** Separate key, same store — a distinct concern (last run's steps, for "Rerun failed" to survive a refresh) with its own shape, not part of the canvas collection. */
const RUN_RESULT_KEY = 'lastRun';

/** What `saveRunResult`/`loadRunResult` round-trip. `lastRunNodes` is `lastRunNodesById` (store/slices/runSlice.ts) as pairs — plainer to validate on read-back than trusting a deserialized `Map` blindly, and every browser's IndexedDB can structured-clone it either way. */
export interface PersistedRunResult {
  runResult: RunResult;
  lastRunNodes: [string, WorkflowNode][];
}

/**
 * `undefined` covers both "nothing saved yet" and "IndexedDB unusable" —
 * callers (`autosaveSync.ts`) treat both the same way: fall back to
 * whatever's already in the store, no error surfaced to the user. Stored
 * value is read back as `unknown`, not trusted as `EnlaceCollection` — it
 * goes through `parseCollection`'s full validation before use, same as a
 * `.enlace` file picked up off disk (the shape can drift across app
 * versions same as an old export file can).
 */
export async function loadAutosave(): Promise<unknown> {
  if (!isIndexedDbAvailable()) return undefined;
  try {
    return await idbGet<unknown>(AUTOSAVE_KEY);
  } catch (err) {
    console.warn('enlace: failed to read autosaved workflow from IndexedDB.', err);
    return undefined;
  }
}

export async function saveAutosave(collection: EnlaceCollection): Promise<void> {
  if (!isIndexedDbAvailable()) return;
  try {
    await idbSet(AUTOSAVE_KEY, collection);
  } catch (err) {
    console.warn('enlace: failed to autosave workflow to IndexedDB.', err);
  }
}

export async function clearAutosave(): Promise<void> {
  if (!isIndexedDbAvailable()) return;
  try {
    await idbDelete(AUTOSAVE_KEY);
  } catch (err) {
    console.warn('enlace: failed to clear autosaved workflow from IndexedDB.', err);
  }
}

function isPersistedRunResult(value: unknown): value is PersistedRunResult {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  const runResult = record.runResult;
  return (
    typeof runResult === 'object' &&
    runResult !== null &&
    Array.isArray((runResult as Record<string, unknown>).steps) &&
    Array.isArray(record.lastRunNodes)
  );
}

/**
 * `undefined` covers "nothing saved", "IndexedDB unusable", and "what's
 * there doesn't look like a `PersistedRunResult` anymore" (an older app
 * version's record, say) — same "discard rather than throw" stance
 * `loadAutosave` takes, at a proportionate depth: this is only ever data
 * this same app previously wrote itself, never a file a person hands
 * another person the way a `.enlace` import is, so a light shape check is
 * enough — not the field-by-field validation `parseCollection` does for
 * genuinely untrusted input.
 */
export async function loadRunResult(): Promise<PersistedRunResult | undefined> {
  if (!isIndexedDbAvailable()) return undefined;
  try {
    const value = await idbGet<unknown>(RUN_RESULT_KEY);
    return isPersistedRunResult(value) ? value : undefined;
  } catch (err) {
    console.warn('enlace: failed to read the last run result from IndexedDB.', err);
    return undefined;
  }
}

/**
 * Every step's `request` is redacted first (`redactStep` — the same
 * masking the live debug pane already applies for display) so a resolved
 * credential secret (an Authorization header, an apiKey-in-header value)
 * never actually reaches disk — `response` is left as-is; that's the
 * target API's own response data, not an Enlace-managed secret (see
 * ROADMAP.md's "Client-side IndexedDB for local persistence" entry).
 */
export async function saveRunResult(runResult: RunResult, lastRunNodesById: Map<string, WorkflowNode>): Promise<void> {
  if (!isIndexedDbAvailable()) return;
  try {
    const redacted: PersistedRunResult = {
      runResult: { steps: runResult.steps.map(redactStep) },
      lastRunNodes: [...lastRunNodesById],
    };
    await idbSet(RUN_RESULT_KEY, redacted);
  } catch (err) {
    console.warn('enlace: failed to save the last run result to IndexedDB.', err);
  }
}

export async function clearRunResult(): Promise<void> {
  if (!isIndexedDbAvailable()) return;
  try {
    await idbDelete(RUN_RESULT_KEY);
  } catch (err) {
    console.warn('enlace: failed to clear the last run result from IndexedDB.', err);
  }
}
