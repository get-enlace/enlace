import type { StateCreator } from 'zustand';
import { connectionKey } from '@get-enlace/core';
import { findOpenPosition } from '../../utils/nodePlacement.js';
import { expandedGroupFrame, sortGroupMemberIds } from '../../utils/groupGeometry.js';
import { randomId } from '../../utils/randomId.js';
import { buildDefaultRawBody, buildDefaultRawHeaders, buildDefaultRawParams } from '../../utils/rawDefaults.js';
import type { AssertCheck, FieldValue, NewPreset, Preset, NodeGroup, RawBody, RawParamsSection, WorkflowConnection, WorkflowNode } from '../../types.js';
import {
  defaultPosition,
  isLocked,
  uploadedFileKey,
  type Position,
  type WorkflowState,
} from '../types.js';

export interface GraphSlice {
  nodes: WorkflowNode[];
  connections: WorkflowConnection[];
  nodePositions: Record<string, Position>;
  groups: NodeGroup[];
  selectedNodeId: string | null;
  /** Which preset inside the selected presets node has its config open in NodeConfig — see WorkflowState's own comment. */
  selectedPresetId: string | null;
  uploadedFiles: Record<string, File>;
  /**
   * View-only chrome for `kind: 'presets'` nodes — collapsed (small diamond)
   * vs expanded (preset list box). Same tier as
   * `nodePositions`/`NodeGroup.collapsed`: never part of the executed
   * `Workflow`, round-tripped in `.enlace` exports alongside
   * `nodePositions`. Absent entry means expanded (a freshly-dropped
   * collection starts open so its one preset is immediately visible/editable).
   */
  presetsCollapsed: Record<string, boolean>;
  addNode: (operationId: string, position?: Position) => string;
  /**
   * The only way a preset reaches the canvas — always creates a
   * `kind: 'presets'` collection, seeded with `initialPreset` when given
   * (the palette always passes one; nothing ever drops an empty collection).
   * Even a single preset renders with the collection's collapsed-diamond /
   * expanded-box chrome, never as a standalone graph node.
   */
  addPresetsNode: (position?: Position, initialPreset?: NewPreset) => string;
  /** Appends one preset to a collection's ordered `presets` list. No-op if `presetsNodeId` isn't a presets node. */
  addPreset: (presetsNodeId: string, preset: NewPreset) => void;
  removePreset: (presetsNodeId: string, presetId: string) => void;
  /** Swaps a preset with its immediate up/down neighbor — "linear order only", no arbitrary jumps. A no-op at either end of the list. */
  movePreset: (presetsNodeId: string, presetId: string, direction: 'up' | 'down') => void;
  setPresetDurationMs: (presetsNodeId: string, presetId: string, durationMs: number) => void;
  /** Appends one blank check to an assert preset's `checks` list. No-op if `presetsNodeId`/`presetId` don't resolve to an assert preset. */
  addAssertCheck: (presetsNodeId: string, presetId: string) => void;
  removeAssertCheck: (presetsNodeId: string, presetId: string, checkId: string) => void;
  /** Shallow-merges `patch` into one check. */
  updateAssertCheck: (
    presetsNodeId: string,
    presetId: string,
    checkId: string,
    patch: Partial<Omit<AssertCheck, 'id'>>
  ) => void;
  setPresetsCollapsed: (presetsNodeId: string, collapsed: boolean) => void;
  updateNodePosition: (nodeId: string, position: Position, options?: { avoidOverlap?: boolean }) => void;
  removeNode: (nodeId: string) => void;
  selectNode: (nodeId: string | null) => void;
  selectPreset: (presetsNodeId: string, presetId: string) => void;
  setCredential: (nodeId: string, credentialId: string | null) => void;
  setCredentialExtraParamOverride: (nodeId: string, key: string, value: FieldValue | null) => void;
  setCredentialExtraParamOverridesEnabled: (nodeId: string, enabled: boolean) => void;
  setUploadedFile: (nodeId: string, fieldPath: string, file: File | null) => void;
  /** Replaces one path/query param field in place — no-op if the node has no `rawParams` section (or that bucket) at all. */
  setRawParamField: (nodeId: string, bucket: keyof RawParamsSection, key: string, value: RawBody) => void;
  /** Replaces one header field in place — no-op if the node has no `rawHeaders` section at all. */
  setRawHeaderField: (nodeId: string, key: string, value: RawBody) => void;
  setRawBody: (nodeId: string, rawBody: RawBody | null) => void;
  connectNodes: (fromNodeId: string, toNodeId: string) => void;
  disconnectNodes: (fromNodeId: string, toNodeId: string) => void;
  createGroup: (opts: {
    name: string;
    nodeIds: [string, string];
    draggedNodeId: string;
    draggedPosition: Position;
    skipConfirmOnDrop?: boolean;
  }) => string;
  joinGroup: (groupId: string, nodeId: string, position: Position, opts?: { skipConfirmOnDrop?: boolean }) => void;
  ungroup: (groupId: string) => void;
  removeFromGroup: (groupId: string, nodeId: string) => void;
  setGroupCollapsed: (groupId: string, collapsed: boolean) => void;
  setGroupName: (groupId: string, name: string) => void;
  moveGroup: (groupId: string, position: Position) => void;
}

