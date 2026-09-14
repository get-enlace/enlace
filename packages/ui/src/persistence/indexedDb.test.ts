// fake-indexeddb polyfills the global `indexedDB`/`IDBKeyRange` this module
// needs — jsdom (this package's vitest environment) doesn't implement
// IndexedDB at all. Imported for its side effect only, scoped to this file
// (not global setup.ts) so no other test's environment changes.
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { idbDelete, idbGet, idbSet, isIndexedDbAvailable } from './indexedDb.js';

afterEach(async () => {
  await idbDelete('a');
  await idbDelete('b');
});

describe('isIndexedDbAvailable', () => {
  it('is true once fake-indexeddb has polyfilled the global', () => {
    expect(isIndexedDbAvailable()).toBe(true);
  });
});

describe('idbGet/idbSet/idbDelete', () => {
  it('returns undefined for a key that was never set', async () => {
    expect(await idbGet('missing')).toBeUndefined();
  });

  it('round-trips a structured-clonable value', async () => {
    await idbSet('a', { nested: { list: [1, 2, 3] }, name: 'x' });
    expect(await idbGet('a')).toEqual({ nested: { list: [1, 2, 3] }, name: 'x' });
  });

  it('overwrites a value set at the same key', async () => {
    await idbSet('a', 'first');
    await idbSet('a', 'second');
    expect(await idbGet('a')).toBe('second');
  });

  it('keeps different keys independent', async () => {
    await idbSet('a', 'one');
    await idbSet('b', 'two');
    expect(await idbGet('a')).toBe('one');
    expect(await idbGet('b')).toBe('two');
  });

  it('deletes a key', async () => {
    await idbSet('a', 'value');
    await idbDelete('a');
    expect(await idbGet('a')).toBeUndefined();
  });
});
