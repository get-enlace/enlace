import { getByPath } from './engine/path.js';
import type { ResponseBodyTagRef, RunStep } from './types.js';

/**
 * Matches a tag placeholder anywhere in a Raw JSON body's template text,
 * e.g. `{{enlace:abc123}}`. Always written by us sitting inside an
 * existing JSON string's quotes (see makeTagPlaceholder) — the pattern
 * itself doesn't know or care about quoting; callers that need to tell
 * "whole string" apart from "embedded in a larger string" use
 * `isWholeStringMatch` alongside this.
 *
 * A *factory*, not a shared constant: a global-flag `RegExp` carries
 * mutable `lastIndex` state, and `String.prototype.matchAll` starts from
 * whatever `lastIndex` currently holds rather than resetting it — a
 * stray `.exec()`/`.test()` call anywhere (including in tests) would
 * silently make every later `matchAll` skip leading matches. Callers get
 * a fresh instance each time instead of importing a stateful singleton.
 */
export function tagPattern(): RegExp {
  return /\{\{enlace:([a-zA-Z0-9_-]+)\}\}/g;
}

export function makeTagPlaceholder(tagId: string): string {
  return `{{enlace:${tagId}}}`;
}

/**
 * The synthetic `fieldPath`-like key an `uploaded_file` tag's actual `File`
 * is stored under in the same `uploadedFiles` map a Form-mode `source:
 * 'file'` field uses (joined with a node id the same way there —
 * `${nodeId}::${fieldPath}` — see operationNodeHandler.ts's
 * `resolveFieldValue` and the UI store's `uploadedFileKey`). A raw tag has
 * no real field path of its own, so this stands in for one; namespaced
 * under `body:tag:` so it can never collide with an actual body field path
 * (which never contains a `:`).
 */
export function rawFileTagFieldPath(tagId: string): string {
  return `body:tag:${tagId}`;
}

/**
 * True if `match` (found at `matchStart`..`matchStart + match.length` in
 * `text`) is the *entire* content of the JSON string it sits in — i.e.
 * immediately preceded and followed by a `"` with nothing else between
 * those quotes and the match. Used to decide whether a resolved value can
 * replace the whole string (preserving its real type — number/object/
 * array/null) or must be spliced into a larger string as text. Tag
 * placeholders are only ever inserted by our own editor/generator, always
 * immediately inside a pair of quotes, so a plain adjacent-character check
 * is enough — no need to parse the surrounding JSON.
 */
export function isWholeStringMatch(text: string, matchStart: number, matchEnd: number): boolean {
  return text[matchStart - 1] === '"' && text[matchEnd] === '"';
}

/**
 * Resolves a dot/bracket-index path against an already-parsed value, e.g.
 * `items[0].id`. Accepts (and strips) an optional leading `$.`/`$` so a
 * user-typed JSONPath-style filter like `$.items[0].id` works too — this
 * is not a full JSONPath implementation (no wildcards/filters/unions),
 * just `getByPath` (chainExecutor.ts) with that one bit of syntax
 * tolerated, since `getByPath` is the only path-resolution primitive
 * anywhere in this codebase and every other "map from..." feature already
 * uses it as-is.
 */
export function resolveJsonPath(value: unknown, path: string | undefined): unknown {
  if (!path) return value;
  const stripped = path.trim().replace(/^\$\.?/, '');
  return getByPath(value, stripped);
}

/**
 * Embeds a resolved value as text inside a larger string (the
 * "prefix-{{tag}}-suffix" case) — escaped the same way JSON.stringify
 * would escape it, minus the surrounding quotes it would normally add.
 * Only meaningful for scalar-ish values; an object/array embedded this way
 * stringifies via `String()`, same as any other JS string interpolation.
 * Shared by engine/rawBodyResolver.ts (a tag embedded in Raw JSON text) and
 * engine/randomExpr.ts (a `$rand.method()` call embedded in Raw JSON text)
 * — both splice a resolved value into a larger JSON string the same way.
 */
export function embedAsStringFragment(value: unknown): string {
  return JSON.stringify(String(value)).slice(1, -1);
}

/** Case-insensitive lookup into a response's headers map (HTTP header names are case-insensitive). */
export function getHeaderCaseInsensitive(headers: Record<string, string>, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return value;
  }
  return undefined;
}

/**
 * Resolves one tag's configured source against the chain's already-
 * captured responses. Used by engine/rawBodyResolver.ts (Raw JSON body
 * templates) and directly by an `AssertCheck.source` (types.ts). Throws
 * (never silently substitutes a placeholder) if the source node hasn't
 * produced a response yet, or a referenced header is missing.
 *
 * `nodeLabels` (from utils/nodeLabel.ts's `buildNodeLabels`) turns internal
 * node ids into the same names the canvas/chips show — error text is for
 * people, so a UUID must never appear in it.
 */
/**
 * `tag` is `ResponseBodyTagRef` (`ResponseBodyTag` minus `id`), not
 * `BodyTag` itself — this never reads `.id` (only meaningful as a
 * dictionary key in `RawBody.tags`), so widening the parameter lets a
 * directly-embedded reference that isn't stored in such a dictionary (an
 * `AssertCheck.source`, see types.ts) reuse this function with no
 * vestigial `id` field of its own. `ResponseBodyTag`, not `BodyTag`,
 * deliberately: an `uploaded_file` tag has no `sourceNodeId` to resolve
 * against a prior step at all — engine/rawBodyResolver.ts intercepts that
 * variant itself before ever reaching here (see its own comment), so this
 * function only ever needs to handle the four that do.
 */
export function resolveTagValue(
  tag: ResponseBodyTagRef,
  stepsByNodeId: Map<string, RunStep>,
  nodeLabels?: Map<string, string>
): unknown {
  const sourceLabel = nodeLabels?.get(tag.sourceNodeId) ?? 'an upstream step';
  const step = stepsByNodeId.get(tag.sourceNodeId);
  if (!step || !step.response) {
    throw new Error(`Can't map from "${sourceLabel}" — that step has no captured response yet.`);
  }

  switch (tag.type) {
    case 'response_body':
      return resolveJsonPath(step.response.body, tag.jsonPath);
    case 'response_raw':
      return step.response.body;
    case 'response_status':
      return step.response.status;
    case 'response_header': {
      const name = tag.headerName ?? '';
      const value = getHeaderCaseInsensitive(step.response.headers, name);
      if (value === undefined) {
        throw new Error(
          `Can't map header "${name}" from "${sourceLabel}" — that response has no such header.`
        );
      }
      return value;
    }
  }
}

