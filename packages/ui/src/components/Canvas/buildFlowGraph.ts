import { MarkerType, type Edge, type Node } from 'reactflow';
import { connectionKey } from '@get-enlace/core';
import type { NodeGroup, Operation, RunStepStatus, WorkflowConnection, WorkflowNode } from '../../types.js';
import {
  expandedGroupFrame,
  groupContainingNode,
  sortGroupMemberIds,
} from '../../utils/groupGeometry.js';
import { collapsedGroupSize } from '../../utils/nodePlacement.js';
import type { GroupMemberSummary, GroupNodeData } from './GroupNodeCard.js';
import type { WorkflowNodeData } from './WorkflowNodeCard.js';
import type { PresetsNodeData } from './PresetsNodeCard.js';

/**
 * Every ancestor node id a node's Raw JSON sections (path/query/headers/
 * body) map a value *from*, via a tag chip — the source of a "mapped data
 * flow" edge below. Deliberately not deduped: two tags mapping from the
 * same ancestor (e.g. path and body both pulling from the same upstream
 * response) draw two overlapping edges, same as two Form-mode mapped
 * fields used to.
 */
function mappedSourceNodeIds(node: WorkflowNode): string[] {
  if (node.kind !== 'operation') return [];
  const ids: string[] = [];
  // rawParams/rawHeaders are now one RawBody per field (see OperationNode's
  // own comments in types.ts) rather than one shared section — flatten
  // every field's tags alongside rawBody's own single section.
  const sections = [
    ...Object.values(node.rawParams?.paths ?? {}),
    ...Object.values(node.rawParams?.queries ?? {}),
    ...Object.values(node.rawHeaders ?? {}),
    ...(node.rawBody ? [node.rawBody] : []),
  ];
  for (const raw of sections) {
    for (const tag of Object.values(raw.tags)) {
      if (tag.type !== 'uploaded_file') ids.push(tag.sourceNodeId);
    }
  }
  return ids;
}

export function collapsedMemberIdSet(groups: NodeGroup[]): Set<string> {
  const ids = new Set<string>();
  for (const g of groups) {
    if (g.collapsed) for (const id of g.nodeIds) ids.add(id);
  }
  return ids;
}

