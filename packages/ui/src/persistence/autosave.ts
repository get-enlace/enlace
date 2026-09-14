import type { EnlaceCollection } from '../types.js';
import { idbDelete, idbGet, idbSet, isIndexedDbAvailable } from './indexedDb.js';

/** Single fixed key — v1 is one autosave slot, not a list of saved workflows (see ROADMAP.md's "Client-side IndexedDB for local persistence" entry). */
const AUTOSAVE_KEY = 'current';

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
