import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useWorkflowStore } from '../store/workflowStore.js';
import { serializeCollection } from '../utils/workflowDocument.js';
import { clearAutosave, loadAutosave, saveAutosave } from './autosave.js';
import { restoreAutosave, startAutosave } from './autosaveSync.js';

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
  });
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
