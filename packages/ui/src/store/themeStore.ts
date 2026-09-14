import { create } from 'zustand';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'enlace:theme';

function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

/** Never throws — `localStorage` can be unavailable (privacy mode, some
 * embedded/sandboxed contexts) or absent entirely (this module's own test
 * environment before `test/setup.ts` runs). Falls back to `'system'`, the
 * documented default, rather than let a read/write failure break theming. */
function readStoredPreference(): ThemePreference {
  try {
    const stored = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
    return isThemePreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

function writeStoredPreference(preference: ThemePreference): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Same "never let persistence failures break theming" reasoning as
    // the read side above — worst case, the choice doesn't survive reload.
  }
}

function systemPrefersDark(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
}

/** `'system'` is never itself applied anywhere past this — everything
 * downstream (CSS, CodeMirror's `dark` facet) only ever sees a concrete
 * `'light'`/`'dark'`, resolved here once. */
function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : preference;
}

/** The one DOM write this module makes — everything in tokens.css keys off
 * this same attribute (`:root[data-theme='light']`), so CSS and this store
 * can never disagree about which theme is actually showing. */
function applyToDocument(resolved: ResolvedTheme): void {
  if (typeof document !== 'undefined') document.documentElement.setAttribute('data-theme', resolved);
}

export interface ThemeState {
  preference: ThemePreference;
  /** Always a concrete theme, even when `preference` is `'system'` — see `resolveTheme`. */
  resolved: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
}

const initialPreference = readStoredPreference();

export const useThemeStore = create<ThemeState>()((set) => ({
  preference: initialPreference,
  resolved: resolveTheme(initialPreference),
  setPreference: (preference) => {
    writeStoredPreference(preference);
    const resolved = resolveTheme(preference);
    applyToDocument(resolved);
    set({ preference, resolved });
  },
}));

// Apply once at module load — before React ever renders — so there's no
// flash of the wrong theme on startup. main.tsx imports this module for
// exactly that side effect, ahead of rendering <App />.
applyToDocument(useThemeStore.getState().resolved);

// While the user hasn't overridden the OS choice, keep following it live —
// e.g. the OS switches to dark at sunset with the tab already open. Once
// `setPreference` picks an explicit 'light'/'dark', this listener still
// fires on an OS change but is a no-op (the early return below), since the
// user's own choice should keep winning until they pick 'system' again.
if (typeof matchMedia !== 'undefined') {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const { preference } = useThemeStore.getState();
    if (preference !== 'system') return;
    const resolved = resolveTheme('system');
    applyToDocument(resolved);
    useThemeStore.setState({ resolved });
  });
}
