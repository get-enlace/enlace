import type { StateCreator } from 'zustand';
import { clearCredentialTokenCache } from '@get-enlace/core';
import { randomId } from '../../utils/randomId.js';
import type { Credential, NewCredential } from '../../types.js';
import { type CredentialReview, type WorkflowState } from '../types.js';

export interface CredentialsSlice {
  credentials: Credential[];
  credentialReview: CredentialReview | null;
  addCredential: (credential: NewCredential, id?: string) => void;
  updateCredential: (credentialId: string, credential: NewCredential) => void;
  removeCredential: (credentialId: string) => void;
  setCredentialReview: (review: CredentialReview | null) => void;
}

export const createCredentialsSlice: StateCreator<WorkflowState, [], [], CredentialsSlice> = (set) => ({
  credentials: [],
  credentialReview: null,

  addCredential: (credential, id) => {
    const withId = { ...credential, id: id ?? randomId() } as Credential;
    set((state) => ({ credentials: [...state.credentials, withId] }));
  },

  updateCredential: (credentialId, credential) => {
    if (credential.type !== 'oauth2_clientCredentials' && credential.type !== 'oauth2_password') {
      clearCredentialTokenCache(credentialId);
    }
    const withId = { ...credential, id: credentialId } as Credential;
    set((state) => ({
      credentials: state.credentials.map((c) => (c.id === credentialId ? withId : c)),
    }));
  },

  removeCredential: (credentialId) => {
    clearCredentialTokenCache(credentialId);
    set((state) => ({
      credentials: state.credentials.filter((c) => c.id !== credentialId),
      nodes: state.nodes.map((n) => (n.credentialId === credentialId ? { ...n, credentialId: null } : n)),
    }));
  },

  setCredentialReview: (review) => set({ credentialReview: review }),
});
