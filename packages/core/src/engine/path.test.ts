import { describe, expect, it } from 'vitest';
import { getByPath } from './path.js';

describe('path utilities', () => {
  describe('getByPath', () => {
    it('resolves nested and array paths', () => {
      const obj = { order: { items: [{ id: 'abc' }] } };
      expect(getByPath(obj, 'order.items[0].id')).toBe('abc');
    });

    it('returns undefined for missing paths without throwing', () => {
      expect(getByPath({ a: 1 }, 'a.b.c')).toBeUndefined();
      expect(getByPath(null, 'a.b')).toBeUndefined();
    });
  });
});
