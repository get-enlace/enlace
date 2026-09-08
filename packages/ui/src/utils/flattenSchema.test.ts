import { describe, it, expect } from 'vitest';
import { flattenResponseFields } from './flattenSchema.js';
import type { Operation } from '../types.js';

function makeOperation(overrides: Partial<Operation>): Operation {
  return {
    id: 'POST /pet',
    method: 'post',
    path: '/pet',
    parameters: [],
    requestBodySchema: null,
    requestBodyContentType: null,
    responseSchema: null,
    ...overrides,
  };
}

describe('flattenResponseFields', () => {
  it('offers indexed item fields when the response itself is a bare array of objects (e.g. GET /widgets -> Widget[])', () => {
    const operation = makeOperation({
      responseSchema: {
        type: 'array',
        items: {
          type: 'object',
          properties: { id: { type: 'integer' }, name: { type: 'string' } },
        },
      },
    });

    const fields = flattenResponseFields(operation);
    const paths = fields.map((f) => f.path);

    // No whole-array field here — there's no property name to hang it on at
    // the true top level, only the items are selectable. Reaching past
    // index 0 (a second item, a filtered one) is still Raw mode's job.
    expect(paths).toEqual(['[0].id', '[0].name']);
    expect(fields.every((f) => f.supported)).toBe(true);
  });

  it('offers a single indexed field for a bare array of scalars', () => {
    const operation = makeOperation({ responseSchema: { type: 'array', items: { type: 'string' } } });

    const [item] = flattenResponseFields(operation);

    expect(item.path).toBe('[0]');
    expect(item.supported).toBe(true);
    expect(item.type).toBe('string');
  });

  it('offers both the whole array and its indexed item fields for an array-of-objects property', () => {
    const operation = makeOperation({
      responseSchema: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: { id: { type: 'integer' } },
            },
          },
          total: { type: 'integer' },
        },
      },
    });

    const fields = flattenResponseFields(operation);
    const paths = fields.map((f) => f.path);

    expect(paths).toEqual(['items', 'items[0].id', 'total']);
    expect(fields.find((f) => f.path === 'items')!.type).toBe('array');
    expect(fields.every((f) => f.supported)).toBe(true);
  });

  it('recurses fully through nested objects — no depth cap, no row for the object itself', () => {
    const operation = makeOperation({
      responseSchema: {
        type: 'object',
        properties: {
          category: {
            type: 'object',
            properties: {
              id: { type: 'integer' },
              owner: {
                type: 'object',
                properties: { name: { type: 'string' } },
              },
            },
          },
        },
      },
    });

    const fields = flattenResponseFields(operation);
    const paths = fields.map((f) => f.path);

    expect(paths).not.toContain('category');
    expect(paths).not.toContain('category.owner');
    expect(paths).toEqual(['category.id', 'category.owner.name']);
    expect(fields.every((f) => f.supported)).toBe(true);
  });

  it('carries enum through for a response property', () => {
    const operation = makeOperation({
      responseSchema: {
        type: 'object',
        properties: { status: { type: 'string', enum: ['available', 'pending', 'sold'] } },
      },
    });

    const [status] = flattenResponseFields(operation);

    expect(status.path).toBe('status');
    expect(status.enum).toEqual(['available', 'pending', 'sold']);
  });

  it('marks an unrecognized item shape unsupported rather than mistreating it as a scalar', () => {
    const operation = makeOperation({
      responseSchema: { type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'integer' }] } },
    });

    const [item] = flattenResponseFields(operation);

    expect(item.path).toBe('[0]');
    expect(item.supported).toBe(false);
  });

  it('marks a genuinely unrecognized schema shape (e.g. oneOf) unsupported, rather than silently mistreating it as a plain scalar', () => {
    const operation = makeOperation({
      responseSchema: {
        type: 'object',
        properties: { value: { oneOf: [{ type: 'string' }, { type: 'integer' }] } },
      },
    });

    const [value] = flattenResponseFields(operation);

    expect(value.supported).toBe(false);
    expect(value.reason).toBeTruthy();
  });

  it('returns nothing for a missing response schema, same as before', () => {
    const operation = makeOperation({ responseSchema: null });

    expect(flattenResponseFields(operation)).toEqual([]);
  });
});
