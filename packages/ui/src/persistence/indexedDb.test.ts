// fake-indexeddb polyfills the global `indexedDB`/`IDBKeyRange` this module
// needs — jsdom (this package's vitest environment) doesn't implement
// IndexedDB at all. Imported for its side effect only, scoped to this file
// (not global setup.ts) so no other test's environment changes.
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { dbName, idbDelete, idbGet, idbSet, isIndexedDbAvailable } from './indexedDb.js';

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

describe('dbName', () => {
  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('normalizes a trailing slash and a literal index.html to the same name', () => {
    window.history.pushState({}, '', '/app1');
    const bare = dbName();
    window.history.pushState({}, '', '/app1/');
    const trailingSlash = dbName();
    window.history.pushState({}, '', '/app1/index.html');
    const indexHtml = dbName();

    expect(trailingSlash).toBe(bare);
    expect(indexHtml).toBe(bare);
  });

  it('gives two different mount paths two different names', () => {
    window.history.pushState({}, '', '/app1/');
    const app1 = dbName();
    window.history.pushState({}, '', '/app2/');
    const app2 = dbName();

    expect(app1).not.toBe(app2);
  });
});

describe('same-origin, different mount path: real database isolation', () => {
  afterEach(async () => {
    window.history.pushState({}, '', '/app1/');
    await idbDelete('shared-key');
    window.history.pushState({}, '', '/app2/');
    await idbDelete('shared-key');
    window.history.pushState({}, '', '/');
  });

  it('keeps two different mount paths in two entirely separate databases, on the same origin', async () => {
    window.history.pushState({}, '', '/app1/');
    await idbSet('shared-key', 'from app1');

    window.history.pushState({}, '', '/app2/');
    expect(await idbGet('shared-key')).toBeUndefined(); // not app1's value
    await idbSet('shared-key', 'from app2');

    window.history.pushState({}, '', '/app1/');
    expect(await idbGet('shared-key')).toBe('from app1'); // app2's write didn't clobber it
  });
});
