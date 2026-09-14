import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useWorkflowStore } from '../store/workflowStore.js';
import { serializeCollection } from '../utils/workflowDocument.js';
import { clearAutosave, clearRunResult, loadAutosave, loadRunResult, saveAutosave, saveRunResult } from './autosave.js';
import { restoreAutosave, restoreRunResult, startAutosave, startRunResultAutosave } from './autosaveSync.js';
import type { RunResult, RunStep, WorkflowNode } from '../types.js';

function resetStore() {
  useWorkflowStore.setState({
    operations: [],
    nodes: [],
    connections: [],
    nodePositions: {},
    groups: [],
    presetsCollapsed: {},
    credentials: [],
    workflowName: 'Untitled',
    specInfo: null,
    error: null,
    credentialReview: null,
    isRunning: false,
    runResult: null,
    lastRunNodesById: null,
    stepStatusByNodeId: {},
  });
}

function sampleNode(id: string): WorkflowNode {
  return { id, kind: 'operation', operationId: id, credentialId: null };
}

function sampleStep(nodeId: string, overrides: Partial<RunStep> = {}): RunStep {
  return {
    nodeId,
    request: { method: 'GET', url: `http://example.test/${nodeId}`, headers: {}, credentials: 'omit' },
    response: { status: 200, headers: {}, body: { ok: true } },
    timestampStart: '2026-01-01T00:00:00.000Z',
    timestampEnd: '2026-01-01T00:00:01.000Z',
    ...overrides,
  };
}

function sampleCollection(overrides: Partial<Parameters<typeof serializeCollection>[0]> = {}) {
  return serializeCollection({
    name: 'Saved Workflow',
    includeSecrets: false,
    nodes: [{ id: 'n1', kind: 'operation', operationId: 'getThing', credentialId: null }],
    connections: [],
    nodePositions: { n1: { x: 10, y: 20 } },
    credentials: [],
    now: () => '2026-01-01T00:00:00.000Z',
    ...overrides,
  });
}

beforeEach(() => {
  resetStore();
});

afterEach(async () => {
  await clearAutosave();
  await clearRunResult();
});

/**
 * Real timers, not `vi.useFakeTimers()` — fake-indexeddb schedules its
 * request callbacks via Node's real `setImmediate` (see its own
 * `lib/scheduling.js`), which fake timers don't drive; mixing the two
 * deadlocks every IndexedDB call made afterward, in this file and any
 * later test that reuses the same module registry. A real wait past
 * the debounce window is slower but has no such trap.
 */
function waitPastDebounce(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 600));
}

describe('startAutosave', () => {
  it('debounces a canvas change into one write', async () => {
    const stop = startAutosave();
    try {
      useWorkflowStore.setState({ nodes: [{ id: 'n1', kind: 'operation', operationId: 'getThing', credentialId: null }] });
      useWorkflowStore.setState({ workflowName: 'Renamed' });
      expect(await loadAutosave()).toBeUndefined(); // nothing flushed yet

      await waitPastDebounce();

      const saved = (await loadAutosave()) as ReturnType<typeof sampleCollection>;
      expect(saved.name).toBe('Renamed');
      expect(saved.workflows[0].nodes).toHaveLength(1);
    } finally {
      stop();
    }
  });

  it('stops writing once cleaned up', async () => {
    const stop = startAutosave();
    stop();
    useWorkflowStore.setState({ workflowName: 'After stop' });
    await waitPastDebounce();
    expect(await loadAutosave()).toBeUndefined();
  });

  it('never writes credential secrets, even mid-session', async () => {
    const stop = startAutosave();
    try {
      useWorkflowStore.setState({
        credentials: [{ id: 'c1', name: 'API token', type: 'bearer', token: 'super-secret' }],
      });
      await waitPastDebounce();
      const saved = (await loadAutosave()) as any;
      expect(JSON.stringify(saved)).not.toContain('super-secret');
      expect(saved.credentials[0]).not.toHaveProperty('token');
    } finally {
      stop();
    }
  });
});

