import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { clearAutosave, loadAutosave, saveAutosave } from './autosave.js';
import { serializeCollection } from '../utils/workflowDocument.js';

afterEach(async () => {
  await clearAutosave();
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
