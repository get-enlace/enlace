import { describe, expect, it } from 'vitest';
import { buildFromLastRunSeed, hasResumableFailure } from './runSlice.js';
import type { OperationNode, RunStep, WorkflowConnection, WorkflowNode } from '../../types.js';

function node(id: string, overrides: Partial<OperationNode> = {}): OperationNode {
  return { id, kind: 'operation', operationId: id, credentialId: null, ...overrides };
}

function step(nodeId: string, overrides: Partial<RunStep> = {}): RunStep {
  return {
    nodeId,
    request: { method: 'GET', url: `http://example.test/${nodeId}`, headers: {}, credentials: 'omit' },
    timestampStart: '2026-01-01T00:00:00.000Z',
    timestampEnd: '2026-01-01T00:00:01.000Z',
    ...overrides,
  };
}

describe('buildFromLastRunSeed', () => {
  it('returns undefined when there is no previous run to resume from', () => {
    expect(buildFromLastRunSeed([node('a')], [], null, null)).toBeUndefined();
    expect(buildFromLastRunSeed([node('a')], [], { steps: [step('a')] }, null)).toBeUndefined();
  });

  it('carries over a completed, unedited node and excludes a failed one', () => {
    const a = node('a');
    const nodesById = new Map([[a.id, a]]);
    const previousRunResult = { steps: [step('a'), step('b', { error: 'boom' })] };

    const seed = buildFromLastRunSeed([a], [], previousRunResult, nodesById);

    expect(seed?.steps.map((s) => s.nodeId)).toEqual(['a']);
  });

  it('excludes a node whose object reference changed since the last run (edited), even though it completed', () => {
    const originalA = node('a');
    const editedA = { ...originalA, rawBody: { template: '{}', tags: {} } };
    const lastRunNodesById = new Map([[originalA.id, originalA]]);
    const previousRunResult = { steps: [step('a')] };

    // Current nodes carry the edited object — a new reference, same id.
    const seed = buildFromLastRunSeed([editedA], [], previousRunResult, lastRunNodesById);

    expect(seed?.steps).toEqual([]);
  });

  it('cascades staleness to a downstream node, even though the downstream node itself never changed', () => {
    // a -> b: a's completed step is stale (edited); b never changed but
    // consumed a's now-stale output, so it must re-run too.
    const originalA = node('a');
    const b = node('b');
    const editedA = { ...originalA, rawBody: { template: '{}', tags: {} } };
    const connections: WorkflowConnection[] = [{ fromNodeId: 'a', toNodeId: 'b' }];
    const lastRunNodesById = new Map<string, WorkflowNode>([
      [originalA.id, originalA],
      [b.id, b],
    ]);
    const previousRunResult = { steps: [step('a'), step('b')] };

    const seed = buildFromLastRunSeed([editedA, b], connections, previousRunResult, lastRunNodesById);

    expect(seed?.steps).toEqual([]);
  });

  it('leaves an unrelated sibling branch alone when only one branch is stale', () => {
    // a -> b (edited, stale) and c -> d (untouched) are independent.
    const originalA = node('a');
    const editedA = { ...originalA, rawBody: { template: '{}', tags: {} } };
    const b = node('b');
    const c = node('c');
    const d = node('d');
    const connections: WorkflowConnection[] = [
      { fromNodeId: 'a', toNodeId: 'b' },
      { fromNodeId: 'c', toNodeId: 'd' },
    ];
    const lastRunNodesById = new Map<string, WorkflowNode>([
      [originalA.id, originalA],
      [b.id, b],
      [c.id, c],
      [d.id, d],
    ]);
    const previousRunResult = { steps: [step('a'), step('b'), step('c'), step('d')] };

    const seed = buildFromLastRunSeed([editedA, b, c, d], connections, previousRunResult, lastRunNodesById);

    expect(seed?.steps.map((s) => s.nodeId).sort()).toEqual(['c', 'd']);
  });

  it('treats a node as unedited when its content matches, even with a different object reference (e.g. restored from IndexedDB)', () => {
    // Simulates persistence/'s restoreRunResult: `nodes` and
    // `lastRunNodesById` come back from two independent deserializations,
    // so they can never be reference-equal even for a node nobody touched.
    const a = node('a');
    const restoredA: WorkflowNode = JSON.parse(JSON.stringify(a));
    const lastRunNodesById = new Map<string, WorkflowNode>([[a.id, restoredA]]);
    const previousRunResult = { steps: [step('a')] };

    const seed = buildFromLastRunSeed([a], [], previousRunResult, lastRunNodesById);

    expect(seed?.steps.map((s) => s.nodeId)).toEqual(['a']);
  });

  it('does not choke on a completed node removed from the workflow since the last run', () => {
    const a = node('a');
    const lastRunNodesById = new Map<string, WorkflowNode>([
      [a.id, a],
      ['removed', node('removed')],
    ]);
    const previousRunResult = { steps: [step('a'), step('removed')] };

    // 'removed' is no longer in `nodes` at all.
    const seed = buildFromLastRunSeed([a], [], previousRunResult, lastRunNodesById);

    expect(seed?.steps.map((s) => s.nodeId)).toEqual(['a']);
  });
});

describe('hasResumableFailure', () => {
  it('is false with no previous run at all', () => {
    expect(hasResumableFailure(null, [node('a')])).toBe(false);
  });

  it('is false when every node settled without error', () => {
    expect(hasResumableFailure({ steps: [step('a'), step('b')] }, [node('a'), node('b')])).toBe(false);
  });

  it('is true when a step recorded an error', () => {
    expect(hasResumableFailure({ steps: [step('a'), step('b', { error: 'boom' })] }, [node('a'), node('b')])).toBe(true);
  });

  it('is true when a node never got a step at all (skipped, paused, or newly added)', () => {
    expect(hasResumableFailure({ steps: [step('a')] }, [node('a'), node('b')])).toBe(true);
  });
});
