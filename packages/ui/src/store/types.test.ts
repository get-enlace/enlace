import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveBaseUrl } from './types.js';

describe('resolveBaseUrl', () => {
  afterEach(() => vi.restoreAllMocks());

  it('honors an explicit absolute servers[0].url, ignoring specUrl entirely', () => {
    // The cross-origin case ARCHITECTURE.md documents as supported (CORS,
    // the cookie credential) — an absolute host is a deliberate signal,
    // never second-guessed against where the spec itself was served from.
    expect(resolveBaseUrl({ servers: [{ url: 'https://api.example.com' }] }, 'https://enlace.example.com/enlace/spec')).toBe(
      'https://api.example.com'
    );
  });

  it('defaults to the OpenAPI-spec-defined `/` when servers is missing, resolved against specUrl', () => {
    expect(resolveBaseUrl({}, 'https://host.example.com/service-a/enlace/spec')).toBe('https://host.example.com');
  });

  it('defaults the same way when servers is an empty array', () => {
    expect(resolveBaseUrl({ servers: [] }, 'https://host.example.com/enlace/spec')).toBe('https://host.example.com');
  });

  it('resolves a relative, rooted servers[0].url against specUrl\'s origin — surviving a reverse-proxy path prefix', () => {
    expect(
      resolveBaseUrl({ servers: [{ url: '/service-a' }] }, 'https://host.example.com/service-a/enlace/spec')
    ).toBe('https://host.example.com/service-a');
  });

  it('never leaves a trailing slash, so callers can concatenate an operation\'s leading-slash path directly', () => {
    expect(resolveBaseUrl({ servers: [{ url: '/' }] }, 'https://host.example.com/enlace/spec')).toBe(
      'https://host.example.com'
    );
  });

  it('warns and defaults to the first entry when multiple servers are declared', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = resolveBaseUrl(
      { servers: [{ url: 'https://prod.example.com' }, { url: 'https://staging.example.com' }] },
      'https://enlace.example.com/spec'
    );
    expect(result).toBe('https://prod.example.com');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('declares 2 servers'));
  });
});
