// Standalone so both chainExecutor.ts and nodeHandlers.ts can depend on it
// without depending on each other — chainExecutor.ts re-exports this name
// (see its own imports) so `import { getByPath } from './chainExecutor.js'`
// keeps working for every existing caller/test.

/** Minimal dot/bracket path getter, e.g. "items[0].id" or "order.id". */
export function getByPath(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  const parts = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);

  let current: any = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}
