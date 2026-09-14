import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  computeExecutionLevels,
  connectionKey,
  CyclicWorkflowError,
  executeChain,
  topologicalSort,
} from './chainExecutor.js';
import { __clearCredentialTokenCacheForTests, resolveCredentialInjection } from './credentials.js';
import type { Credential, Operation, OperationNode, PresetsNode, RunControl, RunEvent, WorkflowConnection, WorkflowNode } from '../types.js';
import { buildRequest } from './handlers/index.js';
import { rawFileTagFieldPath } from '../bodyTags.js';

/** Flushes every currently-pending microtask (fetch mocks resolving, buildRequest's own promise chain, etc.) without advancing real time, so a paused/settled state has fully landed before assertions run. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function node(id: string): OperationNode {
  return { id, kind: 'operation', operationId: id, credentialId: null };
}

/** A minimal Operation whose `id` and `path` are both derived from `id`, so `operationsById.get(id)` and the mocked fetch's URL both key off the same identifier. */
function op(id: string, path: string): Operation {
  return {
    id,
    method: 'get',
    path,
    parameters: [],
    requestBodySchema: null,
    requestBodyContentType: null,
    responseSchema: null,
  };
}

function mockResponse(status: number, body: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
  } as unknown as Response;
}

describe('topologicalSort', () => {
  // An explicit WorkflowConnection is the only thing that implies an
  // ordering edge for a plain operation node now — a Raw JSON section's own
  // tag-chip mapping deliberately contributes none (see dependencyGraph.ts's
  // own doc: a tag can only ever pick a source already offered by this same
  // graph, so its source is always already an explicit-connection ancestor
  // by construction). credentialExtraParamOverrides and assert-preset
  // checks are the two mechanisms that still imply an edge with no explicit
  // connection drawn — see dependencyGraph.test.ts for that coverage.
  it('orders a node after an explicit connection', () => {
    const a = node('a');
    const b = node('b');
    const connections: WorkflowConnection[] = [{ fromNodeId: 'a', toNodeId: 'b' }];

    expect(topologicalSort([b, a], connections).map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('leaves independent nodes in their original relative order', () => {
    const a = node('a');
    const b = node('b');
    expect(topologicalSort([a, b]).map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('orders via explicit connections even when a middle node carries no data (A -> B -> C)', () => {
    const a = node('a');
    const b = node('b');
    const c = node('c');
    const connections: WorkflowConnection[] = [
      { fromNodeId: 'a', toNodeId: 'b' },
      { fromNodeId: 'b', toNodeId: 'c' },
    ];

    // Passed in a shuffled order to prove the connections (not array order) drive the sort.
    expect(topologicalSort([c, a, b], connections).map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('throws CyclicWorkflowError on a cyclic explicit connection', () => {
    const a = node('a');
    const b = node('b');
    const connections: WorkflowConnection[] = [
      { fromNodeId: 'a', toNodeId: 'b' },
      { fromNodeId: 'b', toNodeId: 'a' },
    ];

    expect(() => topologicalSort([a, b], connections)).toThrow(CyclicWorkflowError);
  });
});

describe('computeExecutionLevels', () => {
  it('groups "run A, then B+C in parallel, then D (needs A and C, not B)"', () => {
    const a = node('a');
    const b = node('b'); // connected after A only
    const c = node('c'); // also connected after A only — same level as B
    const d = node('d'); // connected after both A and C — one level later
    const connections: WorkflowConnection[] = [
      { fromNodeId: 'a', toNodeId: 'b' },
      { fromNodeId: 'a', toNodeId: 'c' },
      { fromNodeId: 'a', toNodeId: 'd' },
      { fromNodeId: 'c', toNodeId: 'd' },
    ];

    const levels = computeExecutionLevels([a, b, c, d], connections);
    expect(levels.map((level) => level.map((n) => n.id))).toEqual([['a'], ['b', 'c'], ['d']]);
  });
});

describe('executeChain', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    __clearCredentialTokenCacheForTests();
  });

  it('resolves path/query/header/body field sections, including a value mapped from a prior step', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(201, { id: 'order-1' }))
      .mockResolvedValueOnce(mockResponse(200, { id: 'order-1', status: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);

    const createOrder: Operation = {
      id: 'POST /orders',
      method: 'post',
      path: '/orders',
      parameters: [],
      requestBodySchema: { type: 'object', properties: { item: { type: 'string' } } },
      requestBodyContentType: 'application/json',
      responseSchema: null,
    };
    const getOrder: Operation = {
      id: 'GET /orders/{id}',
      method: 'get',
      path: '/orders/{id}',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      requestBodySchema: null,
      requestBodyContentType: null,
      responseSchema: null,
    };

    const n1: WorkflowNode = {
      id: 'n1',
      kind: 'operation',
      operationId: 'POST /orders',
      credentialId: null,
      rawBody: { template: '{"item":"Widget"}', tags: {} },
      rawHeaders: { 'x-trace-id': { template: 'abc123', tags: {} } },
    };
    const n2: WorkflowNode = {
      id: 'n2',
      kind: 'operation',
      operationId: 'GET /orders/{id}',
      credentialId: null,
      rawParams: {
        paths: {
          id: {
            template: '{{enlace:tag1}}',
            tags: { tag1: { id: 'tag1', type: 'response_body', sourceNodeId: 'n1', jsonPath: 'id' } },
          },
        },
        queries: {},
      },
    };
    // A raw tag chip's source must already be an explicit-connection
    // ancestor (see dependencyGraph.ts's own doc) — the mapping itself
    // implies no ordering edge of its own any more.
    const workflow = { nodes: [n1, n2], connections: [{ fromNodeId: 'n1', toNodeId: 'n2' }] };

    const operationsById = new Map([
      ['POST /orders', createOrder],
      ['GET /orders/{id}', getOrder],
    ]);

    const result = await executeChain(workflow, operationsById, new Map<string, Credential>(), {
      baseUrl: 'http://example.test',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [firstUrl, firstInit] = fetchMock.mock.calls[0];
    expect(firstUrl).toBe('http://example.test/orders');
    expect(firstInit.headers['x-trace-id']).toBe('abc123');
    expect(JSON.parse(firstInit.body)).toEqual({ item: 'Widget' });

    const [secondUrl] = fetchMock.mock.calls[1];
    expect(secondUrl).toBe('http://example.test/orders/order-1');

    expect(result.steps).toHaveLength(2);
    expect(result.steps[1].response?.body).toEqual({ id: 'order-1', status: 'ok' });
  });

  it('runs independent nodes within the same level concurrently, not sequentially', async () => {
    let active = 0;
    let maxActive = 0;
    const fetchMock = vi.fn(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active--;
      return mockResponse(200, {});
    });
    vi.stubGlobal('fetch', fetchMock);

    const noop: Operation = {
      id: 'GET /noop',
      method: 'get',
      path: '/noop',
      parameters: [],
      requestBodySchema: null,
      requestBodyContentType: null,
      responseSchema: null,
    };

    const a: WorkflowNode = { id: 'a', kind: 'operation', operationId: 'GET /noop', credentialId: null };
    const b: WorkflowNode = { id: 'b', kind: 'operation', operationId: 'GET /noop', credentialId: null };
    const c: WorkflowNode = { id: 'c', kind: 'operation', operationId: 'GET /noop', credentialId: null };
    const connections: WorkflowConnection[] = [
      { fromNodeId: 'a', toNodeId: 'b' },
      { fromNodeId: 'a', toNodeId: 'c' },
    ];

    await executeChain(
      { nodes: [a, b, c], connections },
      new Map([['GET /noop', noop]]),
      new Map<string, Credential>(),
      { baseUrl: 'http://example.test' }
    );

    // b and c are both in the same level (level 1, after a) — if they ran
    // sequentially, "active" would never exceed 1 concurrently in flight.
    expect(maxActive).toBeGreaterThanOrEqual(2);
  });

  it('sends a bearer Authorization header for a node with a credential set', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);

    const noop: Operation = {
      id: 'GET /noop',
      method: 'get',
      path: '/noop',
      parameters: [],
      requestBodySchema: null,
      requestBodyContentType: null,
      responseSchema: null,
    };
    const a: WorkflowNode = { id: 'a', kind: 'operation', operationId: 'GET /noop', credentialId: 'cred-1' };
    const credentialsById = new Map<string, Credential>([
      ['cred-1', { id: 'cred-1', name: 'Test', type: 'bearer', token: 'secret-token' }],
    ]);

    await executeChain(
      { nodes: [a], connections: [] },
      new Map([['GET /noop', noop]]),
      credentialsById,
      { baseUrl: 'http://example.test' }
    );

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer secret-token');
  });

  it('sends a Basic Authorization header for a basic credential', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);

    const noop: Operation = {
      id: 'GET /noop',
      method: 'get',
      path: '/noop',
      parameters: [],
      requestBodySchema: null,
      requestBodyContentType: null,
      responseSchema: null,
    };
    const a: WorkflowNode = { id: 'a', kind: 'operation', operationId: 'GET /noop', credentialId: 'cred-1' };
    const credentialsById = new Map<string, Credential>([
      ['cred-1', { id: 'cred-1', name: 'Test', type: 'basic', username: 'alice', password: 'hunter2' }],
    ]);

    await executeChain(
      { nodes: [a], connections: [] },
      new Map([['GET /noop', noop]]),
      credentialsById,
      { baseUrl: 'http://example.test' }
    );

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe(`Basic ${btoa('alice:hunter2')}`);
  });

  it('sends an apiKey credential as a query param when `in` is "query"', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);

    const noop: Operation = {
      id: 'GET /noop',
      method: 'get',
      path: '/noop',
      parameters: [],
      requestBodySchema: null,
      requestBodyContentType: null,
      responseSchema: null,
    };
    const a: WorkflowNode = { id: 'a', kind: 'operation', operationId: 'GET /noop', credentialId: 'cred-1' };
    const credentialsById = new Map<string, Credential>([
      ['cred-1', { id: 'cred-1', name: 'Test', type: 'apiKey', paramName: 'apiKey', in: 'query', key: 'secret-key' }],
    ]);

    await executeChain(
      { nodes: [a], connections: [] },
      new Map([['GET /noop', noop]]),
      credentialsById,
      { baseUrl: 'http://example.test' }
    );

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('http://example.test/noop?apiKey=secret-key');
  });

  it('flags an apiKey-in-header credential\'s own header name in redactHeaderNames, not just "Authorization"', async () => {
    const noop: Operation = {
      id: 'GET /noop',
      method: 'get',
      path: '/noop',
      parameters: [],
      requestBodySchema: null,
      requestBodyContentType: null,
      responseSchema: null,
    };
    const a: WorkflowNode = { id: 'a', kind: 'operation', operationId: 'GET /noop', credentialId: 'cred-1' };
    const credentialsById = new Map<string, Credential>([
      ['cred-1', { id: 'cred-1', name: 'Test', type: 'apiKey', paramName: 'X-Api-Key', in: 'header', key: 'secret-key' }],
    ]);

    const request = await buildRequest(a, noop, new Map(), credentialsById, 'http://example.test');

    expect(request.headers['X-Api-Key']).toBe('secret-key');
    expect(request.redactHeaderNames).toEqual(['X-Api-Key']);
  });

  it('sets credentials: "include" on the actual fetch() call for a cookie credential, with no headers/query injected', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);

    const noop: Operation = {
      id: 'GET /noop',
      method: 'get',
      path: '/noop',
      parameters: [],
      requestBodySchema: null,
      requestBodyContentType: null,
      responseSchema: null,
    };
    const a: WorkflowNode = { id: 'a', kind: 'operation', operationId: 'GET /noop', credentialId: 'cred-1' };
    const credentialsById = new Map<string, Credential>([
      [
        'cred-1',
        { id: 'cred-1', name: 'Test', type: 'cookie', loginUrl: 'https://app.test/auth/github' },
      ],
    ]);

    await executeChain(
      { nodes: [a], connections: [] },
      new Map([['GET /noop', noop]]),
      credentialsById,
      { baseUrl: 'http://example.test' }
    );

    const [, init] = fetchMock.mock.calls[0];
    expect(init.credentials).toBe('include');
    expect(init.headers.Authorization).toBeUndefined();
  });

  it('explicitly sends credentials: "omit" (not left for fetch()\'s own "same-origin" default) for a node with no credential', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);

    const noop: Operation = {
      id: 'GET /noop',
      method: 'get',
      path: '/noop',
      parameters: [],
      requestBodySchema: null,
      requestBodyContentType: null,
      responseSchema: null,
    };
    const a: WorkflowNode = { id: 'a', kind: 'operation', operationId: 'GET /noop', credentialId: null };

    await executeChain(
      { nodes: [a], connections: [] },
      new Map([['GET /noop', noop]]),
      new Map<string, Credential>(),
      { baseUrl: 'http://example.test' }
    );

    const [, init] = fetchMock.mock.calls[0];
    expect(init.credentials).toBe('omit');
  });

  // Regression test: leaving `credentials` undefined instead of explicitly
  // 'omit' used to defer to fetch()'s own default, 'same-origin' — which
  // sends along any cookie the browser already holds for that origin
  // regardless of whether a Cookie credential is attached at all. That's
  // exactly backwards from "no Cookie credential attached means no
  // cookies, ever" and silently defeats credential-per-node scoping for
  // any target sharing an origin with wherever Enlace is served from
  // (the common case for an adapter serving its own API, not an edge
  // case).
  it('sends credentials: "omit" for a non-cookie credential too, not just no credential at all', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);

    const noop: Operation = {
      id: 'GET /noop',
      method: 'get',
      path: '/noop',
      parameters: [],
      requestBodySchema: null,
      requestBodyContentType: null,
      responseSchema: null,
    };
    const a: WorkflowNode = { id: 'a', kind: 'operation', operationId: 'GET /noop', credentialId: 'cred-1' };
    const credentialsById = new Map<string, Credential>([['cred-1', { id: 'cred-1', name: 'Test', type: 'bearer', token: 'secret' }]]);

    await executeChain(
      { nodes: [a], connections: [] },
      new Map([['GET /noop', noop]]),
      credentialsById,
      { baseUrl: 'http://example.test' }
    );

    const [, init] = fetchMock.mock.calls[0];
    expect(init.credentials).toBe('omit');
  });

  it('fetches an oauth2 password-grant token and sends it as a Bearer header', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === 'http://auth.test/token') {
        return Promise.resolve(mockResponse(200, { access_token: 'issued-token', expires_in: 3600 }));
      }
      return Promise.resolve(mockResponse(200, {}));
    });
    vi.stubGlobal('fetch', fetchMock);

    const noop: Operation = {
      id: 'GET /noop',
      method: 'get',
      path: '/noop',
      parameters: [],
      requestBodySchema: null,
      requestBodyContentType: null,
      responseSchema: null,
    };
    const a: WorkflowNode = { id: 'a', kind: 'operation', operationId: 'GET /noop', credentialId: 'cred-1' };
    const credentialsById = new Map<string, Credential>([
      [
        'cred-1',
        {
          id: 'cred-1',
          name: 'Test',
          type: 'oauth2_password',
          tokenUrl: 'http://auth.test/token',
          username: 'alice',
          password: 'hunter2',
          clientAuthMethod: 'body',
        },
      ],
    ]);

    await executeChain(
      { nodes: [a], connections: [] },
      new Map([['GET /noop', noop]]),
      credentialsById,
      { baseUrl: 'http://example.test' }
    );

    const [, init] = fetchMock.mock.calls.find(([url]) => url === 'http://example.test/noop')!;
    expect(init.headers.Authorization).toBe('Bearer issued-token');
  });

  it('fetches and caches an oauth2 client-credentials token, reusing it across nodes', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === 'http://auth.test/token') {
        return Promise.resolve(mockResponse(200, { access_token: 'issued-token', expires_in: 3600 }));
      }
      return Promise.resolve(mockResponse(200, {}));
    });
    vi.stubGlobal('fetch', fetchMock);

    const noop: Operation = {
      id: 'GET /noop',
      method: 'get',
      path: '/noop',
      parameters: [],
      requestBodySchema: null,
      requestBodyContentType: null,
      responseSchema: null,
    };
    // Two independent nodes (no connection between them, same level) sharing
    // one credential — the token endpoint should be hit once, not twice.
    const a: WorkflowNode = { id: 'a', kind: 'operation', operationId: 'GET /noop', credentialId: 'cred-1' };
    const b: WorkflowNode = { id: 'b', kind: 'operation', operationId: 'GET /noop', credentialId: 'cred-1' };
    const credentialsById = new Map<string, Credential>([
      [
        'cred-1',
        {
          id: 'cred-1',
          name: 'Test',
          type: 'oauth2_clientCredentials',
          tokenUrl: 'http://auth.test/token',
          clientId: 'client-id',
          clientSecret: 'client-secret',
          clientAuthMethod: 'body',
        },
      ],
    ]);

    await executeChain(
      { nodes: [a, b], connections: [] },
      new Map([['GET /noop', noop]]),
      credentialsById,
      { baseUrl: 'http://example.test' }
    );

    const tokenCalls = fetchMock.mock.calls.filter(([url]) => url === 'http://auth.test/token');
    expect(tokenCalls).toHaveLength(1);

    const requestCalls = fetchMock.mock.calls.filter(([url]) => url !== 'http://auth.test/token');
    for (const [, init] of requestCalls) {
      expect(init.headers.Authorization).toBe('Bearer issued-token');
    }
  });

  it('resolves credentialExtraParamOverrides from an ancestor node\'s response, runs it after that ancestor with no explicit connection, and never caches the resulting token', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: { body?: string }) => {
      if (url === 'http://example.test/tenant') {
        return Promise.resolve(mockResponse(200, { audience: 'api://from-tenant' }));
      }
      if (url === 'http://auth.test/token') {
        const audience = new URLSearchParams(init?.body).get('audience');
        return Promise.resolve(mockResponse(200, { access_token: `token-for-${audience}`, expires_in: 3600 }));
      }
      return Promise.resolve(mockResponse(200, {}));
    });
    vi.stubGlobal('fetch', fetchMock);

    const tenantOp: Operation = {
      id: 'GET /tenant',
      method: 'get',
      path: '/tenant',
      parameters: [],
      requestBodySchema: null,
      requestBodyContentType: null,
      responseSchema: null,
    };
    const noop: Operation = {
      id: 'GET /noop',
      method: 'get',
      path: '/noop',
      parameters: [],
      requestBodySchema: null,
      requestBodyContentType: null,
      responseSchema: null,
    };
    // No explicit connection from tenant -> b — the mapped override alone
    // must be enough to order b after tenant.
    const tenant: WorkflowNode = { id: 'tenant', kind: 'operation', operationId: 'GET /tenant', credentialId: null };
    const b: WorkflowNode = {
      id: 'b',
      kind: 'operation',
      operationId: 'GET /noop',
      credentialId: 'cred-1',
      credentialExtraParamOverridesEnabled: true,
      credentialExtraParamOverrides: {
        audience: { source: 'mapped', fromNodeId: 'tenant', fromResponseFieldPath: 'audience' },
      },
    };
    const credentialsById = new Map<string, Credential>([
      [
        'cred-1',
        {
          id: 'cred-1',
          name: 'Test',
          type: 'oauth2_clientCredentials',
          tokenUrl: 'http://auth.test/token',
          clientId: 'client-id',
          clientSecret: 'client-secret',
          clientAuthMethod: 'body',
        },
      ],
    ]);

    await executeChain(
      { nodes: [tenant, b], connections: [] },
      new Map([
        ['GET /tenant', tenantOp],
        ['GET /noop', noop],
      ]),
      credentialsById,
      { baseUrl: 'http://example.test' }
    );

    const [, bInit] = fetchMock.mock.calls.find(([url]) => url === 'http://example.test/noop')!;
    expect(bInit.headers.Authorization).toBe('Bearer token-for-api://from-tenant');

    // Calling through the same shared credential again with no override
    // must not see a token cached under the override's params.
    await resolveCredentialInjection(credentialsById.get('cred-1')!);
    const tokenCalls = fetchMock.mock.calls.filter(([url]) => url === 'http://auth.test/token');
    expect(tokenCalls).toHaveLength(2);
    const [, secondInit] = tokenCalls[1];
    expect(new URLSearchParams(secondInit.body).has('audience')).toBe(false);
  });

  it("falls through to the credential's own extraTokenParams and its cache when an override is present but resolves to nothing (e.g. no response field picked yet)", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: { body?: string }) => {
      if (url === 'http://auth.test/token') {
        const audience = new URLSearchParams(init?.body).get('audience');
        return Promise.resolve(mockResponse(200, { access_token: `token-for-${audience}`, expires_in: 3600 }));
      }
      return Promise.resolve(mockResponse(200, {}));
    });
    vi.stubGlobal('fetch', fetchMock);

    const noop: Operation = {
      id: 'GET /noop',
      method: 'get',
      path: '/noop',
      parameters: [],
      requestBodySchema: null,
      requestBodyContentType: null,
      responseSchema: null,
    };
    // Two nodes sharing the credential: `b` is plain; `a` has an override
    // row added (mapped from `b`, so no cycle) but no response field chosen
    // yet ('' — the UI's "Select field..." state). Both must resolve to
    // the *same*, cached token.
    const b: WorkflowNode = { id: 'b', kind: 'operation', operationId: 'GET /noop', credentialId: 'cred-1' };
    const a: WorkflowNode = {
      id: 'a',
      kind: 'operation',
      operationId: 'GET /noop',
      credentialId: 'cred-1',
      credentialExtraParamOverridesEnabled: true,
      credentialExtraParamOverrides: {
        audience: { source: 'mapped', fromNodeId: 'b', fromResponseFieldPath: '' },
      },
    };
    const credentialsById = new Map<string, Credential>([
      [
        'cred-1',
        {
          id: 'cred-1',
          name: 'Test',
          type: 'oauth2_clientCredentials',
          tokenUrl: 'http://auth.test/token',
          clientId: 'client-id',
          clientSecret: 'client-secret',
          extraTokenParams: { audience: 'api://configured' },
          clientAuthMethod: 'body',
        },
      ],
    ]);

    await executeChain(
      { nodes: [a, b], connections: [] },
      new Map([['GET /noop', noop]]),
      credentialsById,
      { baseUrl: 'http://example.test' }
    );

    // Exactly one token request — a's unresolved override didn't force its
    // own uncached fetch, so b's normal cached path reused it.
    const tokenCalls = fetchMock.mock.calls.filter(([url]) => url === 'http://auth.test/token');
    expect(tokenCalls).toHaveLength(1);
    expect(new URLSearchParams(tokenCalls[0][1].body).get('audience')).toBe('api://configured');

    const requestCalls = fetchMock.mock.calls.filter(([url]) => url !== 'http://auth.test/token');
    for (const [, init] of requestCalls) {
      expect(init.headers.Authorization).toBe('Bearer token-for-api://configured');
    }
  });

  it('ignores credentialExtraParamOverrides entirely while credentialExtraParamOverridesEnabled is off, even with a fully-configured, resolvable override', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: { body?: string }) => {
      if (url === 'http://example.test/tenant') {
        return Promise.resolve(mockResponse(200, { audience: 'api://from-tenant' }));
      }
      if (url === 'http://auth.test/token') {
        const audience = new URLSearchParams(init?.body).get('audience');
        return Promise.resolve(mockResponse(200, { access_token: `token-for-${audience}`, expires_in: 3600 }));
      }
      return Promise.resolve(mockResponse(200, {}));
    });
    vi.stubGlobal('fetch', fetchMock);

    const tenantOp: Operation = {
      id: 'GET /tenant',
      method: 'get',
      path: '/tenant',
      parameters: [],
      requestBodySchema: null,
      requestBodyContentType: null,
      responseSchema: null,
    };
    const noop: Operation = {
      id: 'GET /noop',
      method: 'get',
      path: '/noop',
      parameters: [],
      requestBodySchema: null,
      requestBodyContentType: null,
      responseSchema: null,
    };
    const tenant: WorkflowNode = { id: 'tenant', kind: 'operation', operationId: 'GET /tenant', credentialId: null };
    // Same fully-resolvable mapped override as the enabled-case test above,
    // but with the toggle left off (undefined) — a leftover/previously
    // configured override must stay completely inert.
    const b: WorkflowNode = {
      id: 'b',
      kind: 'operation',
      operationId: 'GET /noop',
      credentialId: 'cred-1',
      credentialExtraParamOverrides: {
        audience: { source: 'mapped', fromNodeId: 'tenant', fromResponseFieldPath: 'audience' },
      },
    };
    const credentialsById = new Map<string, Credential>([
      [
        'cred-1',
        {
          id: 'cred-1',
          name: 'Test',
          type: 'oauth2_clientCredentials',
          tokenUrl: 'http://auth.test/token',
          clientId: 'client-id',
          clientSecret: 'client-secret',
          extraTokenParams: { audience: 'api://configured' },
          clientAuthMethod: 'body',
        },
      ],
    ]);

    // No connection either — with the override inert, nothing orders b after tenant.
    await executeChain(
      { nodes: [tenant, b], connections: [] },
      new Map([
        ['GET /tenant', tenantOp],
        ['GET /noop', noop],
      ]),
      credentialsById,
      { baseUrl: 'http://example.test' }
    );

    const [, bInit] = fetchMock.mock.calls.find(([url]) => url === 'http://example.test/noop')!;
    expect(bInit.headers.Authorization).toBe('Bearer token-for-api://configured');

    const tokenCalls = fetchMock.mock.calls.filter(([url]) => url === 'http://auth.test/token');
    expect(tokenCalls).toHaveLength(1);
  });

  it('records a failed oauth2 token fetch as a normal failed RunStep, not an uncaught rejection', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(401, {}));
    vi.stubGlobal('fetch', fetchMock);

    const noop: Operation = {
      id: 'GET /noop',
      method: 'get',
      path: '/noop',
      parameters: [],
      requestBodySchema: null,
      requestBodyContentType: null,
      responseSchema: null,
    };
    const a: WorkflowNode = { id: 'a', kind: 'operation', operationId: 'GET /noop', credentialId: 'cred-1' };
    const credentialsById = new Map<string, Credential>([
      [
        'cred-1',
        {
          id: 'cred-1',
          name: 'Test',
          type: 'oauth2_clientCredentials',
          tokenUrl: 'http://auth.test/token',
          clientId: 'client-id',
          clientSecret: 'client-secret',
          clientAuthMethod: 'body',
        },
      ],
    ]);

    const result = await executeChain(
      { nodes: [a], connections: [] },
      new Map([['GET /noop', noop]]),
      credentialsById,
      { baseUrl: 'http://example.test' }
    );

    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].error).toMatch(/token request.*failed with status 401/);
  });

  it('resolves a tag chip embedded in a larger raw body string, not just a whole-match one', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(201, { id: 'cust-1' }))
      .mockResolvedValueOnce(mockResponse(201, {}));
    vi.stubGlobal('fetch', fetchMock);

    const createCustomer: Operation = {
      id: 'POST /customers',
      method: 'post',
      path: '/customers',
      parameters: [],
      requestBodySchema: { type: 'object', properties: { name: { type: 'string' } } },
      requestBodyContentType: 'application/json',
      responseSchema: { type: 'object', properties: { id: { type: 'string' } } },
    };
    const createOrder: Operation = {
      id: 'POST /orders',
      method: 'post',
      path: '/orders',
      parameters: [],
      requestBodySchema: { type: 'object', properties: { note: { type: 'string' } } },
      requestBodyContentType: 'application/json',
      responseSchema: null,
    };

    const a: WorkflowNode = {
      id: 'a',
      kind: 'operation',
      operationId: 'POST /customers',
      credentialId: null,
      rawBody: { template: '{"name":"Ada"}', tags: {} },
    };
    const b: WorkflowNode = {
      id: 'b',
      kind: 'operation',
      operationId: 'POST /orders',
      credentialId: null,
      rawBody: {
        template: '{"note":"str{{enlace:tag1}}"}',
        tags: { tag1: { id: 'tag1', type: 'response_body', sourceNodeId: 'a', jsonPath: 'id' } },
      },
    };

    const result = await executeChain(
      { nodes: [a, b], connections: [{ fromNodeId: 'a', toNodeId: 'b' }] },
      new Map([
        ['POST /customers', createCustomer],
        ['POST /orders', createOrder],
      ]),
      new Map(),
      { baseUrl: 'http://example.test' }
    );

    expect(result.steps.every((s) => !s.error)).toBe(true);
    const [, orderInit] = fetchMock.mock.calls[1];
    expect(JSON.parse(orderInit.body)).toEqual({ note: 'strcust-1' });
  });

  it('substitutes path and query params from independent per-field rawParams entries, paths/queries namespaced separately', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const updateCustomer: Operation = {
      id: 'PATCH /customers/{id}',
      method: 'patch',
      path: '/customers/{id}',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'dryRun', in: 'query', required: false, schema: { type: 'boolean' } },
      ],
      requestBodySchema: { type: 'object', properties: { name: { type: 'string' } } },
      requestBodyContentType: 'application/json',
      responseSchema: null,
    };

    const node: WorkflowNode = {
      id: 'n1',
      kind: 'operation',
      operationId: 'PATCH /customers/{id}',
      credentialId: null,
      rawParams: {
        paths: { id: { template: 'cust-9', tags: {} } },
        queries: { dryRun: { template: 'true', tags: {} } },
      },
      rawBody: { template: JSON.stringify({ name: 'Ada' }), tags: {} },
    };

    const result = await executeChain(
      { nodes: [node], connections: [] },
      new Map([['PATCH /customers/{id}', updateCustomer]]),
      new Map(),
      { baseUrl: 'http://example.test' }
    );

    expect(result.steps[0].error).toBeUndefined();
    expect(fetchMock.mock.calls[0][0]).toBe('http://example.test/customers/cust-9?dryRun=true');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ name: 'Ada' });
  });

  it('fires a node the instant its own dependency settles, without waiting for an unrelated slower sibling in the same wave', async () => {
    // a -> b (slow) and a -> c (fast) are independent siblings once a
    // completes; d depends only on c. d must fire right after c settles,
    // not wait around for b — the exact fan-out case level-batching got
    // wrong (see engine/chainExecutor.ts's executeChain doc comment).
    const callOrder: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      const path = new URL(url).pathname;
      callOrder.push(`start:${path}`);
      const delay = path === '/b' ? 40 : 5;
      await new Promise((resolve) => setTimeout(resolve, delay));
      callOrder.push(`end:${path}`);
      return mockResponse(200, {});
    });
    vi.stubGlobal('fetch', fetchMock);

    const a = node('a');
    const b = node('b');
    const c = node('c');
    const d = node('d');
    const connections: WorkflowConnection[] = [
      { fromNodeId: 'a', toNodeId: 'b' },
      { fromNodeId: 'a', toNodeId: 'c' },
      { fromNodeId: 'c', toNodeId: 'd' },
    ];
    const operationsById = new Map([
      ['a', op('a', '/a')],
      ['b', op('b', '/b')],
      ['c', op('c', '/c')],
      ['d', op('d', '/d')],
    ]);

    await executeChain({ nodes: [a, b, c, d], connections }, operationsById, new Map(), {
      baseUrl: 'http://example.test',
    });

    expect(callOrder.indexOf('start:/d')).toBeGreaterThan(-1);
    expect(callOrder.indexOf('start:/d')).toBeLessThan(callOrder.indexOf('end:/b'));
  });

  it('halts admission of new nodes after a failure, but lets an already-in-flight sibling complete and never fires a node only reachable after the halt', async () => {
    // a -> b (slow, succeeds) and a -> c (fast, fails) are independent
    // siblings; e depends only on b, not c at all. e's own dependency (b)
    // does succeed, but by the time b finishes, c has already failed —
    // e must still never fire, proving the halt blocks *all* new
    // admissions, not just nodes downstream of the failing one.
    const fetchMock = vi.fn(async (url: string) => {
      const path = new URL(url).pathname;
      if (path === '/b') {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return mockResponse(200, {});
      }
      if (path === '/c') return mockResponse(500, {});
      return mockResponse(200, {}); // /a, and /e if it ever (wrongly) fired
    });
    vi.stubGlobal('fetch', fetchMock);

    const a = node('a');
    const b = node('b');
    const c = node('c');
    const e = node('e');
    const connections: WorkflowConnection[] = [
      { fromNodeId: 'a', toNodeId: 'b' },
      { fromNodeId: 'a', toNodeId: 'c' },
      { fromNodeId: 'b', toNodeId: 'e' },
    ];
    const operationsById = new Map([
      ['a', op('a', '/a')],
      ['b', op('b', '/b')],
      ['c', op('c', '/c')],
      ['e', op('e', '/e')],
    ]);

    const result = await executeChain({ nodes: [a, b, c, e], connections }, operationsById, new Map(), {
      baseUrl: 'http://example.test',
    });

    expect(result.steps.map((s) => s.nodeId).sort()).toEqual(['a', 'b', 'c']);
    expect(result.steps.find((s) => s.nodeId === 'b')?.error).toBeUndefined();
    expect(result.steps.find((s) => s.nodeId === 'c')?.error).toMatch(/status 500/);
  });

  it('seeds a node from previousRun as already completed, reusing its step and never re-firing it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, { fresh: true }));
    vi.stubGlobal('fetch', fetchMock);

    const a = node('a');
    const b = node('b');
    const connections: WorkflowConnection[] = [{ fromNodeId: 'a', toNodeId: 'b' }];
    const operationsById = new Map([
      ['a', op('a', '/a')],
      ['b', op('b', '/b')],
    ]);
    const seededStepA = {
      nodeId: 'a',
      request: { method: 'GET', url: 'http://example.test/a', headers: {}, credentials: 'omit' as const },
      response: { status: 200, headers: {}, body: { fromLastRun: true } },
      timestampStart: '2026-01-01T00:00:00.000Z',
      timestampEnd: '2026-01-01T00:00:01.000Z',
    };

    const result = await executeChain({ nodes: [a, b], connections }, operationsById, new Map(), {
      baseUrl: 'http://example.test',
      previousRun: { steps: [seededStepA] },
    });

    // Only b's request actually goes out — a's is skipped entirely, and b
    // (which depends on a) still fires without waiting, proving a's seeded
    // 'completed' status satisfies the dependency check exactly like a
    // freshly-settled one would.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('http://example.test/b');
    expect(result.steps.map((s) => s.nodeId).sort()).toEqual(['a', 'b']);
    expect(result.steps.find((s) => s.nodeId === 'a')).toBe(seededStepA);
  });

  it('re-runs a node instead of trusting its previousRun step, when that step recorded an error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);

    const a = node('a');
    const operationsById = new Map([['a', op('a', '/a')]]);
    const seededFailedStepA = {
      nodeId: 'a',
      request: { method: 'GET', url: 'http://example.test/a', headers: {}, credentials: 'omit' as const },
      timestampStart: '2026-01-01T00:00:00.000Z',
      timestampEnd: '2026-01-01T00:00:01.000Z',
      error: 'status 500',
    };

    const result = await executeChain({ nodes: [a], connections: [] }, operationsById, new Map(), {
      baseUrl: 'http://example.test',
      previousRun: { steps: [seededFailedStepA] },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.steps.find((s) => s.nodeId === 'a')).not.toBe(seededFailedStepA);
    expect(result.steps.find((s) => s.nodeId === 'a')?.error).toBeUndefined();
  });

  it('ignores a previousRun step for a node no longer present in the workflow, instead of throwing', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);

    const a = node('a');
    const operationsById = new Map([['a', op('a', '/a')]]);
    const staleStep = {
      nodeId: 'removed-node',
      request: { method: 'GET', url: 'http://example.test/removed', headers: {}, credentials: 'omit' as const },
      timestampStart: '2026-01-01T00:00:00.000Z',
      timestampEnd: '2026-01-01T00:00:01.000Z',
    };

    const result = await executeChain({ nodes: [a], connections: [] }, operationsById, new Map(), {
      baseUrl: 'http://example.test',
      previousRun: { steps: [staleStep] },
    });

    expect(result.steps.map((s) => s.nodeId)).toEqual(['a']);
  });

  it('emits an in-flight event before a settle event for each node, with independent same-wave nodes\' in-flight events both landing before either settles', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);

    const a = node('a');
    const b = node('b');
    const operationsById = new Map([
      ['a', op('a', '/noop')],
      ['b', op('b', '/noop')],
    ]);

    const events: RunEvent[] = [];
    await executeChain({ nodes: [a, b], connections: [] }, operationsById, new Map(), {
      baseUrl: 'http://example.test',
      onEvent: (event) => events.push(event),
    });

    const statuses = events.map((e) => e.status);
    const lastInFlightIndex = statuses.lastIndexOf('in-flight');
    const firstSettleIndex = statuses.findIndex((s) => s === 'completed' || s === 'failed');
    expect(events.filter((e) => e.status === 'in-flight')).toHaveLength(2);
    expect(events.filter((e) => e.status === 'completed')).toHaveLength(2);
    expect(lastInFlightIndex).toBeLessThan(firstSettleIndex);

    for (const id of ['a', 'b']) {
      const inFlightIndex = events.findIndex((e) => e.nodeId === id && e.status === 'in-flight');
      const settledIndex = events.findIndex((e) => e.nodeId === id && e.status === 'completed');
      expect(inFlightIndex).toBeGreaterThanOrEqual(0);
      expect(settledIndex).toBeGreaterThan(inFlightIndex);
    }

    for (const event of events) {
      if (event.status === 'completed' || event.status === 'failed') {
        expect(event.step).toBeDefined();
      } else {
        expect(event.step).toBeUndefined();
      }
    }
  });
});

