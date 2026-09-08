import Chance from 'chance';
import JSON5 from 'json5';
import { embedAsStringFragment } from '../bodyTags.js';

/**
 * One shared instance for the whole engine. Chance is stateless generation
 * (no seed is ever configured), so there's nothing gained by minting a new
 * instance per call — this just avoids the allocation.
 */
const chance = new Chance();

/**
 * Matches a `$rand.<method>(<args>)` call anywhere in text — e.g.
 * `$rand.first()`, `$rand.integer({min: 1, max: 90})`. Deliberately not a
 * `{{enlace:<id>}}` tag (see bodyTags.ts): unlike every other tag type,
 * this carries everything it needs to resolve right there in the
 * expression — no id, no side-table entry, nothing to look up — so it's
 * resolved as its own independent pass over plain text rather than folded
 * into the tag registry.
 *
 * `<method>` is matched as a bare identifier; `<args>` as everything up to
 * the next `)` — deliberately not nesting-aware, so an arg value that
 * itself contains a literal `)` (e.g. inside a string) will mis-parse.
 * Every real Chance option is a flat `{...}` of primitives, so this is a
 * pragmatic limit, not a real-world one — same trade-off `tagPattern`
 * itself already makes for its own syntax.
 *
 * A *factory*, not a shared constant — see `tagPattern`'s own comment for
 * why a global-flag `RegExp`'s mutable `lastIndex` makes that unsafe to
 * share.
 */
export function randomExprPattern(): RegExp {
  return /\$rand\.([a-zA-Z_$][\w$]*)\(([^()]*)\)/g;
}

/** Cheap guard so callers can skip the regex machinery for the overwhelming majority of values that never reference `$rand` at all. */
function mightContainRandomExpr(text: string): boolean {
  return text.includes('$rand.');
}

function parseArgs(method: string, argsText: string): unknown[] {
  const trimmed = argsText.trim();
  if (!trimmed) return [];
  try {
    // JSON5, not JSON.parse: a hand-typed arg block already sits inside an
    // existing JSON string's quotes, so requiring strict JSON (quoted
    // keys, no trailing commas) would force escaping every `"` — exactly
    // the friction this feature exists to remove. `{min: 1, max: 90}`
    // parses as-is; wrapping in `[...]` also uniformly covers the
    // zero-arg and multi-positional-arg cases as one parse.
    return JSON5.parse(`[${trimmed}]`);
  } catch (err) {
    throw new Error(`Couldn't parse arguments for "$rand.${method}(...)": ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Calls the named method on the shared Chance instance directly — this
 * engine defines no generator catalog of its own, deliberately: any method
 * Chance exposes today (or adds/renames in a future version) works here
 * with no mapping to keep in sync, at the cost of a version bump being
 * able to break a saved `$rand.<method>(...)` expression that named a
 * method Chance itself removed. Throws either way rather than silently
 * substituting a placeholder, same as every other body-resolution failure
 * in this engine.
 */
function callRandomMethod(method: string, argsText: string): unknown {
  const fn = (chance as unknown as Record<string, unknown>)[method];
  if (typeof fn !== 'function') {
    throw new Error(`"$rand.${method}()" isn't a Chance method — see https://chancejs.com for the current list.`);
  }
  const args = parseArgs(method, argsText);
  return (fn as (...a: unknown[]) => unknown).apply(chance, args);
}

/**
 * Resolves every `$rand.method(args)` call inside a Raw JSON body/path/
 * query template's raw text — same whole-string-vs-embedded distinction
 * engine/rawBodyResolver.ts's tag loop uses (a call that's the *entire*
 * content of its surrounding string gets the value's real JSON type;
 * embedded in a larger string, it gets spliced in as escaped text).
 *
 * Runs as an independent pass over the plain template text *before*
 * rawBodyResolver.ts's own `{{enlace:<id>}}` tag loop — the two syntaxes
 * never overlap, so sequencing them is safe, and this one needs no access
 * to `RawBody.tags` at all. Called fresh on every `resolveRawBody`
 * invocation, i.e. every chain run — see resolveRawBody's own doc for why
 * that's the point, not an oversight.
 */
export function resolveRandomExpressionsInRawText(text: string): string {
  if (!mightContainRandomExpr(text)) return text;

  let result = '';
  let lastIndex = 0;
  for (const match of text.matchAll(randomExprPattern())) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const whole = text[start - 1] === '"' && text[end] === '"';
    const spanStart = whole ? start - 1 : start;
    const spanEnd = whole ? end + 1 : end;

    const value = callRandomMethod(match[1], match[2]);
    const replacement = whole ? JSON.stringify(value) : embedAsStringFragment(value);

    result += text.slice(lastIndex, spanStart) + replacement;
    lastIndex = spanEnd;
  }
  return result + text.slice(lastIndex);
}

/**
 * The full list of callable generator methods on this engine's Chance
 * instance, read off the live prototype rather than hand-maintained — the
 * whole point being that a Chance version bump (a renamed/added/removed
 * method) is reflected here automatically, with nothing in this codebase
 * to fall out of sync. Used by @get-enlace/ui's Raw-mode editor to build
 * the `$rand.` autocomplete list. `mixin`/`set`/`get`/constructor-ish
 * entries and anything starting with `_` are filtered out as plumbing, not
 * generators a user would ever want to call.
 */
export function listRandomMethodNames(): string[] {
  const proto = Object.getPrototypeOf(chance);
  const skip = new Set(['constructor', 'mixin', 'set', 'get', 'seed', 'random']);
  return Object.getOwnPropertyNames(proto)
    .filter((name) => !name.startsWith('_') && !skip.has(name) && typeof (chance as unknown as Record<string, unknown>)[name] === 'function')
    .sort();
}

/**
 * Best-effort argument-skeleton hints for the handful of Chance methods a
 * body fill actually reaches for — purely a starting point inserted by the
 * editor's autocomplete (see @get-enlace/ui's RawBodyEditor.tsx), never
 * consulted by resolution itself. Deliberately small and hand-maintained:
 * unlike `listRandomMethodNames`, staleness here (Chance changing one of
 * these methods' options) only means a suggested skeleton is slightly
 * wrong — the user edits it same as any snippet — never a broken or
 * missing completion, so the maintenance-drift risk that rules out a
 * hand-maintained *method list* doesn't apply to hints.
 */
export const RANDOM_METHOD_ARG_HINTS: Record<string, string> = {
  integer: '{min: 0, max: 100}',
  floating: '{min: 0, max: 100, fixed: 2}',
  natural: '{min: 0, max: 100}',
  string: '{length: 10}',
  guid: '',
  bool: '{likelihood: 50}',
  first: '',
  last: '',
  name: '',
  email: '',
  phone: '',
  city: '',
  country: '',
  address: '',
  zip: '',
  url: '',
  word: '',
  paragraph: '',
  date: '{year: 2024}',
  age: '',
  company: '',
  pickone: '["a", "b", "c"]',
};
