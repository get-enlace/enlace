import { describe, expect, it } from 'vitest';
import { listRandomMethodNames, resolveRandomExpressionsInRawText } from './randomExpr.js';

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

describe('listRandomMethodNames', () => {
  it('reflects real, callable Chance methods, not hand-maintained plumbing', () => {
    const names = listRandomMethodNames();
    expect(names).toContain('first');
    expect(names).toContain('integer');
    expect(names).not.toContain('constructor');
    expect(names).not.toContain('mixin');
  });
});
