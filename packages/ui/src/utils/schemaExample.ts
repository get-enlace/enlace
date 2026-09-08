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
 * schema — this is what pre-fills the Raw JSON body editor (see
 * utils/rawDefaults.ts's `buildDefaultRawBody`, its only caller). Produces
 * *something* concrete for every shape, including ones flattenSchema.ts's
 * `flattenObjectSchema` can't cleanly enumerate as a flat field list
 * (oneOf/anyOf/allOf, which that function marks unsupported instead):
 * arrays get one example item, oneOf/anyOf take their first branch, allOf
 * is merged.
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