describe('restoreAutosave', () => {
  it('is a no-op when nothing was ever saved', async () => {
    await restoreAutosave();
    expect(useWorkflowStore.getState().nodes).toEqual([]);
    expect(useWorkflowStore.getState().workflowName).toBe('Untitled');
  });

  it('restores a saved canvas onto the (empty) boot-time store', async () => {
    useWorkflowStore.setState({ operations: [{ id: 'getThing', method: 'get', path: '/thing', parameters: [], requestBodySchema: null, requestBodyContentType: null, responseSchema: null }] });
    await saveAutosave(sampleCollection());

    await restoreAutosave();

    const state = useWorkflowStore.getState();
    expect(state.workflowName).toBe('Saved Workflow');
    expect(state.nodes).toEqual([{ id: 'n1', kind: 'operation', operationId: 'getThing', credentialId: null }]);
    expect(state.nodePositions).toEqual({ n1: { x: 10, y: 20 } });
    expect(state.error).toBeNull();
  });

  it('leaves the store untouched when the saved autosave is empty', async () => {
    await saveAutosave(sampleCollection({ nodes: [], nodePositions: {}, name: 'Empty' }));

    await restoreAutosave();

    expect(useWorkflowStore.getState().workflowName).toBe('Untitled');
  });

  it('discards an unreadable autosave record instead of throwing', async () => {
    await saveAutosave({ not: 'a real collection' } as any);

    await expect(restoreAutosave()).resolves.toBeUndefined();
    expect(useWorkflowStore.getState().nodes).toEqual([]);
  });

  it('flags an operation id no longer in the loaded spec', async () => {
    useWorkflowStore.setState({ operations: [] }); // spec doesn't declare 'getThing'
    await saveAutosave(sampleCollection());

    await restoreAutosave();

    expect(useWorkflowStore.getState().error).toMatch(/getThing/);
  });

  it('opens the credential review drawer when a restored credential needs a value', async () => {
    useWorkflowStore.setState({ operations: [] });
    await saveAutosave(
      sampleCollection({
        nodes: [],
        nodePositions: {},
        credentials: [{ id: 'c1', name: 'API token', type: 'bearer', token: 'secret' }],
      })
    );

    await restoreAutosave();

    expect(useWorkflowStore.getState().credentialReview).toEqual({ needsValueIds: ['c1'], secretsDiscarded: false });
  });
});

describe('startRunResultAutosave', () => {
  /** `isRunning: true` then `false` — the one transition `run()`'s own `finally` block (runSlice.ts) produces exactly once per run, regardless of outcome. */
  function settleARun() {
    useWorkflowStore.setState({ isRunning: true });
    useWorkflowStore.setState({ isRunning: false });
  }

  it('writes once, immediately, when a run settles — no debounce wait needed', async () => {
    const stop = startRunResultAutosave();
    try {
      useWorkflowStore.setState({ runResult: { steps: [sampleStep('n1')] }, lastRunNodesById: new Map([['n1', sampleNode('n1')]]) });
      expect(await loadRunResult()).toBeUndefined(); // mid-run: not written yet

      settleARun();

      const persisted = await loadRunResult();
      expect(persisted?.runResult.steps).toHaveLength(1);
      expect(persisted?.lastRunNodes).toEqual([['n1', sampleNode('n1')]]);
    } finally {
      stop();
    }
  });

  it('does not write on every intermediate runResult update mid-run, only on settle', async () => {
    const stop = startRunResultAutosave();
    try {
      useWorkflowStore.setState({ isRunning: true });
      // Two step events landing mid-run, same as onEvent streaming in runSlice.ts's run().
      useWorkflowStore.setState({ runResult: { steps: [sampleStep('n1')] } });
      useWorkflowStore.setState({ runResult: { steps: [sampleStep('n1'), sampleStep('n2')] } });
      expect(await loadRunResult()).toBeUndefined();
    } finally {
      stop();
    }
  });

  it('stops writing once cleaned up', async () => {
    const stop = startRunResultAutosave();
    stop();
    useWorkflowStore.setState({ runResult: { steps: [sampleStep('n1')] }, lastRunNodesById: new Map([['n1', sampleNode('n1')]]) });
    settleARun();
    expect(await loadRunResult()).toBeUndefined();
  });

  it('clears the persisted run result once runResult goes back to null (e.g. a new workflow replaced this one)', async () => {
    const stop = startRunResultAutosave();
    try {
      useWorkflowStore.setState({ runResult: { steps: [sampleStep('n1')] }, lastRunNodesById: new Map([['n1', sampleNode('n1')]]) });
      settleARun();
      expect(await loadRunResult()).toBeDefined();

      useWorkflowStore.setState({ runResult: null });
      expect(await loadRunResult()).toBeUndefined();
    } finally {
      stop();
    }
  });

  it('never writes a resolved credential secret from a step\'s request', async () => {
    const stop = startRunResultAutosave();
    try {
      useWorkflowStore.setState({
        runResult: { steps: [sampleStep('n1', { request: { method: 'GET', url: 'http://example.test/n1', headers: { Authorization: 'Bearer super-secret' }, credentials: 'omit' } })] },
        lastRunNodesById: new Map([['n1', sampleNode('n1')]]),
      });
      settleARun();
      const persisted = await loadRunResult();
      expect(JSON.stringify(persisted)).not.toContain('super-secret');
    } finally {
      stop();
    }
  });
});

