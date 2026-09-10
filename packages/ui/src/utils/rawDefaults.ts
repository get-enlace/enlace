import type { Operation, RawBody, RawParamsSection } from '../types.js';
import { buildSchemaExample } from './schemaExample.js';

function blankField(): RawBody {
  return { template: '', tags: {} };
}

function blankFieldMap(names: string[]): Record<string, RawBody> {
  return Object.fromEntries(names.map((name) => [name, blankField()]));
}

/**
 * A fresh set of per-field skeletons for path *and* query params — one
 * independently-editable `RawBody` per declared name, namespaced under
 * `paths`/`queries` (see `RawParamsSection`'s own comment in
 * @get-enlace/core's types.ts for why the two stay separate rather than one
 * merged map: an operation declaring the same param name in both never
 * collides). `null` only when the operation declares neither — nothing for
 * NodeConfig.tsx to show. Otherwise both keys are always present, each
 * possibly an empty map.
 */
export function buildDefaultRawParams(operation: Operation): RawParamsSection | null {
  const pathNames = operation.parameters.filter((p) => p.in === 'path').map((p) => p.name);
  const queryNames = operation.parameters.filter((p) => p.in === 'query').map((p) => p.name);
  if (pathNames.length === 0 && queryNames.length === 0) return null;

  return { paths: blankFieldMap(pathNames), queries: blankFieldMap(queryNames) };
}

/**
 * A fresh set of per-field skeletons for the headers section — one blank
 * `RawBody` per declared header param. `null` when the operation declares
 * none (nothing for NodeConfig.tsx to show).
 */
export function buildDefaultRawHeaders(operation: Operation): Record<string, RawBody> | null {
  const names = operation.parameters.filter((p) => p.in === 'header').map((p) => p.name);
  return names.length > 0 ? blankFieldMap(names) : null;
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
