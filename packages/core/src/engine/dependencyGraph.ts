import type { WorkflowConnection, WorkflowNode } from '../types.js';

/**
 * The dependency graph every execution-order computation in this package
 * shares: for each node, the set of node ids that must complete before it
 * can run — explicit `WorkflowConnection`s (order only, e.g. a node with no
 * mapped fields that still needs to run in a particular slot), plus every
 * other reference into a prior step's result (credentialExtraParamOverrides,
 * assert checks — both below).
 *
 * A Raw JSON section's own tag-chip mappings (path/query/headers/body —
 * see RawBodyEditor.tsx) deliberately contribute no edge here: unlike the
 * old per-leaf Form-mode `fieldValues` this replaced, a tag can only ever
 * reference a node already offered by this same graph (`computeAncestors`
 * below feeds the "map from…" picker's candidate list), so its source is
 * always already an explicit-connection ancestor by construction — adding
 * a second edge for it would be redundant, not additive.
 *
 * Consumed by chainExecutor.ts's level-grouping and per-node readiness
 * scheduling, and by `computeAncestors` below for the Node Inspector's "Map
 * from…" picker — previously two independent copies of this exact union
 * logic (one in chainExecutor.ts, one inlined in utils/graph.ts); this is
 * the single shared implementation.
 */
export function buildDependencyGraph(
  nodes: WorkflowNode[],
  connections: WorkflowConnection[]
): Map<string, Set<string>> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const dependsOn = new Map<string, Set<string>>();
  for (const node of nodes) dependsOn.set(node.id, new Set());

  // Explicit connections (order only, no data — e.g. a node with no mapped
  // fields that still needs to run in a particular slot).
  for (const { fromNodeId, toNodeId } of connections) {
    if (byId.has(fromNodeId) && dependsOn.has(toNodeId)) {
      dependsOn.get(toNodeId)!.add(fromNodeId);
    }
  }

  // Mapped credentialExtraParamOverrides — same "mapping implies its source
  // must run first" rule as fieldValues above, see WorkflowNode's own
  // comment on why this lives per-node rather than on the shared Credential.
  // Skipped entirely while the override is toggled off: an inert map
  // shouldn't force an ordering edge that only matters once it's live.
  for (const node of nodes) {
    if (node.kind === 'presets' || !node.credentialExtraParamOverridesEnabled) continue;
    for (const fieldValue of Object.values(node.credentialExtraParamOverrides ?? {})) {
      if (fieldValue.source === 'mapped' && byId.has(fieldValue.fromNodeId)) {
        dependsOn.get(node.id)!.add(fieldValue.fromNodeId);
      }
    }
  }

  // Assert presets' checks — same "a reference implies its source must run
  // first" rule, but the edge attaches to the *collection* node's own id:
  // a preset never participates in this graph individually (see Preset's
  // own comment), only its parent collection does. Unconditional, unlike
  // the two loops above — every AssertCheck.source is inherently a
  // reference to another step (no 'static' variant to gate on).
  for (const node of nodes) {
    if (node.kind !== 'presets') continue;
    for (const preset of node.presets ?? []) {
      if (preset.kind !== 'assert') continue;
      for (const check of preset.checks) {
        if (byId.has(check.source.sourceNodeId)) {
          dependsOn.get(node.id)!.add(check.source.sourceNodeId);
        }
      }
    }
  }

  return dependsOn;
}

/**
 * All nodes that come before `nodeId` in the workflow graph — i.e. valid
 * "map from" sources for it. Deliberately graph ancestry, not array
 * position: in A -> B -> C where B carries no data, C's ancestors are
 * {A, B} even though A isn't connected to C directly.
 */
export function computeAncestors(
  nodes: WorkflowNode[],
  connections: WorkflowConnection[],
  nodeId: string
): Set<string> {
  const dependsOn = buildDependencyGraph(nodes, connections);

  const ancestors = new Set<string>();
  const queue = [...(dependsOn.get(nodeId) ?? [])];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (ancestors.has(current)) continue;
    ancestors.add(current);
    queue.push(...(dependsOn.get(current) ?? []));
  }

  return ancestors;
}

/**
 * The mirror image of `computeAncestors`: every node that comes *after*
 * `nodeId` — i.e. everything that would need re-running if `nodeId`'s own
 * result turned out to be stale (see chainExecutor.ts's `previousRun`
 * staleness cascade). Built by inverting the same shared `dependsOn` graph
 * `computeAncestors` walks forward, so the two stay implicitly in sync with
 * whatever `buildDependencyGraph` considers an edge (explicit connections,
 * mapped credentialExtraParamOverrides, assert preset check sources) —
 * there's no second, separately-maintained notion of "depends on" here.
 */
export function computeDescendants(
  nodes: WorkflowNode[],
  connections: WorkflowConnection[],
  nodeId: string
): Set<string> {
  const dependsOn = buildDependencyGraph(nodes, connections);
  const dependedBy = new Map<string, Set<string>>();
  for (const node of nodes) dependedBy.set(node.id, new Set());
  for (const [id, deps] of dependsOn) {
    for (const dep of deps) dependedBy.get(dep)?.add(id);
  }

  const descendants = new Set<string>();
  const queue = [...(dependedBy.get(nodeId) ?? [])];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (descendants.has(current)) continue;
    descendants.add(current);
    queue.push(...(dependedBy.get(current) ?? []));
  }

  return descendants;
}
