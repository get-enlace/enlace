// Relative — resolves under whatever path this bundle is served from,
// whether that's the Vite dev server (proxied, see vite.config.ts) or the
// adapter's mount path in a real host app.
const API_BASE = 'api';

/**
 * The raw OpenAPI document, unparsed — the adapter just passes it through
 * (see @get-enlace/express's `loadSpec`). Parsing it into the Operation[]
 * shape this app actually works with happens client-side, via
 * engine/specParser.ts's `parseOperations()`, since that's where execution
 * itself now runs too.
 *
 * `specUrl` is `res.url` — the fetch's own resolved, absolute URL for the
 * document, following any redirect. types.ts's `resolveBaseUrl` needs this:
 * per the OpenAPI Server Object rules, a relative `servers[].url` (or the
 * spec's own default of `/` when `servers` is missing) resolves against
 * "the location where the document is being served" — that's this fetch's
 * URL, not `window.location` (wherever the SPA route happens to be, which
 * isn't necessarily the same thing once an adapter sits behind a
 * path-prefixing reverse proxy).
 */
export async function fetchSpec(): Promise<{ spec: Record<string, any>; specUrl: string }> {
  const res = await fetch(`${API_BASE}/spec`);
  if (!res.ok) throw new Error(`Failed to load spec: ${res.status}`);
  return { spec: await res.json(), specUrl: res.url };
}
