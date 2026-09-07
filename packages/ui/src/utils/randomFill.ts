import type { Operation, FieldValue, RawBody } from '../types.js';
import { flattenRequestFields, type SchemaField } from './flattenSchema.js';
import { buildRandomSchemaExample } from './schemaExample.js';

/**
 * Field-name/type heuristics -> a Chance method to pre-fill a `source:
 * 'random'` field with, expressed as the literal `$rand.<method>()` a user
 * would otherwise have typed by hand. Deliberately not exhaustive or
 * clever — a wrong (or missing) guess costs the user one edit, same as
 * picking "Random" from the source select and typing the expression
 * themselves; this exists purely to make the common case (a field
 * literally named `firstName`, `email`, …) need zero typing.
 */
const NAME_HEURISTICS: [RegExp, string][] = [
  [/(^|_)id$/, 'guid()'],
  [/(first.?name|given.?name)/, 'first()'],
  [/(last.?name|surname|family.?name)/, 'last()'],
  [/(full.?name|display.?name)|^name$/, 'name()'],
  [/email/, 'email()'],
  [/(phone|mobile)/, 'phone()'],
  [/(zip|postal)/, 'zip()'],
  [/city/, 'city()'],
  [/country/, 'country()'],
  [/address/, 'address()'],
  [/(url|website)/, 'url()'],
  [/age/, 'age()'],
  [/company/, 'company()'],
];

/** Last path segment, e.g. "body.customer.firstName" -> "firstname" (array indices stripped the same way). */
function normalizedFieldName(name: string): string {
  const segment = name.split(/[.[]/).pop() ?? name;
  return segment.replace(/\]$/, '').toLowerCase();
}

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
 * A Chance method name, guessed from a field's own name first (`email` ->
 * `email()`), falling back to its type/format when nothing matches.
 * Shared by both a Form field's guess (`guessRandomExpression`, below) and
 * Raw mode's whole-body fill (`fillRawBodyWithRandomData`) — the two need
 * the exact same heuristic, just applied to a `SchemaField` in one case and
 * a raw JSON-schema property in the other, so this takes only the bit both
 * shapes actually have: a name and a type/format.
 */
function guessMethod(name: string, schema: { type?: string; format?: string }): string {
  const key = normalizedFieldName(name);
  const hit = NAME_HEURISTICS.find(([pattern]) => pattern.test(key));
  return hit ? hit[1] : guessByType(schema);
}

/** The `$rand.<method>()` expression a "Random" field starts out with — either a name-based guess, or a type-based fallback when nothing matches. Always a real, callable Chance method (no args pre-filled — see RANDOM_METHOD_ARG_HINTS in @get-enlace/core for the editor's own snippet hints, not used here). */
export function guessRandomExpression(field: SchemaField): string {
  const name = field.path.split(/[.[]/).pop() ?? field.path;
  return `$rand.${guessMethod(name, field)}`;
}

/**
 * One-shot "fill the whole body with random data" — every supported body
 * leaf becomes a `source: 'random'` field seeded with a guessed
 * expression, fully editable afterward same as if the user had picked
 * "Random" from that field's own source select. `onlyEmpty` limits this to
 * leaves that don't already have a field value at all (or are `static`
 * with an empty/undefined value), so re-running the action doesn't clobber
 * fields the user already set deliberately (mapped, attached files, or a
 * static value they typed).
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

    out[field.path] = { source: 'random', expression: guessRandomExpression(field) };
  }
  return out;
}

/**
 * Raw mode's counterpart to `fillBodyWithRandomData` above — same "Fill
 * with random data" action, but Raw mode has no flat field list to iterate
 * (its whole point is representing shapes the form can't), so this walks
 * the schema directly via `buildRandomSchemaExample` instead, guessing
 * each scalar leaf with the exact same name/type heuristic Form mode uses.
 * Full overwrite, same "overwrites whatever's already there" contract as
 * the Form-mode button — any existing tag chips (mapped fields, uploaded
 * files) are discarded along with the rest of the old template, so the
 * result carries no tags of its own.
 */
export function fillRawBodyWithRandomData(operation: Operation): RawBody {
  const example = buildRandomSchemaExample(operation.requestBodySchema, (name, schema) => `$rand.${guessMethod(name ?? '', schema)}`);
  const target = typeof example === 'object' && example !== null ? example : {};
  return { template: JSON.stringify(target, null, 2), tags: {} };
}
