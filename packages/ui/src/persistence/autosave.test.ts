import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { clearAutosave, clearRunResult, loadAutosave, loadRunResult, saveAutosave, saveRunResult } from './autosave.js';
import { serializeCollection } from '../utils/workflowDocument.js';
import type { RunResult, WorkflowNode } from '../types.js';

afterEach(async () => {
  await clearAutosave();
  await clearRunResult();
});

function sampleCollection() {
  return serializeCollection({
    name: 'My Workflow',
    includeSecrets: false,
    nodes: [{ id: 'n1', kind: 'operation', operationId: 'getThing', credentialId: null }],
    connections: [],
    nodePositions: { n1: { x: 10, y: 20 } },
    credentials: [],
    now: () => '2026-01-01T00:00:00.000Z',
  });
}

describe('loadAutosave', () => {
  it('resolves undefined when nothing has been saved', async () => {
    expect(await loadAutosave()).toBeUndefined();
  });
});

describe('saveAutosave / loadAutosave', () => {
  it('round-trips a collection', async () => {
    const collection = sampleCollection();
    await saveAutosave(collection);
    expect(await loadAutosave()).toEqual(collection);
  });

  it('a later save replaces the earlier one', async () => {
    await saveAutosave(sampleCollection());
    const renamed = { ...sampleCollection(), name: 'Renamed' };
    await saveAutosave(renamed);
    expect(await loadAutosave()).toEqual(renamed);
  });
});

describe('clearAutosave', () => {
  it('removes a previously saved collection', async () => {
    await saveAutosave(sampleCollection());
    await clearAutosave();
    expect(await loadAutosave()).toBeUndefined();
  });

  it('is a no-op when nothing was saved', async () => {
    await expect(clearAutosave()).resolves.toBeUndefined();
  });
});

function sampleNode(id: string): WorkflowNode {
  return { id, kind: 'operation', operationId: id, credentialId: null };
}

function sampleRunResult(): RunResult {
  return {
    steps: [
      {
        nodeId: 'n1',
        request: { method: 'GET', url: 'http://example.test/thing', headers: { Authorization: 'Bearer secret-token' }, credentials: 'omit' },
        response: { status: 200, headers: {}, body: { ok: true } },
        timestampStart: '2026-01-01T00:00:00.000Z',
        timestampEnd: '2026-01-01T00:00:01.000Z',
      },
    ],
  };
}

describe('loadRunResult', () => {
  it('resolves undefined when nothing has been saved', async () => {
    expect(await loadRunResult()).toBeUndefined();
  });

  it('resolves undefined for a record that does not look like a PersistedRunResult', async () => {
    // saveAutosave/loadAutosave and saveRunResult/loadRunResult share one
    // IndexedDB store under different keys — this only proves loadRunResult
    // doesn't accidentally trust a canvas autosave (or any other unrelated
    // shape) sitting under its own key.
    await saveAutosave(sampleCollection());
    expect(await loadRunResult()).toBeUndefined();
  });
});

describe('saveRunResult / loadRunResult', () => {
  it('round-trips a run result and its node snapshot', async () => {
    const runResult = sampleRunResult();
    const lastRunNodesById = new Map([['n1', sampleNode('n1')]]);

    await saveRunResult(runResult, lastRunNodesById);
    const persisted = await loadRunResult();

    expect(persisted?.lastRunNodes).toEqual([['n1', sampleNode('n1')]]);
    expect(persisted?.runResult.steps[0]?.response).toEqual(runResult.steps[0]?.response);
  });

  it('never writes a resolved credential secret from a step\'s request', async () => {
    await saveRunResult(sampleRunResult(), new Map([['n1', sampleNode('n1')]]));
    const persisted = await loadRunResult();
    expect(JSON.stringify(persisted)).not.toContain('secret-token');
    expect(persisted?.runResult.steps[0]?.request.headers.Authorization).toBe('[redacted]');
  });

  it('a later save replaces the earlier one', async () => {
    await saveRunResult(sampleRunResult(), new Map([['n1', sampleNode('n1')]]));
    const second: RunResult = { steps: [] };
    await saveRunResult(second, new Map());
    expect((await loadRunResult())?.runResult.steps).toEqual([]);
  });
});

describe('clearRunResult', () => {
  it('removes a previously saved run result', async () => {
    await saveRunResult(sampleRunResult(), new Map([['n1', sampleNode('n1')]]));
    await clearRunResult();
    expect(await loadRunResult()).toBeUndefined();
  });

  it('is a no-op when nothing was saved', async () => {
    await expect(clearRunResult()).resolves.toBeUndefined();
  });
});