describe('executeChain — breakpoints, pause/continue/step/stop', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('pauses a node at an armed breakpoint instead of firing it, once its dependencies settle, and never sends its request until released', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);

    const a = node('a');
    const b = node('b');
    const connections: WorkflowConnection[] = [{ fromNodeId: 'a', toNodeId: 'b' }];
    const operationsById = new Map([
      ['a', op('a', '/a')],
      ['b', op('b', '/b')],
    ]);

    const events: RunEvent[] = [];
    let control: RunControl | undefined;
    const resultPromise = executeChain({ nodes: [a, b], connections }, operationsById, new Map(), {
      baseUrl: 'http://example.test',
      armedBreakpoints: new Set([connectionKey('a', 'b')]),
      onEvent: (e) => events.push(e),
      onControl: (c) => (control = c),
    });

    await flushMicrotasks();
    expect(events.find((e) => e.nodeId === 'b')?.status).toBe('paused');
    expect(fetchMock).toHaveBeenCalledTimes(1); // only a — b never fired

    control!.continue();
    const result = await resultPromise;

    expect(result.steps.map((s) => s.nodeId).sort()).toEqual(['a', 'b']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never gates a node with no matching WorkflowConnection — arming a key for two otherwise-unrelated nodes has no effect", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);

    const a = node('a');
    const b = node('b');
    const operationsById = new Map([
      ['a', op('a', '/a')],
      ['b', op('b', '/b')],
    ]);

    // No connection (or any other dependency) between a and b at all, so
    // this armed key can never match anything — both run straight
    // through, neither ever pausing.
    const result = await executeChain({ nodes: [a, b], connections: [] }, operationsById, new Map(), {
      baseUrl: 'http://example.test',
      armedBreakpoints: new Set([connectionKey('a', 'b')]),
    });

    expect(result.steps.map((s) => s.nodeId).sort()).toEqual(['a', 'b']);
  });

  it('reports a pre-fire request preview once a paused node builds it, without ever sending it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(201, { id: 'order-1' }));
    vi.stubGlobal('fetch', fetchMock);

    const a = node('a');
    const b: WorkflowNode = {
      ...node('b'),
      rawBody: {
        template: '{"orderId":"{{enlace:tag1}}"}',
        tags: { tag1: { id: 'tag1', type: 'response_body', sourceNodeId: 'a', jsonPath: 'id' } },
      },
    };
    const connections: WorkflowConnection[] = [{ fromNodeId: 'a', toNodeId: 'b' }];
    const operationsById = new Map([
      ['a', op('a', '/a')],
      [
        'b',
        {
          ...op('b', '/b'),
          requestBodySchema: { type: 'object', properties: { orderId: { type: 'string' } } },
        },
      ],
    ]);

    const events: RunEvent[] = [];
    let control: RunControl | undefined;
    const resultPromise = executeChain({ nodes: [a, b], connections }, operationsById, new Map(), {
      baseUrl: 'http://example.test',
      armedBreakpoints: new Set([connectionKey('a', 'b')]),
      onEvent: (e) => events.push(e),
      onControl: (c) => (control = c),
    });

    await flushMicrotasks();
    const previewEvent = events.find((e) => e.nodeId === 'b' && e.request);
    expect(previewEvent?.request?.url).toBe('http://example.test/b');
    // The preview reflects a's real captured response (mapped field
    // resolution), the same way the request would if actually fired.
    expect(previewEvent?.request?.body).toEqual({ orderId: 'order-1' });

    control!.continue();
    await resultPromise;
  });

  it('step() releases exactly one paused node, leaving any others paused', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);

    const a = node('a');
    const b = node('b');
    const c = node('c');
    const connections: WorkflowConnection[] = [
      { fromNodeId: 'a', toNodeId: 'b' },
      { fromNodeId: 'a', toNodeId: 'c' },
    ];
    const operationsById = new Map([
      ['a', op('a', '/a')],
      ['b', op('b', '/b')],
      ['c', op('c', '/c')],
    ]);

    const events: RunEvent[] = [];
    let control: RunControl | undefined;
    const resultPromise = executeChain({ nodes: [a, b, c], connections }, operationsById, new Map(), {
      baseUrl: 'http://example.test',
      armedBreakpoints: new Set([connectionKey('a', 'b'), connectionKey('a', 'c')]),
      onEvent: (e) => events.push(e),
      onControl: (ctl) => (control = ctl),
    });

    await flushMicrotasks();
    // Two events per paused node (an immediate status-only one, then a
    // follow-up once its preview finishes building) — count distinct
    // *nodes* currently paused, not raw event count.
    const pausedNodeIds = new Set(events.filter((e) => e.status === 'paused').map((e) => e.nodeId));
    expect(pausedNodeIds).toEqual(new Set(['b', 'c']));

    control!.step('b');
    await flushMicrotasks();

    const bEvents = events.filter((e) => e.nodeId === 'b');
    expect(bEvents[bEvents.length - 1].status).toBe('completed');
    // c is still paused — step() only released b.
    const cEvents = events.filter((e) => e.nodeId === 'c');
    expect(cEvents[cEvents.length - 1].status).toBe('paused');

    control!.step('c');
    await resultPromise;
  });

  it('stop() admits nothing new — every pending/paused node becomes skipped — but an already-in-flight sibling still completes', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const path = new URL(url).pathname;
      if (path === '/b') {
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      return mockResponse(200, {});
    });
    vi.stubGlobal('fetch', fetchMock);

    // a -> b (unrelated, slow, no breakpoint — already in flight when Stop
    // hits) and a -> c (armed breakpoint, pauses); d depends on c and is
    // still merely 'pending' at the moment Stop is called.
    const a = node('a');
    const b = node('b');
    const c = node('c');
    const d = node('d');
    const connections: WorkflowConnection[] = [
      { fromNodeId: 'a', toNodeId: 'b' },
      { fromNodeId: 'a', toNodeId: 'c' },
      { fromNodeId: 'c', toNodeId: 'd' },
    ];
    const operationsById = new Map([
      ['a', op('a', '/a')],
      ['b', op('b', '/b')],
      ['c', op('c', '/c')],
      ['d', op('d', '/d')],
    ]);

    const events: RunEvent[] = [];
    let control: RunControl | undefined;
    const resultPromise = executeChain({ nodes: [a, b, c, d], connections }, operationsById, new Map(), {
      baseUrl: 'http://example.test',
      armedBreakpoints: new Set([connectionKey('a', 'c')]),
      onEvent: (e) => events.push(e),
      onControl: (ctl) => (control = ctl),
    });

    await flushMicrotasks();
    expect(events.find((e) => e.nodeId === 'c')?.status).toBe('paused');

    control!.stop();
    const result = await resultPromise;

    expect(result.steps.map((s) => s.nodeId).sort()).toEqual(['a', 'b']); // c/d never ran
    expect(events.find((e) => e.nodeId === 'c' && e.status === 'skipped')).toBeTruthy();
    expect(events.find((e) => e.nodeId === 'd' && e.status === 'skipped')).toBeTruthy();
    expect(result.steps.find((s) => s.nodeId === 'b')?.error).toBeUndefined(); // b, already in flight, still completed
  });

  it('builds FormData for multipart ops, omits Content-Type, and passes FormData to fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(201, { id: 'p1', name: 'Gadget', imageLocation: '/tmp/x' }));
    vi.stubGlobal('fetch', fetchMock);

    const file = new File(['png'], 'gadget.png', { type: 'image/png' });
    const productOp: Operation = {
      id: 'POST /products',
      method: 'post',
      path: '/products',
      parameters: [],
      requestBodySchema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          price: { type: 'number' },
          image: { type: 'string', format: 'binary' },
        },
      },
      requestBodyContentType: 'multipart/form-data',
      responseSchema: null,
    };
    const n: WorkflowNode = {
      id: 'n1',
      kind: 'operation',
      operationId: 'POST /products',
      credentialId: null,
      rawBody: {
        template: '{"name":"Gadget","price":19.5,"image":"{{enlace:tag1}}"}',
        tags: { tag1: { id: 'tag1', type: 'uploaded_file', fileName: 'gadget.png' } },
      },
    };

    const request = await buildRequest(
      n,
      productOp,
      new Map(),
      new Map(),
      'http://example.test',
      undefined,
      { [`n1::${rawFileTagFieldPath('tag1')}`]: file }
    );
    expect(request.headers['Content-Type']).toBeUndefined();
    expect(request.body).toBeInstanceOf(FormData);
    const form = request.body as FormData;
    expect(form.get('image')).toBeInstanceOf(File);
    expect((form.get('image') as File).name).toBe('gadget.png');
    expect(form.get('name')).toBe('Gadget');
    expect(form.get('price')).toBe('19.5');
  });

  it('sends multipart FormData all the way through executeChain\'s own fetch() call', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(201, { id: 'p1', name: 'Gadget', imageLocation: '/tmp/x' }));
    vi.stubGlobal('fetch', fetchMock);

    const file = new File(['png'], 'gadget.png', { type: 'image/png' });
    const productOp: Operation = {
      id: 'POST /products',
      method: 'post',
      path: '/products',
      parameters: [],
      requestBodySchema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          price: { type: 'number' },
          image: { type: 'string', format: 'binary' },
        },
      },
      requestBodyContentType: 'multipart/form-data',
      responseSchema: null,
    };
    const n: WorkflowNode = {
      id: 'n1',
      kind: 'operation',
      operationId: 'POST /products',
      credentialId: null,
      rawBody: {
        template: '{"name":"Gadget","price":19.5,"image":"{{enlace:tag1}}"}',
        tags: { tag1: { id: 'tag1', type: 'uploaded_file', fileName: 'gadget.png' } },
      },
    };

    // Keyed via rawFileTagFieldPath, not a real field path — see
    // bodyTags.ts and operationNodeHandler.ts's own comment on why.
    const result = await executeChain(
      { nodes: [n], connections: [] },
      new Map([[productOp.id, productOp]]),
      new Map(),
      { baseUrl: 'http://example.test', uploadedFiles: { [`n1::${rawFileTagFieldPath('tag1')}`]: file } }
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['Content-Type']).toBeUndefined();
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('image')).toBeInstanceOf(File);
    expect(result.steps[0].response?.status).toBe(201);
  });

  it('fails clearly when an uploaded_file tag has no in-memory File blob', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const productOp: Operation = {
      id: 'POST /products',
      method: 'post',
      path: '/products',
      parameters: [],
      requestBodySchema: { type: 'object', properties: { image: { type: 'string', format: 'binary' } } },
      requestBodyContentType: 'multipart/form-data',
      responseSchema: null,
    };
    const n: WorkflowNode = {
      id: 'n1',
      kind: 'operation',
      operationId: 'POST /products',
      credentialId: null,
      rawBody: {
        template: '{"image":"{{enlace:tag1}}"}',
        tags: { tag1: { id: 'tag1', type: 'uploaded_file', fileName: 'gone.png' } },
      },
    };

    const result = await executeChain(
      { nodes: [n], connections: [] },
      new Map([[productOp.id, productOp]]),
      new Map(),
      { baseUrl: 'http://example.test' }
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.steps[0].error).toMatch(/Re-select the file for "gone\.png"/);
  });
});

