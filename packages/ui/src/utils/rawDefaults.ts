import type { Operation, RawBody } from '../types.js';
import { buildSchemaExample } from './schemaExample.js';

export type ParamSection = 'path' | 'query' | 'header';

/**
 * A fresh Raw JSON skeleton for a path/query/header section — every param
 * this operation declares for that section gets a blank string entry, so
 * the editor opens with something to fill in rather than an empty `{}` the
 * user has to reconstruct by hand. `null` when the operation declares no
 * params for this section at all (nothing for NodeConfig.tsx to show).
 */
export function buildDefaultRawParams(section: ParamSection, operation: Operation): RawBody | null {
  const names = operation.parameters.filter((p) => p.in === section).map((p) => p.name);
  if (names.length === 0) return null;
  const target = Object.fromEntries(names.map((name) => [name, '']));
  return { template: JSON.stringify(target, null, 2), tags: {} };
}

/**
 * A fresh Raw JSON skeleton for the request body — the full nested example
 * `buildSchemaExample` produces from the schema (required leaves get a
 * real stub value, optional ones `null`; see that function's own doc).
 * `null` when the operation has no request body at all.
 */
export function buildDefaultRawBody(operation: Operation): RawBody | null {
  if (!operation.requestBodySchema) return null;
  const example = buildSchemaExample(operation.requestBodySchema);
  return { template: JSON.stringify(example, null, 2), tags: {} };
}
