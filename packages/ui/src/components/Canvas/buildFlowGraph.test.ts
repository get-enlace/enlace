import { describe, it, expect } from 'vitest';
import { buildFlowEdges } from './buildFlowGraph.js';
import type { OperationNode, RawBody } from '../../types.js';

function opNode(id: string, overrides: Partial<OperationNode> = {}): OperationNode {
  return { id, kind: 'operation', operationId: 'GET /widgets', credentialId: null, ...overrides };
}

function rawBodyWithTag(sourceNodeId: string): RawBody {
  return {
    template: '{"id":"{{enlace:tag1}}"}',
    tags: { tag1: { id: 'tag1', type: 'response_body', sourceNodeId, jsonPath: 'id' } },
  };
}

describe('buildFlowEdges', () => {
  it('draws an animated mapping edge for a tag chip in any raw section, not just the body', () => {
    const a = opNode('a');
    for (const section of ['rawPath', 'rawQuery', 'rawHeaders', 'rawBody'] as const) {
      const b = opNode('b', { [section]: rawBodyWithTag('a') });
      const edges = buildFlowEdges({
        nodes: [a, b],
        connections: [],
        groups: [],
        collapsedMemberIds: new Set(),
        armedBreakpoints: new Set(),
        selectedEdgeId: null,
      });
      const mappingEdges = edges.filter((e) => e.className === 'edge-mapping');
      expect(mappingEdges).toHaveLength(1);
      expect(mappingEdges[0]).toMatchObject({ source: 'a', target: 'b', animated: true });
    }
  });

  it('draws one edge per tag, even when multiple sections map from the same ancestor', () => {
    const a = opNode('a');
    const b = opNode('b', { rawPath: rawBodyWithTag('a'), rawBody: rawBodyWithTag('a') });
    const edges = buildFlowEdges({
      nodes: [a, b],
      connections: [],
      groups: [],
      collapsedMemberIds: new Set(),
      armedBreakpoints: new Set(),
      selectedEdgeId: null,
    });
    expect(edges.filter((e) => e.className === 'edge-mapping')).toHaveLength(2);
  });

  it('draws no mapping edge for an uploaded_file tag (no sourceNodeId to map from)', () => {
    const a = opNode('a');
    const b = opNode('b', {
      rawBody: {
        template: '{"photo":"{{enlace:tag1}}"}',
        tags: { tag1: { id: 'tag1', type: 'uploaded_file', fileName: 'photo.png' } },
      },
    });
    const edges = buildFlowEdges({
      nodes: [a, b],
      connections: [],
      groups: [],
      collapsedMemberIds: new Set(),
      armedBreakpoints: new Set(),
      selectedEdgeId: null,
    });
    expect(edges.filter((e) => e.className === 'edge-mapping')).toHaveLength(0);
  });

  it('draws no mapping edge when a node has no raw sections at all', () => {
    const a = opNode('a');
    const b = opNode('b');
    const edges = buildFlowEdges({
      nodes: [a, b],
      connections: [],
      groups: [],
      collapsedMemberIds: new Set(),
      armedBreakpoints: new Set(),
      selectedEdgeId: null,
    });
    expect(edges.filter((e) => e.className === 'edge-mapping')).toHaveLength(0);
  });
});