export function buildFlowNodes(args: {
  groups: NodeGroup[];
  nodes: WorkflowNode[];
  nodePositions: Record<string, { x: number; y: number }>;
  operations: Operation[];
  selectedNodeId: string | null;
  stepStatusByNodeId: Record<string, RunStepStatus>;
  nodeLabels: Map<string, string>;
  collapsedMemberIds: Set<string>;
  /** Collapsed/expanded chrome for `kind: 'presets'` nodes — see WorkflowState's `presetsCollapsed`. */
  presetsCollapsed: Record<string, boolean>;
}): Node[] {
  const {
    groups,
    nodes,
    nodePositions,
    operations,
    selectedNodeId,
    stepStatusByNodeId,
    nodeLabels,
    collapsedMemberIds,
    presetsCollapsed,
  } = args;
  const result: Node[] = [];

  for (const g of groups) {
    if (g.collapsed) {
      const size = collapsedGroupSize(g.nodeIds.length);
      const members: GroupMemberSummary[] = sortGroupMemberIds(g.nodeIds, nodePositions).map((nodeId) => {
        const node = nodes.find((n) => n.id === nodeId);
        if (node?.kind === 'presets') {
          // Plain "Presets (N)" here, not the full per-preset summary
          // (nodeLabels' `Presets: Wait 1s · Wait 1s · …`) — a collapsed
          // group's mini-cluster row is a compact single line, and that
          // summary only grows less readable as presets are added. The full
          // detail still surfaces via `label`, used as this row's tooltip.
          return {
            nodeId,
            method: 'presets',
            path: `Presets (${node.presets?.length ?? 0})`,
            label: nodeLabels.get(nodeId) ?? nodeId,
            status: stepStatusByNodeId[nodeId],
          };
        }
        const operation = node ? operations.find((o) => o.id === node.operationId) : undefined;
        return {
          nodeId,
          method: operation?.method ?? 'get',
          path: operation?.path ?? '?',
          label: nodeLabels.get(nodeId) ?? nodeId,
          status: stepStatusByNodeId[nodeId],
        };
      });
      result.push({
        id: g.id,
        type: 'nodeGroup',
        position: g.position,
        zIndex: 5,
        data: {
          group: g,
          width: size.width,
          height: size.height,
          memberCount: g.nodeIds.length,
          members,
        } satisfies GroupNodeData,
      });
    } else {
      const frame = expandedGroupFrame(g.nodeIds, nodePositions);
      if (!frame) continue;
      result.push({
        id: g.id,
        type: 'nodeGroup',
        position: frame.position,
        zIndex: 0,
        // React Flow gives every node wrapper `pointer-events: all` as an
        // *inline* style (unconditionally, in its own NodeWrapper source) —
        // no external stylesheet rule, however specific, can win against
        // that short of `!important`. This node's box is the entire
        // expanded frame, not just its visible titlebar/border, so left
        // alone it silently ate every click landing in the empty space
        // between member cards — including a connector edge routed through
        // there, which is what this actually fixes. `style` is React
        // Flow's own supported per-node override (spread in after its
        // internal pointerEvents in that same style object), the sanctioned
        // way to beat it. `.node-group__titlebar` (GroupNodeCard.tsx) still
        // opts itself back in via styles/canvas.css, same as before — this
        // only changes where the default gets set.
        style: { pointerEvents: 'none' },
        data: {
          group: { ...g, position: frame.position },
          width: frame.width,
          height: frame.height,
          memberCount: g.nodeIds.length,
        } satisfies GroupNodeData,
      });
    }
  }

  for (const n of nodes) {
    const hidden = collapsedMemberIds.has(n.id);
    const owningGroup = groupContainingNode(groups, n.id);

    if (n.kind === 'presets') {
      result.push({
        id: n.id,
        type: 'presetsNode',
        position: nodePositions[n.id] ?? { x: 80, y: 80 },
        selected: n.id === selectedNodeId,
        hidden,
        zIndex: 2,
        data: {
          node: n,
          collapsed: presetsCollapsed[n.id] ?? false,
          selected: n.id === selectedNodeId,
          status: stepStatusByNodeId[n.id],
          groupId: owningGroup?.id,
          groupName: owningGroup?.name,
        } satisfies PresetsNodeData,
      });
      continue;
    }

    result.push({
      id: n.id,
      type: 'workflowNode',
      position: nodePositions[n.id] ?? { x: 80, y: 80 },
      selected: n.id === selectedNodeId,
      hidden,
      zIndex: 2,
      data: {
        node: n,
        operation: operations.find((o) => o.id === n.operationId),
        selected: n.id === selectedNodeId,
        status: stepStatusByNodeId[n.id],
        label: nodeLabels.get(n.id),
        groupId: owningGroup?.id,
        groupName: owningGroup?.name,
      } satisfies WorkflowNodeData,
    });
  }

  return result;
}

export function buildFlowEdges(args: {
  nodes: WorkflowNode[];
  connections: WorkflowConnection[];
  groups: NodeGroup[];
  collapsedMemberIds: Set<string>;
  armedBreakpoints: Set<string>;
  selectedEdgeId: string | null;
}): Edge[] {
  const { nodes, connections, groups, collapsedMemberIds, armedBreakpoints, selectedEdgeId } = args;
  const edges: Edge[] = [];
  const resolveEndpoint = (nodeId: string): string => {
    if (!collapsedMemberIds.has(nodeId)) return nodeId;
    const g = groupContainingNode(groups, nodeId);
    return g?.id ?? nodeId;
  };

  for (const node of nodes) {
    for (const fromNodeId of mappedSourceNodeIds(node)) {
      const source = resolveEndpoint(fromNodeId);
      const target = resolveEndpoint(node.id);
      if (source === target && groups.some((g) => g.id === source && g.collapsed)) continue;
      edges.push({
        id: `map-${fromNodeId}->${node.id}-${edges.length}`,
        source,
        target,
        className: 'edge-mapping',
        animated: true,
      });
    }
  }

  for (const c of connections) {
    const source = resolveEndpoint(c.fromNodeId);
    const target = resolveEndpoint(c.toNodeId);
    if (source === target && groups.some((g) => g.id === source && g.collapsed)) continue;
    edges.push({
      id: `conn-${c.fromNodeId}->${c.toNodeId}`,
      source,
      target,
      type: 'connection',
      className: 'edge-connection',
      markerEnd: { type: MarkerType.ArrowClosed, color: '#9aa0a6' },
      data: {
        fromNodeId: c.fromNodeId,
        toNodeId: c.toNodeId,
        armed: armedBreakpoints.has(connectionKey(c.fromNodeId, c.toNodeId)),
      },
    });
  }

  return edges.map((e) => ({ ...e, selected: e.id === selectedEdgeId }));
}
