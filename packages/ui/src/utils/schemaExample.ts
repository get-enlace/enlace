import { isArraySchema, isObjectSchema } from './flattenSchema.js';

type Schema = Record<string, any>;

/**
 * A genuinely empty default for a required scalar's stub — `0`/`false`/`""`
 * rather than flattenSchema.ts's `exampleScalarValue` (`0`/`true`/`"string"`).
 * That one is illustrative text for a Form-mode array field's tooltip/
 * placeholder ("here's the shape you'd type"), where a descriptive
 * "string" reads better than an empty one; this one is the actual value
 * Raw mode starts a required field at, which should look like "fill this
 * in" rather than a plausible-but-wrong value someone might ship as-is.
 * An enum still prefers its first declared value — that's a real, valid
 * option, not a placeholder.
 */
function emptyScalarValue(schema: Schema | undefined): unknown {
  if (schema?.enum?.length) return schema.enum[0];
  if (schema?.type === 'integer' || schema?.type === 'number') return 0;
  if (schema?.type === 'boolean') return false;
  return '';
}

/** `allOf` branches are shallow-merged into one synthetic object schema — good enough for the common "base + extension" pattern; conflicting keys just take the last branch's value. */
function mergeAllOf(schemas: Schema[]): Schema {
  const merged: Schema = { type: 'object', properties: {}, required: [] };
  for (const branch of schemas) {
    Object.assign(merged.properties, branch.properties ?? {});
    merged.required.push(...(branch.required ?? []));
    if (branch.type && !merged.type) merged.type = branch.type;
  }
  return merged;
}

/** Picks the branch a polymorphic schema's example is built from — always the first, since there's no runtime information to prefer one over another. */
function firstBranch(schema: Schema): Schema | undefined {
  return schema.oneOf?.[0] ?? schema.anyOf?.[0];
}

/**
 * Recursively builds a realistic nested JSON example from a request body
 * schema — this is what pre-fills the Raw JSON editor. Unlike
 * flattenSchema.ts's `flattenObjectSchema` (which stops at arrays and
 * disables oneOf/anyOf/allOf entirely, since those can't be represented as
 * flat form fields), this produces *something* concrete for every shape:
 * arrays get one example item, oneOf/anyOf take their first branch, allOf
 * is merged. That's the whole point of Raw mode — schema shapes the form
 * generator can't handle still get a usable starting point here.
 */
export function buildSchemaExample(schema: Schema | null | undefined): unknown {
  if (!schema) return null;

  if (schema.allOf?.length) return buildSchemaExample(mergeAllOf(schema.allOf));

  const branch = firstBranch(schema);
  if (branch) return buildSchemaExample(branch);

  if (isArraySchema(schema)) return [buildSchemaExample(schema.items)];

  if (isObjectSchema(schema)) {
    const example: Record<string, unknown> = {};
    // No `required` array at all means the schema gives no signal either
    // way — every property gets a real stub, same as always, rather than
    // reinterpreting "undeclared" as "optional" and nulling out an entire
    // skeleton whose author just never wrote a `required` list. Once a
    // schema *does* declare one, though, everything left off it is
    // genuinely optional — a placeholder value there (`"string"`, `0`)
    // reads as "the API expects this filled in", which isn't true and
    // just invites a field to be sent that didn't need to be.
    const required: string[] | undefined = schema.required;
    for (const [name, propSchema] of Object.entries<Schema>(schema.properties ?? {})) {
      example[name] = !required || required.includes(name) ? buildSchemaExample(propSchema) : null;
    }
    return example;
  }

  return emptyScalarValue(schema);
}

/**
 * Same recursive walk as `buildSchemaExample`, but every scalar leaf is
 * produced by `guessLeaf` (a `$rand.<method>()` expression — see
 * randomFill.ts's `fillRawBodyWithRandomData`, the only caller) instead of
 * a placeholder value, and *every* property is filled in, required or not
 * — the whole point of a "fill with random data" action is a fully
 * populated, ready-to-run body, not a "fill this in" skeleton, so there's
 * no reason to null out optional fields here the way `buildSchemaExample`
 * does. `guessLeaf` only ever sees the non-enum, non-file case: an enum
 * leaf gets one of its own declared values instead (Chance has no notion
 * of an API-specific enum), and a `format: 'binary'` leaf (file upload) is
 * left blank — same as Form mode's `fillBodyWithRandomData`, which skips
 * file fields entirely since there's no file to attach from a bulk-fill
 * action.
 */
export function buildRandomSchemaExample(
  schema: Schema | null | undefined,
  guessLeaf: (name: string | undefined, schema: Schema) => string,
  name?: string
): unknown {
  if (!schema) return null;

  if (schema.allOf?.length) return buildRandomSchemaExample(mergeAllOf(schema.allOf), guessLeaf, name);

  const branch = firstBranch(schema);
  if (branch) return buildRandomSchemaExample(branch, guessLeaf, name);

  if (isArraySchema(schema)) return [buildRandomSchemaExample(schema.items, guessLeaf)];

  if (isObjectSchema(schema)) {
    const example: Record<string, unknown> = {};
    for (const [propName, propSchema] of Object.entries<Schema>(schema.properties ?? {})) {
      example[propName] = buildRandomSchemaExample(propSchema, guessLeaf, propName);
    }
    return example;
  }

  if (schema.format === 'binary') return '';
  if (schema.enum?.length) return schema.enum[Math.floor(Math.random() * schema.enum.length)];
  return guessLeaf(name, schema);
}

/**
 * True if any property anywhere in the schema (recursively) is a shape
 * the flat form generator can't cleanly represent: a polymorphic
 * oneOf/anyOf/allOf, or an array of objects (form mode edits an array as
 * one opaque JSON-text blob, with no way to map a response value into a
 * specific item's field). Drives the Node Config's "suggest Raw mode"
 * banner — see NodeConfig.tsx.
 */
export function hasUnrepresentableShape(schema: Schema | null | undefined): boolean {
  if (!schema) return false;
  if (schema.oneOf?.length || schema.anyOf?.length || schema.allOf?.length) return true;

  if (isArraySchema(schema)) {
    const items = schema.items;
    if (isObjectSchema(items)) return true;
    return hasUnrepresentableShape(items);
  }

  if (isObjectSchema(schema)) {
    return Object.values<Schema>(schema.properties ?? {}).some(hasUnrepresentableShape);
  }

  return false;
}
