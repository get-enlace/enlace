import type { RunStep, RunStepRequest } from '../types.js';

/** An apiKey-in-query credential has no header to redact — its secret lives in `url` itself, named in `redactQueryParams` (see types.ts). Malformed/relative URLs fall back to the raw string rather than throwing inside the debug pane. */
export function redactUrl(url: string, paramNames: string[] | undefined): string {
  if (!paramNames || paramNames.length === 0) return url;
  try {
    const parsed = new URL(url);
    for (const name of paramNames) {
      if (parsed.searchParams.has(name)) parsed.searchParams.set(name, '[redacted]');
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Masks every header a credential actually injected (`redactHeaderNames` —
 * an apiKey-in-header credential names its own header, e.g. `X-Api-Key`,
 * not just `Authorization`) plus a literal `Authorization` match as a
 * defensive fallback for anything not flagged that way. Shared by the live
 * debug pane display and `persistence/`'s "safe to write to disk" copy —
 * the same redaction serves both, since disk is a strictly stricter bar
 * than the browser's own screen (see ARCHITECTURE.md's credentials-never-
 * touch-disk rule).
 */
export function redactRequest(request: RunStepRequest): RunStepRequest {
  const redactNames = new Set((request.redactHeaderNames ?? []).map((n) => n.toLowerCase()));
  return {
    ...request,
    url: redactUrl(request.url, request.redactQueryParams),
    headers: Object.fromEntries(
      Object.entries(request.headers).map(([key, value]) =>
        redactNames.has(key.toLowerCase()) || key.toLowerCase() === 'authorization'
          ? [key, '[redacted]']
          : [key, value]
      )
    ),
  };
}

/** `redactRequest`, recursively through a presets collection's `subSteps` — each sub-step has its own `request` to redact too (see `RunStep.subSteps`'s own comment). */
export function redactStep(step: RunStep): RunStep {
  return {
    ...step,
    request: redactRequest(step.request),
    ...(step.subSteps ? { subSteps: step.subSteps.map(redactStep) } : {}),
  };
}
