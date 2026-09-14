import { describe, expect, it } from 'vitest';
import { redactRequest, redactStep, redactUrl } from './redactRequest.js';
import type { RunStep, RunStepRequest } from '../types.js';

function request(overrides: Partial<RunStepRequest> = {}): RunStepRequest {
  return {
    method: 'GET',
    url: 'http://example.test/thing',
    headers: {},
    credentials: 'omit',
    ...overrides,
  };
}

describe('redactUrl', () => {
  it('returns the url unchanged with no param names', () => {
    expect(redactUrl('http://example.test/x?a=1', undefined)).toBe('http://example.test/x?a=1');
    expect(redactUrl('http://example.test/x?a=1', [])).toBe('http://example.test/x?a=1');
  });

  it('masks only the named query params', () => {
    const redacted = redactUrl('http://example.test/x?apiKey=secret&keep=1', ['apiKey']);
    expect(redacted).toBe('http://example.test/x?apiKey=%5Bredacted%5D&keep=1');
  });

  it('falls back to the raw string for an unparseable/relative url', () => {
    expect(redactUrl('/relative/path?apiKey=secret', ['apiKey'])).toBe('/relative/path?apiKey=secret');
  });
});

describe('redactRequest', () => {
  it('masks a literal Authorization header even with no redactHeaderNames (defensive fallback)', () => {
    const redacted = redactRequest(request({ headers: { Authorization: 'Bearer secret', 'X-Other': 'keep' } }));
    expect(redacted.headers).toEqual({ Authorization: '[redacted]', 'X-Other': 'keep' });
  });

  it('masks every header named in redactHeaderNames, not just Authorization', () => {
    const redacted = redactRequest(
      request({ headers: { 'X-Api-Key': 'secret-key', 'X-Other': 'keep' }, redactHeaderNames: ['X-Api-Key'] })
    );
    expect(redacted.headers).toEqual({ 'X-Api-Key': '[redacted]', 'X-Other': 'keep' });
  });

  it('matches header names case-insensitively', () => {
    const redacted = redactRequest(request({ headers: { 'x-api-key': 'secret-key' }, redactHeaderNames: ['X-Api-Key'] }));
    expect(redacted.headers).toEqual({ 'x-api-key': '[redacted]' });
  });

  it('redacts the url query params named in redactQueryParams', () => {
    const redacted = redactRequest(
      request({ url: 'http://example.test/x?apiKey=secret', redactQueryParams: ['apiKey'] })
    );
    expect(redacted.url).toBe('http://example.test/x?apiKey=%5Bredacted%5D');
  });

  it('leaves an unrelated header/body untouched', () => {
    const redacted = redactRequest(request({ headers: { 'Content-Type': 'application/json' }, body: { a: 1 } }));
    expect(redacted.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(redacted.body).toEqual({ a: 1 });
  });
});

describe('redactStep', () => {
  function step(overrides: Partial<RunStep> = {}): RunStep {
    return {
      nodeId: 'n1',
      request: request(),
      timestampStart: '2026-01-01T00:00:00.000Z',
      timestampEnd: '2026-01-01T00:00:01.000Z',
      ...overrides,
    };
  }

  it('redacts the step\'s own request', () => {
    const redacted = redactStep(step({ request: request({ headers: { Authorization: 'Bearer secret' } }) }));
    expect(redacted.request.headers).toEqual({ Authorization: '[redacted]' });
  });

  it('recurses into subSteps (a presets collection\'s own per-preset requests)', () => {
    const redacted = redactStep(
      step({
        subSteps: [step({ nodeId: 'n1::preset-1', request: request({ headers: { Authorization: 'Bearer secret' } }) })],
      })
    );
    expect(redacted.subSteps?.[0]?.request.headers).toEqual({ Authorization: '[redacted]' });
  });

  it('leaves response data untouched — it is the target API\'s own data, not an Enlace secret', () => {
    const redacted = redactStep(step({ response: { status: 200, headers: { 'set-cookie': 'x' }, body: { ok: true } } }));
    expect(redacted.response).toEqual({ status: 200, headers: { 'set-cookie': 'x' }, body: { ok: true } });
  });
});
