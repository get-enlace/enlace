import type { WorkflowNode } from '../types.js';

/**
 * A `kind: 'presets'` collection has no `operationId` at all — `undefined`
 * in that case, same as a missing node (e.g. an ancestor picked as a "map
 * from…" source that no longer exists on the canvas) or a plain missing
 * `operationId`. Shared by workflowDocument.ts's import/export walk and
 * NodeConfig's own operation lookups — previously two copies of the same
 * one-liner.
 */
export function operationIdOf(node: WorkflowNode | undefined): string | undefined {
  return node && node.kind !== 'presets' ? node.operationId : undefined;
}