function presetsNode(id: string, presets: PresetsNode['presets']): PresetsNode {
  return { id, kind: 'presets', credentialId: null, presets };
}

describe('executeChain — presets nodes', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('runs every preset in order and settles as one aggregate step with per-preset subSteps', async () => {
    const g = presetsNode('g', [
      { id: 's1', kind: 'wait', durationMs: 5 },
      { id: 's2', kind: 'wait', durationMs: 5 },
    ]);

    const result = await executeChain({ nodes: [g], connections: [] }, new Map(), new Map(), {
      baseUrl: 'http://example.test',
    });

    expect(result.steps).toHaveLength(1);
    const step = result.steps[0];
    expect(step.nodeId).toBe('g');
    expect(step.request.method).toBe('PRESETS');
    expect(step.response).toBeUndefined();
    expect(step.error).toBeUndefined();
    expect(step.subSteps).toHaveLength(2);
    expect(step.subSteps?.map((s) => s.request.method)).toEqual(['WAIT', 'WAIT']);
  });

  it('settles an empty presets collection immediately with no sub-steps', async () => {
    const g = presetsNode('g', []);
    const result = await executeChain({ nodes: [g], connections: [] }, new Map(), new Map(), {
      baseUrl: 'http://example.test',
    });
    expect(result.steps[0].subSteps).toEqual([]);
    expect(result.steps[0].error).toBeUndefined();
  });

  it('gates a downstream node exactly like any other node', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);

    const g = presetsNode('g', [{ id: 's1', kind: 'wait', durationMs: 5 }]);
    const a = node('a');
    const connections: WorkflowConnection[] = [{ fromNodeId: 'g', toNodeId: 'a' }];
    const operationsById = new Map([['a', op('a', '/a')]]);

    const result = await executeChain({ nodes: [a, g], connections }, operationsById, new Map(), {
      baseUrl: 'http://example.test',
    });

    expect(result.steps.map((s) => s.nodeId).sort()).toEqual(['a', 'g']);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('a downstream node cannot map a field from a wait-only collection — there is no response body to read', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);

    const g = presetsNode('g', [{ id: 's1', kind: 'wait', durationMs: 5 }]);
    const a: WorkflowNode = {
      id: 'a',
      kind: 'operation',
      operationId: 'a',
      credentialId: null,
      rawParams: {
        paths: {},
        queries: {
          x: {
            template: '{{enlace:tag1}}',
            tags: { tag1: { id: 'tag1', type: 'response_body', sourceNodeId: 'g', jsonPath: 'id' } },
          },
        },
      },
    };
    const connections: WorkflowConnection[] = [{ fromNodeId: 'g', toNodeId: 'a' }];
    const operationsById = new Map([['a', op('a', '/a')]]);

    const result = await executeChain({ nodes: [a, g], connections }, operationsById, new Map(), {
      baseUrl: 'http://example.test',
    });

    // Unlike the old Form-mode mapping (which just silently resolved to
    // `undefined` and dropped the query param), a Raw JSON tag chip throws
    // a clear error instead — same "never silently sends a placeholder"
    // rule resolveTagValue (bodyTags.ts) applies everywhere else.
    const aStep = result.steps.find((s) => s.nodeId === 'a')!;
    expect(aStep.error).toMatch(/no captured response yet/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Stop mid-collection resolves promptly (the in-progress preset is cut short, and no further preset starts)', async () => {
    const g = presetsNode('g', [
      { id: 's1', kind: 'wait', durationMs: 60_000 },
      { id: 's2', kind: 'wait', durationMs: 60_000 },
    ]);

    let control: RunControl | undefined;
    const resultPromise = executeChain({ nodes: [g], connections: [] }, new Map(), new Map(), {
      baseUrl: 'http://example.test',
      onControl: (c) => (control = c),
    });

    await flushMicrotasks();
    control!.stop();
    // Hangs (and fails on the test's own timeout) if Stop didn't actually
    // cut the in-progress preset's sleep short.
    const result = await resultPromise;

    const step = result.steps.find((s) => s.nodeId === 'g');
    expect(step?.subSteps).toHaveLength(1); // s2 never started
  });

  it('pauses a presets node at an armed breakpoint like any other node, with no preview request ever emitted for it', async () => {
    const a = node('a');
    const g = presetsNode('g', [{ id: 's1', kind: 'wait', durationMs: 5 }]);
    const connections: WorkflowConnection[] = [{ fromNodeId: 'a', toNodeId: 'g' }];
    const operationsById = new Map([['a', op('a', '/a')]]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

    const events: RunEvent[] = [];
    let control: RunControl | undefined;
    const resultPromise = executeChain({ nodes: [a, g], connections }, operationsById, new Map(), {
      baseUrl: 'http://example.test',
      armedBreakpoints: new Set([connectionKey('a', 'g')]),
      onEvent: (e) => events.push(e),
      onControl: (c) => (control = c),
    });

    await flushMicrotasks();
    expect(events.find((e) => e.nodeId === 'g')?.status).toBe('paused');
    expect(events.some((e) => e.nodeId === 'g' && e.request)).toBe(false);

    control!.continue();
    const result = await resultPromise;
    expect(result.steps.map((s) => s.nodeId).sort()).toEqual(['a', 'g']);
  });
});

