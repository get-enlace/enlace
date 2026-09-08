import { describe, it, expect } from 'vitest';
import { buildDefaultRawBody, buildDefaultRawParams } from './rawDefaults.js';
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

describe('buildDefaultRawParams', () => {
  it('returns null when the operation declares no params for that section', () => {
    expect(buildDefaultRawParams('path', makeOperation())).toBeNull();
  });

  it('seeds one blank-string entry per declared param in that section', () => {
    const operation = makeOperation({
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'limit', in: 'query', required: false, schema: { type: 'integer' } },
        { name: 'x-trace-id', in: 'header', required: false, schema: { type: 'string' } },
      ],
    });

    expect(buildDefaultRawParams('path', operation)).toEqual({ template: JSON.stringify({ id: '' }, null, 2), tags: {} });
    expect(buildDefaultRawParams('query', operation)).toEqual({ template: JSON.stringify({ limit: '' }, null, 2), tags: {} });
    expect(buildDefaultRawParams('header', operation)).toEqual({
      template: JSON.stringify({ 'x-trace-id': '' }, null, 2),
      tags: {},
    });
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
