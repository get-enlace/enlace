import { describe, it, expect } from 'vitest';
import { buildDefaultRawBody, buildDefaultRawHeaders, buildDefaultRawParams } from './rawDefaults.js';
import type { Operation } from '../types.js';

function makeOperation(overrides: Partial<Operation> = {}): Operation {
  return {
    id: 'GET /widgets/{id}',
    method: 'get',
    path: '/widgets/{id}',
    parameters: [],
    requestBodySchema: null,
    requestBodyContentType: null,
    responseSchema: null,
    ...overrides,
  };
}

describe('buildDefaultRawParams (one field per path/query param, namespaced independently)', () => {
  it('returns null when the operation declares neither a path nor a query param', () => {
    expect(buildDefaultRawParams(makeOperation())).toBeNull();
  });

  it('seeds one blank field per declared path/query param, under independent paths/queries maps, leaving headers out', () => {
    const operation = makeOperation({
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'limit', in: 'query', required: false, schema: { type: 'integer' } },
        { name: 'x-trace-id', in: 'header', required: false, schema: { type: 'string' } },
      ],
    });

    expect(buildDefaultRawParams(operation)).toEqual({
      paths: { id: { template: '', tags: {} } },
      queries: { limit: { template: '', tags: {} } },
    });
  });

  it('leaves whichever of paths/queries the operation declares none of as an empty map, not omitted', () => {
    const pathOnly = makeOperation({ parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }] });
    expect(buildDefaultRawParams(pathOnly)).toEqual({ paths: { id: { template: '', tags: {} } }, queries: {} });

    const queryOnly = makeOperation({ parameters: [{ name: 'limit', in: 'query', required: false, schema: { type: 'integer' } }] });
    expect(buildDefaultRawParams(queryOnly)).toEqual({ paths: {}, queries: { limit: { template: '', tags: {} } } });
  });

  it('lets a path param and a query param share the same name — independent namespaces, no collision', () => {
    const operation = makeOperation({
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'id', in: 'query', required: false, schema: { type: 'string' } },
      ],
    });
    expect(buildDefaultRawParams(operation)).toEqual({
      paths: { id: { template: '', tags: {} } },
      queries: { id: { template: '', tags: {} } },
    });
  });
});

describe('buildDefaultRawHeaders', () => {
  it('returns null when the operation declares no header params', () => {
    expect(buildDefaultRawHeaders(makeOperation())).toBeNull();
  });

  it('seeds one blank field per declared header param', () => {
    const operation = makeOperation({
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'x-trace-id', in: 'header', required: false, schema: { type: 'string' } },
      ],
    });
    expect(buildDefaultRawHeaders(operation)).toEqual({ 'x-trace-id': { template: '', tags: {} } });
  });
});

describe('buildDefaultRawBody', () => {
  it('returns null when the operation has no request body', () => {
    expect(buildDefaultRawBody(makeOperation())).toBeNull();
  });

  it('builds a full nested schema example, required leaves stubbed and optional ones null', () => {
    const operation = makeOperation({
      requestBodySchema: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          age: { type: 'integer' },
        },
      },
    });

    const result = buildDefaultRawBody(operation);
    expect(result).not.toBeNull();
    // Required leaf -> emptyScalarValue's "fill this in" stub (''), not
    // buildSchemaExample's illustrative placeholder text.
    expect(JSON.parse(result!.template)).toEqual({ name: '', age: null });
    expect(result!.tags).toEqual({});
  });
});
