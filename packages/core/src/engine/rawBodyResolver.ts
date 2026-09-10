import type { BodyTag, RawBody, RunStep } from '../types.js';
import { embedAsStringFragment, isWholeStringMatch, resolveTagValue, tagPattern } from '../bodyTags.js';
import { resolveRandomExpressionsInRawText } from './randomExpr.js';

// A `File` has no JSON representation, so an `uploaded_file` tag can't be
// substituted with its real value the way every other tag is (below) — it's
// substituted with this instead, a distinctive marker that survives the
// JSON.parse below as an ordinary string, then gets swapped for the real
// `File` in a second pass (swapFileSentinels) once JSON.parse has produced
// a real object/array to attach it to — string substitution alone can't
// hand back a non-JSON value. Collision with a user's own literal text is
// the same theoretical (not practical) risk the `{{enlace:<id>}}` tag
// placeholder syntax itself already carries — the trailing tag id (a
// randomId()) is what actually makes each one unique.
const FILE_SENTINEL_PREFIX = '  enlace-file:';
const FILE_SENTINEL_SUFFIX = '  ';

function fileSentinel(tagId: string): string {
  return `${FILE_SENTINEL_PREFIX}${tagId}${FILE_SENTINEL_SUFFIX}`;
}

function fileSentinelTagId(value: string): string | null {
  if (!value.startsWith(FILE_SENTINEL_PREFIX) || !value.endsWith(FILE_SENTINEL_SUFFIX)) return null;
  return value.slice(FILE_SENTINEL_PREFIX.length, -FILE_SENTINEL_SUFFIX.length);
}

/**
 * Recursively swaps a resolved body's file sentinels for the real `File`
 * each one names. Only ever invoked when `resolveRawBody` was given a
 * `fileLookup` (see its own doc) — every sentinel reaching here is
 * therefore one this same function's caller inserted moments earlier, so a
 * missing tag/file here is a real, user-facing state (the file wasn't
 * re-selected after a reload/import — same situation Form mode's own file
 * fields already hit, see operationNodeHandler.ts's resolveFieldValue),
 * not a hypothetical.
 */
function swapFileSentinels(value: unknown, tags: Record<string, BodyTag>, fileLookup: (tagId: string) => File | undefined): unknown {
  if (typeof value === 'string') {
    const tagId = fileSentinelTagId(value);
    if (tagId === null) return value;
    const file = fileLookup(tagId);
    if (file) return file;
    const tag = tags[tagId];
    const fileName = tag && tag.type === 'uploaded_file' ? tag.fileName : tagId;
    throw new Error(`Re-select the file for "${fileName}" — file contents are not persisted.`);
  }
  if (Array.isArray(value)) return value.map((item) => swapFileSentinels(item, tags, fileLookup));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, swapFileSentinels(v, tags, fileLookup)]));
  }
  return value;
}

/**
 * Execution-time resolution of a Raw JSON body's tag chips against the
 * chain's already-captured responses. Every `{{enlace:<id>}}` occurrence
 * is replaced in place — with the resolved value's real JSON type
 * (object/array/number/boolean/null) when the tag is the *entire* content
 * of its surrounding string (see bodyTags.ts's `isWholeStringMatch`), or
 * as escaped text spliced into a larger string otherwise — then the whole
 * result is parsed as JSON, so callers always get real values or a clear
 * thrown error, never a half-substituted template.
 *
 * `fileLookup`, when passed, is what allows an `uploaded_file` tag to
 * appear in this body at all (see swapFileSentinels above for how it's
 * used) — only a multipart operation's body ever passes one
 * (operationNodeHandler.ts); calling this for a path/query raw section, or
 * for a non-multipart body, with no `fileLookup` and a template that still
 * contains a file tag throws immediately rather than letting a File
 * reference silently leak into a URL or a JSON payload that can't carry it.
 *
 * Throws (caught by chainExecutor.ts's existing buildRequest try/catch,
 * same as any other request-building failure) if a tag is unknown, its
 * source node hasn't produced a response yet, a referenced header is
 * missing, or an uploaded file was never (re-)selected — never silently
 * sends a placeholder.
 *
 * A `$rand.method(args)` call (engine/randomExpr.ts) is resolved first, as
 * a separate pass over the plain template text — it needs no tag registry
 * entry (unlike every `{{enlace:<id>}}` placeholder here, it carries
 * everything it needs to resolve inline, nothing to look up), and re-runs
 * fresh on every call to this function, i.e. every chain run, which is the
 * whole point: a workflow re-run after a downstream failure gets a new
 * random value rather than replaying whatever a prior run happened to
 * generate.
 */
