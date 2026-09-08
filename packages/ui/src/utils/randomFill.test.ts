import { describe, expect, it } from 'vitest';
import { fillBodyWithRandomData, fillRawBodyWithRandomData } from './randomFill.js';
import type { FieldValue, Operation } from '../types.js';

function op(requestBodySchema: Record<string, any>): Operation {
  return {
    id: 'POST /customers',
    method: 'post',
    path: '/customers',
    parameters: [],
    requestBodySchema,
    requestBodyContentType: 'application/json',
    responseSchema: null,
  };
}

describe('fillBodyWithRandomData', () => {
  const schema = {
    type: 'object',
    required: ['firstName', 'widgetCount', 'isActive'],
    properties: {
      firstName: { type: 'string' },
      widgetCount: { type: 'integer' },
      isActive: { type: 'boolean' },
      nickname: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
      avatar: { type: 'string', format: 'binary' },
    },
  };

  it('fills every required scalar body leaf with a real, correctly-typed static value', () => {
    const result = fillBodyWithRandomData(op(schema), {}, false);
    expect(result['body.firstName']).toEqual({ source: 'static', value: expect.any(String) });
    expect(result['body.widgetCount']).toEqual({ source: 'static', value: expect.any(Number) });
    expect(result['body.isActive']).toEqual({ source: 'static', value: expect.any(Boolean) });
  });

  it('guesses purely by type/format, ignoring the field name entirely — a `firstName` field is not routed to a name-specific generator', () => {
    // No `first()`/`email()`/etc. name-based heuristic any more — every
    // string field (whatever it's called) falls back to the same
    // type-shaped generator.
    const nameHeavySchema = {
      type: 'object',
      required: ['firstName', 'email', 'city'],
      properties: {
        firstName: { type: 'string' },
        email: { type: 'string' },
        city: { type: 'string' },
      },
    };
    const result = fillBodyWithRandomData(op(nameHeavySchema), {}, false);
    expect(result['body.firstName']).toEqual({ source: 'static', value: expect.any(String) });
    expect(result['body.email']).toEqual({ source: 'static', value: expect.any(String) });
    expect(result['body.city']).toEqual({ source: 'static', value: expect.any(String) });
  });

  it('still prefers format over a bare string-type fallback, and converts a generated Date to the ISO shape the format asked for', () => {
    const schemaWithFormat = {
      type: 'object',
      required: ['createdAt', 'birthDate'],
      properties: {
        createdAt: { type: 'string', format: 'date-time' },
        birthDate: { type: 'string', format: 'date' },
      },
    };
    const result = fillBodyWithRandomData(op(schemaWithFormat), {}, false);
    // Chance's `date()` returns a JS `Date`, not a string — `guessByType`
    // still reads `format` (never the field's own name), and
    // `generateRandomValue` converts that `Date` to the ISO shape the
    // schema's own format actually wants, not `Date`'s verbose `toString()`.
    expect((result['body.createdAt'] as { value: unknown }).value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect((result['body.birthDate'] as { value: unknown }).value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('nulls out optional scalar fields instead of guessing a value', () => {
    const result = fillBodyWithRandomData(op(schema), {}, false);
    expect(result['body.nickname']).toEqual({ source: 'static', value: null });
  });

  it('skips arrays and file fields entirely, required or not', () => {
    const result = fillBodyWithRandomData(op(schema), {}, false);
    expect(result['body.tags']).toBeUndefined();
    expect(result['body.avatar']).toBeUndefined();
  });

  it('overwrites existing values when onlyEmpty is false', () => {
    const existing: Record<string, FieldValue> = { 'body.firstName': { source: 'static', value: 'Ada' } };
    const result = fillBodyWithRandomData(op(schema), existing, false);
    expect(result['body.firstName']).not.toEqual({ source: 'static', value: 'Ada' });
  });

  it('leaves already-set fields alone when onlyEmpty is true', () => {
    const existing: Record<string, FieldValue> = {
      'body.firstName': { source: 'static', value: 'Ada' },
      'body.widgetCount': { source: 'static', value: '' },
    };
    const result = fillBodyWithRandomData(op(schema), existing, true);
    expect(result['body.firstName']).toBeUndefined();
    expect(result['body.widgetCount']).toEqual({ source: 'static', value: expect.any(Number) });
  });
});

describe('fillRawBodyWithRandomData', () => {
  it('fills every required leaf (including nested shapes Form mode cannot represent) with a real, correctly-typed value', () => {
    const schema = {
      type: 'object',
      required: ['firstName', 'widgetCount', 'isActive', 'address'],
      properties: {
        firstName: { type: 'string' },
        widgetCount: { type: 'integer' },
        isActive: { type: 'boolean' },
        address: {
          type: 'object',
          required: ['city'],
          properties: { city: { type: 'string' } },
        },
        nickname: { type: 'string' },
      },
    };
    const raw = fillRawBodyWithRandomData(op(schema));
    const parsed = JSON.parse(raw.template);
    expect(typeof parsed.firstName).toBe('string');
    expect(typeof parsed.widgetCount).toBe('number');
    expect(typeof parsed.isActive).toBe('boolean');
    expect(typeof parsed.address.city).toBe('string');
    expect(parsed.nickname).toBeNull();
    expect(raw.tags).toEqual({});
  });

  it('fills a whole array (no required-list to check within items) rather than nulling it out', () => {
    const schema = {
      type: 'object',
      required: ['tags'],
      properties: { tags: { type: 'array', items: { type: 'string' } } },
    };
    const parsed = JSON.parse(fillRawBodyWithRandomData(op(schema)).template);
    expect(parsed.tags).toHaveLength(1);
    expect(typeof parsed.tags[0]).toBe('string');
  });

  it('leaves a file field blank rather than randomizing it', () => {
    const schema = { type: 'object', required: ['avatar'], properties: { avatar: { type: 'string', format: 'binary' } } };
    const parsed = JSON.parse(fillRawBodyWithRandomData(op(schema)).template);
    expect(parsed.avatar).toBe('');
  });

  it("picks one of an enum field's declared values instead of a generated one", () => {
    const schema = { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['active', 'inactive'] } } };
    const parsed = JSON.parse(fillRawBodyWithRandomData(op(schema)).template);
    expect(['active', 'inactive']).toContain(parsed.status);
  });
});
