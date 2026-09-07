import { describe, expect, it } from 'vitest';
import {
  isWholeRandomExprMatch,
  listRandomMethodNames,
  resolveRandomExpressionsInRawText,
  resolveRandomExpressionsInValue,
} from './randomExpr.js';

describe('resolveRandomExpressionsInRawText', () => {
  it('leaves text with no $rand call untouched', () => {
    expect(resolveRandomExpressionsInRawText('{"a":"b"}')).toBe('{"a":"b"}');
  });

  it('substitutes a whole-string no-arg call, preserving its real generated type', () => {
    const result = resolveRandomExpressionsInRawText('{"active":"$rand.bool()"}');
    expect(JSON.parse(result)).toEqual({ active: expect.any(Boolean) });
  });

  it('parses a bare (unquoted-key) args object the way a hand-typed one would look', () => {
    const result = resolveRandomExpressionsInRawText('{"age":"$rand.integer({min: 5, max: 5})"}');
    expect(JSON.parse(result)).toEqual({ age: 5 });
  });

  it('splices a resolved value as escaped text when embedded in a larger string', () => {
    const result = resolveRandomExpressionsInRawText('{"greeting":"Hi $rand.integer({min: 1, max: 1})!"}');
    expect(JSON.parse(result)).toEqual({ greeting: 'Hi 1!' });
  });

  it('resolves two independent calls in the same template, each getting its own value', () => {
    const result = resolveRandomExpressionsInRawText(
      '{"a":"$rand.integer({min: 1, max: 1})","b":"$rand.integer({min: 2, max: 2})"}'
    );
    expect(JSON.parse(result)).toEqual({ a: 1, b: 2 });
  });

  it('throws a clear error for a method Chance doesn\'t have', () => {
    expect(() => resolveRandomExpressionsInRawText('{"x":"$rand.notAMethod()"}')).toThrow(/isn't a Chance method/);
  });

  it('throws a clear error when the args block fails to parse', () => {
    expect(() => resolveRandomExpressionsInRawText('{"x":"$rand.integer({min: )"}')).toThrow(/Couldn't parse arguments/);
  });
});

describe('resolveRandomExpressionsInValue', () => {
  it('resolves a $rand call that is a whole Form-mode field value', () => {
    expect(resolveRandomExpressionsInValue('$rand.integer({min: 3, max: 3})')).toBe(3);
  });

  it('leaves a plain string with no $rand call untouched', () => {
    expect(resolveRandomExpressionsInValue('hello')).toBe('hello');
  });

  it('recurses into nested arrays/objects', () => {
    const value = { items: ['$rand.integer({min: 9, max: 9})', { n: '$rand.integer({min: 4, max: 4})' }] };
    expect(resolveRandomExpressionsInValue(value)).toEqual({ items: [9, { n: 4 }] });
  });
});

describe('isWholeRandomExprMatch', () => {
  it('is true for exactly one call and nothing else', () => {
    expect(isWholeRandomExprMatch('$rand.first()')).toBe(true);
  });

  it('is false when embedded in other text', () => {
    expect(isWholeRandomExprMatch('id-$rand.guid()')).toBe(false);
  });

  it('is false for plain text', () => {
    expect(isWholeRandomExprMatch('hello')).toBe(false);
  });
});

describe('listRandomMethodNames', () => {
  it('reflects real, callable Chance methods, not hand-maintained plumbing', () => {
    const names = listRandomMethodNames();
    expect(names).toContain('first');
    expect(names).toContain('integer');
    expect(names).not.toContain('constructor');
    expect(names).not.toContain('mixin');
  });
});