describe('restoreRunResult', () => {
  it('is a no-op when nothing was ever saved', async () => {
    await restoreRunResult();
    expect(useWorkflowStore.getState().runResult).toBeNull();
  });

  it('restores runResult, lastRunNodesById, and a derived stepStatusByNodeId', async () => {
    await saveRunResult(
      { steps: [sampleStep('n1'), sampleStep('n2', { response: undefined, error: 'boom' })] },
      new Map([
        ['n1', sampleNode('n1')],
        ['n2', sampleNode('n2')],
      ])
    );

    await restoreRunResult();

    const state = useWorkflowStore.getState();
    expect(state.runResult?.steps.map((s) => s.nodeId)).toEqual(['n1', 'n2']);
    expect(state.lastRunNodesById).toEqual(
      new Map([
        ['n1', sampleNode('n1')],
        ['n2', sampleNode('n2')],
      ])
    );
    expect(state.stepStatusByNodeId).toEqual({ n1: 'completed', n2: 'failed' });
  });

  it('leaves the store untouched when the persisted run result has no steps', async () => {
    await saveRunResult({ steps: [] }, new Map());

    await restoreRunResult();

    expect(useWorkflowStore.getState().runResult).toBeNull();
  });

  it('is what makes "Rerun failed" work again after a reload: restored + a matching canvas node yields a resumable seed', async () => {
    // End-to-end across the two restore functions, in App.tsx's own order:
    // canvas first, then run result.
    useWorkflowStore.setState({ operations: [{ id: 'n1', method: 'get', path: '/n1', parameters: [], requestBodySchema: null, requestBodyContentType: null, responseSchema: null }] });
    const collection = serializeCollection({
      name: 'Saved',
      includeSecrets: false,
      nodes: [sampleNode('n1')],
      connections: [],
      nodePositions: {},
      credentials: [],
    });
    await saveAutosave(collection);
    await saveRunResult({ steps: [sampleStep('n1')] }, new Map([['n1', sampleNode('n1')]]));

    await restoreAutosave();
    await restoreRunResult();

    const state = useWorkflowStore.getState();
    expect(state.nodes).toEqual([sampleNode('n1')]);
    // The restored lastRunNodesById entry has the same *content* as the
    // restored canvas node, even though the two came from two separate
    // IndexedDB reads and are never the same object reference — this is
    // exactly what runSlice.ts's nodeConfigEqual (value, not reference,
    // comparison) exists for.
    expect(state.lastRunNodesById?.get('n1')).toEqual(state.nodes[0]);
  });
});