/** Default duration for a freshly-dropped Wait preset — 1s is long enough to be a deliberate pause without being annoying to test with, and short enough to trim on the spot. */
export const DEFAULT_WAIT_DURATION_MS = 1000;

export const createGraphSlice: StateCreator<WorkflowState, [], [], GraphSlice> = (set, get) => ({
  nodes: [],
  connections: [],
  nodePositions: {},
  groups: [],
  selectedNodeId: null,
  selectedPresetId: null,
  uploadedFiles: {},
  presetsCollapsed: {},

  addNode: (operationId, position) => {
    if (isLocked(get())) return '';
    const id = randomId();
    // Every section opens pre-seeded with a Raw JSON skeleton straight from
    // the operation's schema — there's no Form mode to lazily generate one
    // from on first switch any more, so this is the only place it happens.
    // `null` (no path params, no body, etc.) is a real, valid section state
    // — NodeConfig.tsx just doesn't render that editor at all.
    const operation = get().operations.find((o) => o.id === operationId);
    const node: WorkflowNode = {
      id,
      kind: 'operation',
      operationId,
      credentialId: null,
      rawParams: operation ? buildDefaultRawParams(operation) : null,
      rawHeaders: operation ? buildDefaultRawHeaders(operation) : null,
      rawBody: operation ? buildDefaultRawBody(operation) : null,
    };
    set((state) => {
      const desired = position ?? defaultPosition(state.nodes.length);
      const obstacles = Object.values(state.nodePositions);
      return {
        nodes: [...state.nodes, node],
        nodePositions: { ...state.nodePositions, [id]: findOpenPosition(desired, obstacles) },
        selectedNodeId: id,
      };
    });
    return id;
  },

  addPresetsNode: (position, initialPreset) => {
    if (isLocked(get())) return '';
    const id = randomId();
    const presets: Preset[] = initialPreset ? [{ ...initialPreset, id: randomId() }] : [];
    const node: WorkflowNode = { id, kind: 'presets', credentialId: null, presets };
    set((state) => {
      const desired = position ?? defaultPosition(state.nodes.length);
      const obstacles = Object.values(state.nodePositions);
      return {
        nodes: [...state.nodes, node],
        nodePositions: { ...state.nodePositions, [id]: findOpenPosition(desired, obstacles) },
        selectedNodeId: id,
        // Seeded with one preset (the palette's own drop path) — open its
        // config immediately, same as addPreset below, rather than leaving
        // the inspector on the "select a preset" placeholder for a card
        // that only has the one.
        selectedPresetId: presets[0]?.id ?? null,
      };
    });
    return id;
  },

  addPreset: (presetsNodeId, preset) =>
    set((state) => {
      if (isLocked(state)) return state;
      const presetsNode = state.nodes.find((n) => n.id === presetsNodeId);
      if (!presetsNode || presetsNode.kind !== 'presets') return state;
      const newPreset: Preset = { ...preset, id: randomId() };
      return {
        nodes: state.nodes.map((n) =>
          n.id === presetsNodeId && n.kind === 'presets' ? { ...n, presets: [...(n.presets ?? []), newPreset] } : n
        ),
        // Dragging a preset onto the card is the only way to add one now
        // (see PresetsNodeCard.tsx's own comment) — open its config right
        // away instead of leaving the user to go find and click the new row.
        selectedNodeId: presetsNodeId,
        selectedPresetId: newPreset.id,
      };
    }),

  removePreset: (presetsNodeId, presetId) =>
    set((state) => {
      if (isLocked(state)) return state;
      return {
        nodes: state.nodes.map((n) =>
          n.id === presetsNodeId && n.kind === 'presets'
            ? { ...n, presets: (n.presets ?? []).filter((p) => p.id !== presetId) }
            : n
        ),
        // Same dangling-selection reasoning as removeNode's selectedNodeId
        // clear — a removed preset can't stay "open" in NodeConfig.
        selectedPresetId: state.selectedPresetId === presetId ? null : state.selectedPresetId,
      };
    }),

  movePreset: (presetsNodeId, presetId, direction) =>
    set((state) => {
      if (isLocked(state)) return state;
      const presetsNode = state.nodes.find((n) => n.id === presetsNodeId);
      if (!presetsNode || presetsNode.kind !== 'presets' || !presetsNode.presets) return state;
      const index = presetsNode.presets.findIndex((p) => p.id === presetId);
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (index < 0 || targetIndex < 0 || targetIndex >= presetsNode.presets.length) return state;
      const presets = [...presetsNode.presets];
      [presets[index], presets[targetIndex]] = [presets[targetIndex], presets[index]];
      return {
        nodes: state.nodes.map((n) => (n.id === presetsNodeId && n.kind === 'presets' ? { ...n, presets } : n)),
      };
    }),

  // Each of the four mutators below narrows to its own preset kind before
  // touching a kind-specific field — `Preset` is a real discriminated union
  // now (WaitPreset | AssertPreset), so `p.durationMs`/`p.checks` isn't
  // reachable at all without it. A `presetId` that resolves to the wrong
  // kind (shouldn't happen — the UI only ever calls these from that kind's
  // own editor) is a no-op rather than producing a malformed preset.
  setPresetDurationMs: (presetsNodeId, presetId, durationMs) =>
    set((state) => {
      if (isLocked(state)) return state;
      return {
        nodes: state.nodes.map((n) =>
          n.id === presetsNodeId && n.kind === 'presets'
            ? {
                ...n,
                presets: (n.presets ?? []).map((p) =>
                  p.id === presetId && p.kind === 'wait' ? { ...p, durationMs } : p
                ),
              }
            : n
        ),
      };
    }),

  addAssertCheck: (presetsNodeId, presetId) =>
    set((state) => {
      if (isLocked(state)) return state;
      const newCheck: AssertCheck = {
        id: randomId(),
        source: { type: 'response_body', sourceNodeId: '', jsonPath: '' },
        operator: 'equals',
        expected: '',
      };
      return {
        nodes: state.nodes.map((n) =>
          n.id === presetsNodeId && n.kind === 'presets'
            ? {
                ...n,
                presets: (n.presets ?? []).map((p) =>
                  p.id === presetId && p.kind === 'assert' ? { ...p, checks: [...p.checks, newCheck] } : p
                ),
              }
            : n
        ),
      };
    }),

  removeAssertCheck: (presetsNodeId, presetId, checkId) =>
    set((state) => {
      if (isLocked(state)) return state;
      return {
        nodes: state.nodes.map((n) =>
          n.id === presetsNodeId && n.kind === 'presets'
            ? {
                ...n,
                presets: (n.presets ?? []).map((p) =>
                  p.id === presetId && p.kind === 'assert'
                    ? { ...p, checks: p.checks.filter((c) => c.id !== checkId) }
                    : p
                ),
              }
            : n
        ),
      };
    }),

  updateAssertCheck: (presetsNodeId, presetId, checkId, patch) =>
    set((state) => {
      if (isLocked(state)) return state;
      return {
        nodes: state.nodes.map((n) =>
          n.id === presetsNodeId && n.kind === 'presets'
            ? {
                ...n,
                presets: (n.presets ?? []).map((p) =>
                  p.id === presetId && p.kind === 'assert'
                    ? { ...p, checks: p.checks.map((c) => (c.id === checkId ? { ...c, ...patch } : c)) }
                    : p
                ),
              }
            : n
        ),
      };
    }),

  setPresetsCollapsed: (presetsNodeId, collapsed) =>
    set((state) => {
      if (isLocked(state)) return state;
      return { presetsCollapsed: { ...state.presetsCollapsed, [presetsNodeId]: collapsed } };
    }),

  updateNodePosition: (nodeId, position, options) =>
    set((state) => {
      let next = position;
      if (options?.avoidOverlap === true) {
        const ownGroup = state.groups.find((g) => g.nodeIds.includes(nodeId));
        const skip = new Set<string>([nodeId, ...(ownGroup?.nodeIds ?? [])]);
        const obstacles = Object.entries(state.nodePositions)
          .filter(([id]) => !skip.has(id))
          .map(([, pos]) => pos);
        next = findOpenPosition(position, obstacles);
      }
      return { nodePositions: { ...state.nodePositions, [nodeId]: next } };
    }),

  removeNode: (nodeId) =>
    set((state) => {
      if (isLocked(state)) return state;
      const nodePositions = { ...state.nodePositions };
      delete nodePositions[nodeId];

      const presetsCollapsed = { ...state.presetsCollapsed };
      delete presetsCollapsed[nodeId];

      const uploadedFiles = { ...state.uploadedFiles };
      const prefix = `${nodeId}::`;
      for (const key of Object.keys(uploadedFiles)) {
        if (key.startsWith(prefix)) delete uploadedFiles[key];
      }

      // A Raw JSON section's own tag chips referencing this node are
      // deliberately left alone here — RawBodyEditor.tsx already renders a
      // dangling `sourceNodeId` as a visible "broken" chip the user can fix
      // or remove, so there's nothing for this cleanup pass to silently
      // paper over the way a Form-mode fieldValues entry used to need.
      const nodes = state.nodes
        .filter((n) => n.id !== nodeId)
        .map((n) => {
          if (n.kind === 'presets') return n;

          // A mapped override has no "static" fallback that makes sense
          // here (there's no value to fall back to but the credential's
          // own, which just means dropping the override entirely) — see
          // credentialExtraParamOverrides's own comment on WorkflowNode.
          const credentialExtraParamOverrides = n.credentialExtraParamOverrides;
          if (!credentialExtraParamOverrides) return n;
          const next = { ...credentialExtraParamOverrides };
          let changed = false;
          for (const [key, fv] of Object.entries(next)) {
            if (fv.source === 'mapped' && fv.fromNodeId === nodeId) {
              delete next[key];
              changed = true;
            }
          }
          return changed ? { ...n, credentialExtraParamOverrides: next } : n;
        });

      // Drop the node from any group; dissolve groups left with < 2 members.
      const groups = state.groups
        .map((g) => (g.nodeIds.includes(nodeId) ? { ...g, nodeIds: g.nodeIds.filter((id) => id !== nodeId) } : g))
        .filter((g) => g.nodeIds.length >= 2);

      return {
        nodes,
        nodePositions,
        presetsCollapsed,
        uploadedFiles,
        groups,
        connections: state.connections.filter((c) => c.fromNodeId !== nodeId && c.toNodeId !== nodeId),
        selectedNodeId: state.selectedNodeId === nodeId ? null : state.selectedNodeId,
        selectedPresetId: state.selectedNodeId === nodeId ? null : state.selectedPresetId,
      };
    }),

  selectNode: (nodeId) => set({ selectedNodeId: nodeId, selectedPresetId: null }),

  selectPreset: (presetsNodeId, presetId) => set({ selectedNodeId: presetsNodeId, selectedPresetId: presetId }),

  setCredential: (nodeId, credentialId) =>
    set((state) => {
      if (isLocked(state)) return state;
      return { nodes: state.nodes.map((n) => (n.id === nodeId ? { ...n, credentialId } : n)) };
    }),

  // `null` clears the override (falls back to the credential's own
  // extraTokenParams value); a FieldValue sets/replaces it. See
  // WorkflowNode.credentialExtraParamOverrides's own comment in types.ts
  // for why this lives per-node rather than on the shared Credential.
  setCredentialExtraParamOverride: (nodeId, key, value) =>
    set((state) => {
      if (isLocked(state)) return state;
      return {
        nodes: state.nodes.map((n) => {
          if (n.id !== nodeId || n.kind === 'presets') return n;
          const credentialExtraParamOverrides = { ...n.credentialExtraParamOverrides };
          if (value) credentialExtraParamOverrides[key] = value;
          else delete credentialExtraParamOverrides[key];
          return { ...n, credentialExtraParamOverrides };
        }),
      };
    }),

  // Deliberately leaves credentialExtraParamOverrides untouched either way —
  // this is a visibility/activation switch, not a delete action (see
  // WorkflowNode.credentialExtraParamOverridesEnabled's own comment).
  setCredentialExtraParamOverridesEnabled: (nodeId, enabled) =>
    set((state) => {
      if (isLocked(state)) return state;
      return {
        nodes: state.nodes.map((n) =>
          n.id === nodeId && n.kind !== 'presets' ? { ...n, credentialExtraParamOverridesEnabled: enabled } : n
        ),
      };
    }),

  // The `File` blob itself only ever lives here — RawBodyEditor's own
  // `uploaded_file` tag chip carries just a `fileName` marker (see
  // types.ts's `BodyTag`), keyed the same way via `rawFileTagFieldPath`.
  setUploadedFile: (nodeId, fieldPath, file) =>
    set((state) => {
      if (isLocked(state)) return state;
      const key = uploadedFileKey(nodeId, fieldPath);
      const uploadedFiles = { ...state.uploadedFiles };
      if (file) uploadedFiles[key] = file;
      else delete uploadedFiles[key];
      return { uploadedFiles };
    }),

  // `n.rawParams`/`n.rawHeaders` being null (the operation declares no
  // path/query/header params at all) doesn't block this — NodeConfig.tsx
  // only ever renders a FieldValueEditor when the section already exists,
  // so a null section here would only happen from a test or a future
  // caller setting a field before the section exists; starting from an
  // empty `{paths:{},queries:{}}`/`{}` rather than no-op'ing keeps this
  // setter usable either way, same permissiveness the old whole-section
  // `setRawParams`/`setRawHeaders` had.
  setRawParamField: (nodeId, bucket, key, value) =>
    set((state) => {
      if (isLocked(state)) return state;
      return {
        nodes: state.nodes.map((n) => {
          if (n.id !== nodeId || n.kind === 'presets') return n;
          const rawParams = n.rawParams ?? { paths: {}, queries: {} };
          return { ...n, rawParams: { ...rawParams, [bucket]: { ...rawParams[bucket], [key]: value } } };
        }),
      };
    }),

  setRawHeaderField: (nodeId, key, value) =>
    set((state) => {
      if (isLocked(state)) return state;
      return {
        nodes: state.nodes.map((n) => {
          if (n.id !== nodeId || n.kind === 'presets') return n;
          return { ...n, rawHeaders: { ...(n.rawHeaders ?? {}), [key]: value } };
        }),
      };
    }),

  setRawBody: (nodeId, rawBody) =>
    set((state) => {
      if (isLocked(state)) return state;
      return {
        nodes: state.nodes.map((n) => (n.id === nodeId && n.kind !== 'presets' ? { ...n, rawBody } : n)),
      };
    }),

  connectNodes: (fromNodeId, toNodeId) =>
    set((state) => {
      if (isLocked(state)) return state;
      if (fromNodeId === toNodeId) return state; // no self-loops
      const exists = state.connections.some((c) => c.fromNodeId === fromNodeId && c.toNodeId === toNodeId);
      if (exists) return state;
      return { connections: [...state.connections, { fromNodeId, toNodeId }] };
    }),

  disconnectNodes: (fromNodeId, toNodeId) =>
    set((state) => {
      if (isLocked(state)) return state;
      const armedBreakpoints = new Set(state.armedBreakpoints);
      armedBreakpoints.delete(connectionKey(fromNodeId, toNodeId));
      return {
        connections: state.connections.filter((c) => !(c.fromNodeId === fromNodeId && c.toNodeId === toNodeId)),
        armedBreakpoints,
      };
    }),

  createGroup: ({ name, nodeIds, draggedNodeId, draggedPosition, skipConfirmOnDrop }) => {
    if (isLocked(get())) return '';
    const id = `g-${randomId()}`;
    set((state) => {
      let groups = state.groups
        .map((g) => ({
          ...g,
          nodeIds: g.nodeIds.filter((nid) => !nodeIds.includes(nid)),
        }))
        .filter((g) => g.nodeIds.length >= 2);

      const nodePositions = {
        ...state.nodePositions,
        [draggedNodeId]: draggedPosition,
      };
      const frame = expandedGroupFrame(nodeIds, nodePositions);
      const group: NodeGroup = {
        id,
        name: name.trim() || 'Group',
        nodeIds: sortGroupMemberIds(nodeIds, nodePositions),
        collapsed: false,
        position: frame?.position ?? draggedPosition,
        skipConfirmOnDrop: skipConfirmOnDrop ?? false,
      };
      groups = [...groups, group];
      return { groups, nodePositions };
    });
    return id;
  },

  joinGroup: (groupId, nodeId, position, opts) =>
    set((state) => {
      if (isLocked(state)) return state;
      const target = state.groups.find((g) => g.id === groupId);
      if (!target || target.nodeIds.includes(nodeId)) return state;

      let groups = state.groups
        .map((g) =>
          g.id === groupId ? g : { ...g, nodeIds: g.nodeIds.filter((id) => id !== nodeId) }
        )
        .filter((g) => g.id === groupId || g.nodeIds.length >= 2);

      const memberObstacles = Object.entries(state.nodePositions)
        .filter(([id]) => id !== nodeId && !target.nodeIds.includes(id))
        .map(([, pos]) => pos);
      // Keep the drop position relative to groupmates (may stay tight/overlapping);
      // only nudge clear of nodes *outside* this group.
      const settled = findOpenPosition(position, memberObstacles);
      const nodePositions = { ...state.nodePositions, [nodeId]: settled };

      groups = groups.map((g) => {
        if (g.id !== groupId) return g;
        const nodeIds = sortGroupMemberIds([...g.nodeIds, nodeId], nodePositions);
        const frame = expandedGroupFrame(nodeIds, nodePositions);
        return {
          ...g,
          nodeIds,
          position: frame?.position ?? g.position,
          skipConfirmOnDrop: opts?.skipConfirmOnDrop ?? g.skipConfirmOnDrop,
        };
      });

      return { groups, nodePositions };
    }),

  ungroup: (groupId) =>
    set((state) => {
      if (isLocked(state)) return state;
      return { groups: state.groups.filter((g) => g.id !== groupId) };
    }),

  removeFromGroup: (groupId, nodeId) =>
    set((state) => {
      if (isLocked(state)) return state;
      const group = state.groups.find((g) => g.id === groupId);
      if (!group || !group.nodeIds.includes(nodeId)) return state;

      const remainingIds = group.nodeIds.filter((id) => id !== nodeId);
      const groups = state.groups
        .map((g) => (g.id === groupId ? { ...g, nodeIds: remainingIds } : g))
        .filter((g) => g.nodeIds.length >= 2);

      // If the released card still overlaps a former groupmate, nudge it
      // clear so the expanded frame no longer wraps it and the next
      // drag-end doesn't immediately re-offer "join this group".
      const nodePositions = { ...state.nodePositions };
      const pos = nodePositions[nodeId];
      if (pos && remainingIds.length > 0) {
        const obstacles = Object.entries(nodePositions)
          .filter(([id]) => id !== nodeId)
          .map(([, p]) => p);
        nodePositions[nodeId] = findOpenPosition(pos, obstacles);
      }

      // Re-anchor remaining group's chrome if it survived.
      const nextGroups = groups.map((g) => {
        if (g.id !== groupId) return g;
        const frame = expandedGroupFrame(g.nodeIds, nodePositions);
        return { ...g, position: frame?.position ?? g.position };
      });

      return { groups: nextGroups, nodePositions };
    }),

  setGroupCollapsed: (groupId, collapsed) =>
    set((state) => {
      if (isLocked(state)) return state;
      return {
        groups: state.groups.map((g) => {
          if (g.id !== groupId) return g;
          const frame = expandedGroupFrame(g.nodeIds, state.nodePositions);
          return { ...g, collapsed, position: frame?.position ?? g.position };
        }),
      };
    }),

  setGroupName: (groupId, name) =>
    set((state) => {
      if (isLocked(state)) return state;
      return {
        groups: state.groups.map((g) => (g.id === groupId ? { ...g, name: name.trim() || 'Group' } : g)),
      };
    }),

  moveGroup: (groupId, position) =>
    set((state) => {
      const group = state.groups.find((g) => g.id === groupId);
      if (!group) return state;
      // Expanded chrome is derived from member bounds each render — delta
      // against that frame origin, not a possibly-stale stored position.
      const frame = group.collapsed ? null : expandedGroupFrame(group.nodeIds, state.nodePositions);
      const origin = group.collapsed ? group.position : (frame?.position ?? group.position);
      const dx = position.x - origin.x;
      const dy = position.y - origin.y;
      if (dx === 0 && dy === 0) return state;
      const nodePositions = { ...state.nodePositions };
      for (const nid of group.nodeIds) {
        const pos = nodePositions[nid];
        if (pos) nodePositions[nid] = { x: pos.x + dx, y: pos.y + dy };
      }
      return {
        nodePositions,
        groups: state.groups.map((g) => (g.id === groupId ? { ...g, position } : g)),
      };
    }),
});
