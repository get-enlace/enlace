import { beforeEach, describe, expect, it } from 'vitest';
import { useThemeStore } from './themeStore.js';

const STORAGE_KEY = 'enlace:theme';

describe('themeStore', () => {
  beforeEach(() => {
    localStorage.clear();
    // Reset to the documented default rather than whatever an earlier
    // test (in this file or another) left behind — same pattern every
    // other store's tests already use.
    useThemeStore.setState({ preference: 'system', resolved: 'light' });
  });

  it('setPreference("dark") resolves to dark, persists it, and stamps <html data-theme="dark">', () => {
    useThemeStore.getState().setPreference('dark');

    expect(useThemeStore.getState()).toMatchObject({ preference: 'dark', resolved: 'dark' });
    expect(localStorage.getItem(STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('setPreference("light") resolves to light, persists it, and stamps <html data-theme="light">', () => {
    useThemeStore.getState().setPreference('light');

    expect(useThemeStore.getState()).toMatchObject({ preference: 'light', resolved: 'light' });
    expect(localStorage.getItem(STORAGE_KEY)).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('setPreference("system") resolves against the OS preference, never left as the literal "system"', () => {
    // test/setup.ts's matchMedia stub reports `matches: false` — i.e. "OS
    // prefers light" — so this is the one concrete value 'system' can
    // resolve to in this test environment.
    useThemeStore.getState().setPreference('system');

    expect(useThemeStore.getState()).toMatchObject({ preference: 'system', resolved: 'light' });
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('switching between preferences updates both the store and localStorage each time, not just the first', () => {
    useThemeStore.getState().setPreference('dark');
    useThemeStore.getState().setPreference('light');

    expect(useThemeStore.getState().preference).toBe('light');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('light');
  });
});
