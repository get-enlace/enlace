import { resolveRandomExpressionsInValue } from '@get-enlace/core';
import type { Operation, FieldValue, RawBody } from '../types.js';
import { flattenRequestFields } from './flattenSchema.js';
import { buildRandomSchemaExample } from './schemaExample.js';

/**
 * A Chance method name guessed purely from a field's type/format — no
 * name-based heuristic (deliberately removed: matching a field's *name*
 * to a generator, e.g. `email` -> `email()`, was wrong often enough on
 * real-world schemas to be worse than a plain type-shaped fallback).
 */
function guessByType(schema: { type?: string; format?: string }): string {
  if (schema.format === 'date' || schema.format === 'date-time') return 'date()';
  if (schema.format === 'uuid') return 'guid()';
  if (schema.format === 'email') return 'email()';
  if (schema.format === 'uri' || schema.format === 'url') return 'url()';
  switch (schema.type) {
    case 'integer':
      return 'integer()';
    case 'number':
      return 'floating()';
    case 'boolean':
      return 'bool()';
    default:
      return 'word()';
  }
}

/**
 * One concrete, correctly-typed value for a schema — resolved through
 * Chance right now (via @get-enlace/core's own resolver, rather than
 * reaching for `chance` directly, which this package doesn't depend on)
 * so the *real* generated type comes back untouched: an actual `boolean`
 * for `bool()`, an actual `number` for `integer()`/`floating()`, never
 * stringified. `date()` is the one method whose native Chance return type
 * (a JS `Date`) isn't itself the right static value — OpenAPI's
 * `date`/`date-time` formats are strings, and a raw `Date` would render as
 * its verbose `toString()` in a static text field — so that one case gets
 * converted to the ISO shape the schema actually asked for.
 */
function generateRandomValue(schema: { type?: string; format?: string }): unknown {
  const value = resolveRandomExpressionsInValue(`$rand.${guessByType(schema)}`);
  if (value instanceof Date) return schema.format === 'date' ? value.toISOString().slice(0, 10) : value.toISOString();
  return value;
}

/** A field/schema's fill-in value for the dice-icon bulk fill: one of its own declared enum values when it has one (Chance has no notion of an API-specific enum), otherwise a generated value via `generateRandomValue`. */
function generateFieldValue(schema: { type?: string; format?: string; enum?: unknown[] }): unknown {
  if (schema.enum?.length) return schema.enum[Math.floor(Math.random() * schema.enum.length)];
  return generateRandomValue(schema);
}

/**
 * One-shot "fill the whole body with random data" — every supported,
 * *required* body leaf becomes a `source: 'static'` field seeded with a
 * concrete generated value, fully editable afterward same as any other
 * static field; an optional leaf is left `null` rather than guessed, since
 * an unopinionated bulk fill has no business deciding a field the caller
 * didn't ask for should be sent at all. `onlyEmpty` limits this to leaves
 * that don't already have a field value at all (or are `static` with an
 * empty/undefined value), so re-running the action doesn't clobber fields
 * the user already set deliberately (mapped, attached files, or a static
 * value they typed).
 */
export function fillBodyWithRandomData(
  operation: Operation,
  existingFieldValues: Record<string, FieldValue>,
  onlyEmpty: boolean
): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  for (const field of flattenRequestFields(operation)) {
    if (!field.supported || !field.path.startsWith('body.') || field.format === 'binary') continue;
    // An array field is edited as one whole JSON-literal value (see
    // NodeConfig.tsx's textarea branch), not a single generator call —
    // out of scope for this heuristic fill; a nested object has no field
    // of its own at all (flattenRequestFields only emits its scalar
    // descendants), so there's nothing to skip for that case.
    if (field.type === 'array') continue;

    const existing = existingFieldValues[field.path];
    const isEmpty = !existing || (existing.source === 'static' && (existing.value === '' || existing.value === undefined));
    if (onlyEmpty && !isEmpty) continue;

    out[field.path] = { source: 'static', value: field.required ? generateFieldValue(field) : null };
  }
  return out;
}

/**
 * Raw mode's counterpart to `fillBodyWithRandomData` above — same "Fill
 * with random data" action, but Raw mode has no flat field list to iterate
 * (its whole point is representing shapes the form can't), so this walks
 * the schema directly via `buildRandomSchemaExample` instead, guessing
 * each required scalar leaf with the exact same type heuristic Form mode
 * uses (optional leaves come back `null` — see that function's own doc).
 * Full overwrite, same "overwrites whatever's already there" contract as
 * the Form-mode button — any existing tag chips (mapped fields, uploaded
 * files) are discarded along with the rest of the old template, so the
 * result carries no tags of its own.
 */
export function fillRawBodyWithRandomData(operation: Operation): RawBody {
  const example = buildRandomSchemaExample(operation.requestBodySchema, generateRandomValue);
  const target = typeof example === 'object' && example !== null ? example : {};
  return { template: JSON.stringify(target, null, 2), tags: {} };
}