export function resolveRawBody(
  rawBody: RawBody,
  stepsByNodeId: Map<string, RunStep>,
  nodeLabels?: Map<string, string>,
  fileLookup?: (tagId: string) => File | undefined
): unknown {
  const text = resolveRandomExpressionsInRawText(rawBody.template);
  let result = '';
  let lastIndex = 0;

  for (const match of text.matchAll(tagPattern())) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const tagId = match[1];
    const tag = rawBody.tags[tagId];
    if (!tag) throw new Error(`Body references unknown tag "${tagId}".`);

    const whole = isWholeStringMatch(text, start, end);
    // A whole-string match's surrounding quotes belong to the substitution
    // too — JSON.stringify(value) supplies its own quoting (or none, for
    // a number/boolean/null/object/array), so the original pair must be
    // consumed here rather than left behind around it.
    const spanStart = whole ? start - 1 : start;
    const spanEnd = whole ? end + 1 : end;

    if (tag.type === 'uploaded_file') {
      if (!fileLookup) {
        throw new Error('An uploaded-file mapping is only valid in the body of a multipart/form-data request.');
      }
      if (!whole) {
        throw new Error(
          `The uploaded-file mapping for "${tag.fileName}" must be its field's entire value, not embedded in other text.`
        );
      }
      result += text.slice(lastIndex, spanStart) + JSON.stringify(fileSentinel(tagId));
      lastIndex = spanEnd;
      continue;
    }

    const value = resolveTagValue(tag, stepsByNodeId, nodeLabels);
    const replacement = whole ? JSON.stringify(value) : embedAsStringFragment(value);

    result += text.slice(lastIndex, spanStart) + replacement;
    lastIndex = spanEnd;
  }
  result += text.slice(lastIndex);

  const parsed = JSON.parse(result);
  return fileLookup ? swapFileSentinels(parsed, rawBody.tags, fileLookup) : parsed;
}

/**
 * Execution-time resolution of one path/query/header *field*'s `RawBody` —
 * the per-field sibling of `resolveRawBody` above, for
 * `OperationNode.rawParams`/`rawHeaders` (see `RawBody`'s own doc in
 * types.ts for why these carry plain scalar text rather than JSON). No
 * surrounding quotes to consume and no final `JSON.parse` — a field is
 * never a JSON document, just a string with zero or more tag chips spliced
 * in.
 *
 * A template that's *entirely* one tag placeholder resolves to that tag's
 * real value, unchanged type — e.g. mapping a numeric id keeps it a number
 * until the caller (path/query/header substitution in
 * operationNodeHandler.ts) stringifies it. A placeholder mixed with literal
 * text (`"Bearer {{enlace:<id>}}"`, typed by hand around an inserted chip)
 * instead splices each resolved value in as plain text (`String(value)` —
 * no JSON escaping, since this is never parsed back as JSON).
 *
 * `uploaded_file` never reaches here — that tag type only ever makes sense
 * in a multipart body (see `resolveRawBody`'s own doc), and
 * FieldValueEditor.tsx never offers "Upload file" as an option for a
 * path/query/header field — so encountering one is a real bug, not a
 * reachable user state, and throws same as an unknown tag id would.
 *
 * Throws under the same conditions `resolveRawBody` does (unknown tag,
 * source node with no captured response yet, missing header) — caught by
 * the same buildRequest try/catch.
 */
export function resolveRawScalar(rawBody: RawBody, stepsByNodeId: Map<string, RunStep>, nodeLabels?: Map<string, string>): unknown {
  const text = resolveRandomExpressionsInRawText(rawBody.template);
  const matches = [...text.matchAll(tagPattern())];
  if (matches.length === 0) return text;

  function resolve(match: RegExpMatchArray): unknown {
    const tagId = match[1];
    const tag = rawBody.tags[tagId];
    if (!tag) throw new Error(`Field references unknown tag "${tagId}".`);
    if (tag.type === 'uploaded_file') {
      throw new Error('A file attachment is only valid in the body of a multipart/form-data request.');
    }
    return resolveTagValue(tag, stepsByNodeId, nodeLabels);
  }

  const whole = matches.length === 1 && matches[0].index === 0 && matches[0][0].length === text.length;
  if (whole) return resolve(matches[0]);

  let result = '';
  let lastIndex = 0;
  for (const match of matches) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    result += text.slice(lastIndex, start) + String(resolve(match));
    lastIndex = end;
  }
  return result + text.slice(lastIndex);
}
