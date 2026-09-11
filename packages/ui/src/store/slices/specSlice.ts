import type { StateCreator } from 'zustand';
import { fetchSpec } from '../../api/client.js';
import { extractDeclaredCredentials, parseOperations } from '@get-enlace/core';
import type { DeclaredCredential } from '@get-enlace/core';
import type { Operation } from '../../types.js';
import { resolveBaseUrl, type WorkflowState } from '../types.js';

export interface SpecSlice {
  operations: Operation[];
  baseUrl: string | null;
  specInfo: { title?: string; version?: string } | null;
  declaredCredentials: DeclaredCredential[];
  loadOperations: () => Promise<void>;
}

export const createSpecSlice: StateCreator<WorkflowState, [], [], SpecSlice> = (set) => ({
  operations: [],
  baseUrl: null,
  specInfo: null,
  declaredCredentials: [],

  loadOperations: async () => {
    try {
      const { spec, specUrl } = await fetchSpec();
      const operations = parseOperations(spec);
      const baseUrl = resolveBaseUrl(spec, specUrl);
      const declaredCredentials = extractDeclaredCredentials(spec);
      const info = spec.info ?? {};
      const specInfo: { title?: string; version?: string } = {};
      if (typeof info.title === 'string') specInfo.title = info.title;
      if (typeof info.version === 'string') specInfo.version = info.version;
      set({ operations, baseUrl, specInfo, declaredCredentials, error: null });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },
});