describe('executeChain — assert presets', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('a passing check settles the collection with no error, downstream still fires', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(201, { id: 'abc' }))
      .mockResolvedValueOnce(mockResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);

    const a = node('a');
    const g = presetsNode('g', [
      {
        id: 's1',
        kind: 'assert',
        checks: [{ id: 'c1', source: { type: 'response_status', sourceNodeId: 'a' }, operator: 'equals', expected: '201' }],
      },
    ]);
    const b = node('b');
    const connections: WorkflowConnection[] = [
      { fromNodeId: 'a', toNodeId: 'g' },
      { fromNodeId: 'g', toNodeId: 'b' },
    ];
    const operationsById = new Map([
      ['a', op('a', '/a')],
      ['b', op('b', '/b')],
    ]);

    const result = await executeChain({ nodes: [a, g, b], connections }, operationsById, new Map(), {
      baseUrl: 'http://example.test',
    });

    const gStep = result.steps.find((s) => s.nodeId === 'g')!;
    expect(gStep.request.method).toBe('PRESETS');
    expect(gStep.subSteps?.[0].request.method).toBe('ASSERT');
    expect(gStep.error).toBeUndefined();
    expect(result.steps.map((s) => s.nodeId).sort()).toEqual(['a', 'b', 'g']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a failing check fails the collection and skips downstream — same propagation as an HTTP failure', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(mockResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);

    const a = node('a');
    const g = presetsNode('g', [
      {
        id: 's1',
        kind: 'assert',
        checks: [{ id: 'c1', source: { type: 'response_status', sourceNodeId: 'a' }, operator: 'equals', expected: '201' }],
      },
    ]);
    const b = node('b');
    const connections: WorkflowConnection[] = [
      { fromNodeId: 'a', toNodeId: 'g' },
      { fromNodeId: 'g', toNodeId: 'b' },
    ];
    const operationsById = new Map([
      ['a', op('a', '/a')],
      ['b', op('b', '/b')],
    ]);

    const events: RunEvent[] = [];
    const result = await executeChain({ nodes: [a, g, b], connections }, operationsById, new Map(), {
      baseUrl: 'http://example.test',
      onEvent: (e) => events.push(e),
    });

    const gStep = result.steps.find((s) => s.nodeId === 'g')!;
    expect(gStep.error).toMatch(/Check 1: expected "201", got 200/);
    expect(result.steps.find((s) => s.nodeId === 'b')).toBeUndefined();
    expect(events.find((e) => e.nodeId === 'b')?.status).toBe('skipped');
    // b's own operation never fires once its dependency (g) fails.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops at the first failing check — later checks in the same preset never run', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

    const a = node('a');
    const g = presetsNode('g', [
      {
        id: 's1',
        kind: 'assert',
        checks: [
          { id: 'c1', source: { type: 'response_status', sourceNodeId: 'a' }, operator: 'equals', expected: '201' },
          { id: 'c2', source: { type: 'response_status', sourceNodeId: 'a' }, operator: 'equals', expected: '999' },
        ],
      },
    ]);
    const connections: WorkflowConnection[] = [{ fromNodeId: 'a', toNodeId: 'g' }];
    const operationsById = new Map([['a', op('a', '/a')]]);

    const result = await executeChain({ nodes: [a, g], connections }, operationsById, new Map(), {
      baseUrl: 'http://example.test',
    });

    const gStep = result.steps.find((s) => s.nodeId === 'g')!;
    expect(gStep.error).toMatch(/^Check 1:/);
  });

  it("a check whose source node never captured a response fails clearly, doesn't throw uncaught", async () => {
    const g = presetsNode('g', [
      {
        id: 's1',
        kind: 'assert',
        checks: [{ id: 'c1', source: { type: 'response_status', sourceNodeId: 'nonexistent' }, operator: 'exists' }],
      },
    ]);

    const result = await executeChain({ nodes: [g], connections: [] }, new Map(), new Map(), {
      baseUrl: 'http://example.test',
    });

    const gStep = result.steps.find((s) => s.nodeId === 'g')!;
    expect(gStep.error).toMatch(/Check 1:.*no captured response/);
  });
});
