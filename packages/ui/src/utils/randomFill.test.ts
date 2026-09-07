import { describe, expect, it } from 'vitest';
import { fillBodyWithRandomData, fillRawBodyWithRandomData, guessRandomExpression } from './randomFill.js';
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

describe('guessRandomExpression', () => {
  it.each([
    ['body.firstName', '$rand.first()'],
    ['body.customer.lastName', '$rand.last()'],
    ['body.fullName', '$rand.name()'],
    ['body.email', '$rand.email()'],
    ['body.phone', '$rand.phone()'],
    ['body.zip', '$rand.zip()'],
    ['body.city', '$rand.city()'],
  ])('guesses %s -> %s from the field name', (path, expected) => {
    expect(guessRandomExpression({ path, required: false, supported: true })).toBe(expected);
  });

  it('falls back to a type-based guess when no name heuristic matches', () => {
    expect(guessRandomExpression({ path: 'body.widgetCount', required: false, supported: true, type: 'integer' })).toBe(
      '$rand.integer()'
    );
    expect(guessRandomExpression({ path: 'body.isActive', required: false, supported: true, type: 'boolean' })).toBe(
      '$rand.bool()'
    );
    expect(guessRandomExpression({ path: 'body.notes', required: false, supported: true, type: 'string' })).toBe(
      '$rand.word()'
    );
  });

  it('prefers format over a bare string-type fallback', () => {
    expect(
      guessRandomExpression({ path: 'body.createdAt', required: false, supported: true, type: 'string', format: 'date-time' })
    ).toBe('$rand.date()');
  });
});

describe('fillBodyWithRandomData', () => {
  const schema = {
    type: 'object',
    properties: {
      firstName: { type: 'string' },
      widgetCount: { type: 'integer' },
      tags: { type: 'array', items: { type: 'string' } },
      avatar: { type: 'string', format: 'binary' },
    },
  };

  it('fills every supported scalar body leaf, skipping arrays and file fields', () => {
    const result = fillBodyWithRandomData(op(schema), {}, false);
    expect(result['body.firstName']).toEqual({ source: 'random', expression: '$rand.first()' });
    expect(result['body.widgetCount']).toEqual({ source: 'random', expression: '$rand.integer()' });
    expect(result['body.tags']).toBeUndefined();
    expect(result['body.avatar']).toBeUndefined();
  });

  it('overwrites existing values when onlyEmpty is false', () => {
    const existing: Record<string, FieldValue> = { 'body.firstName': { source: 'static', value: 'Ada' } };
    const result = fillBodyWithRandomData(op(schema), existing, false);
    expect(result['body.firstName']).toEqual({ source: 'random', expression: '$rand.first()' });
  });

  it('leaves already-set fields alone when onlyEmpty is true', () => {
    const existing: Record<string, FieldValue> = {
      'body.firstName': { source: 'static', value: 'Ada' },
      'body.widgetCount': { source: 'static', value: '' },
    };
    const result = fillBodyWithRandomData(op(schema), existing, true);
    expect(result['body.firstName']).toBeUndefined();
    expect(result['body.widgetCount']).toEqual({ source: 'random', expression: '$rand.integer()' });
  });
});

describe('fillRawBodyWithRandomData', () => {
  it('fills every leaf (including nested/array shapes Form mode cannot represent) with a guessed $rand expression', () => {
    const schema = {
      type: 'object',
      properties: {
        firstName: { type: 'string' },
        widgetCount: { type: 'integer' },
        address: { type: 'object', properties: { city: { type: 'string' } } },
        tags: { type: 'array', items: { type: 'string' } },
      },
    };
    const raw = fillRawBodyWithRandomData(op(schema));
    const parsed = JSON.parse(raw.template);
    expect(parsed).toEqual({
      firstName: '$rand.first()',
      widgetCount: '$rand.integer()',
      address: { city: '$rand.city()' },
      tags: ['$rand.word()'],
    });
    expect(raw.tags).toEqual({});
  });

  it('leaves a file field blank rather than randomizing it', () => {
    const schema = { type: 'object', properties: { avatar: { type: 'string', format: 'binary' } } };
    const parsed = JSON.parse(fillRawBodyWithRandomData(op(schema)).template);
    expect(parsed.avatar).toBe('');
  });

  it('picks one of an enum field\'s declared values instead of a $rand expression', () => {
    const schema = { type: 'object', properties: { status: { type: 'string', enum: ['active', 'inactive'] } } };
    const parsed = JSON.parse(fillRawBodyWithRandomData(op(schema)).template);
    expect(['active', 'inactive']).toContain(parsed.status);
  });
});
