import { useEffect, useId, useRef, useState, type ComponentType } from 'react';
import { useWorkflowStore } from '../../store/workflowStore.js';
import { useThemeStore, type ThemePreference } from '../../store/themeStore.js';
import { CredentialsPanel } from '../Credentials/index.js';
import { WorkflowFileMenu, type WorkflowFileMenuHandle } from './WorkflowFileMenu.js';

// One button, one icon at a time — clicking cycles System -> Light -> Dark
// -> System, same "single control that changes" feel as Docusaurus's own
// navbar toggle, rather than three always-visible options sitting side by
// side. Order matters here: it's the click order too, not just display.
const THEME_CYCLE: Array<{ value: ThemePreference; label: string; Icon: ComponentType }> = [
  { value: 'system', label: 'System', Icon: SystemIcon },
  { value: 'light', label: 'Light', Icon: SunIcon },
  { value: 'dark', label: 'Dark', Icon: MoonIcon },
];

function nextThemePreference(current: ThemePreference): ThemePreference {
  const index = THEME_CYCLE.findIndex((o) => o.value === current);
  return THEME_CYCLE[(index + 1) % THEME_CYCLE.length].value;
}

/**
 * Chrome-corner settings: Credentials, Export, and Import live behind one
 * gear control so the header stays brand + run + this, not a tool dump.
 */
export function ChromeSettingsMenu() {
  const credentials = useWorkflowStore((s) => s.credentials);
  const nodes = useWorkflowStore((s) => s.nodes);
  const isRunning = useWorkflowStore((s) => s.isRunning);
  const themePreference = useThemeStore((s) => s.preference);
  const setThemePreference = useThemeStore((s) => s.setPreference);

  const [menuOpen, setMenuOpen] = useState(false);
  const [credsOpen, setCredsOpen] = useState(false);
  const fileMenuRef = useRef<WorkflowFileMenuHandle>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      setMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);
  const toggleMenu = () => setMenuOpen((v) => !v);

  return (
    <>
      <div
        ref={rootRef}
        className="chrome-settings"
        role="button"
        tabIndex={0}
        aria-label="Settings"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title="Settings"
        onClick={toggleMenu}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleMenu();
          }
        }}
      >
        <span className="chrome-settings__glyph" aria-hidden="true">
          <SettingsGearIcon />
        </span>

        {menuOpen && (
          <div
            ref={menuRef}
            className="chrome-settings__menu"
            role="menu"
            aria-label="Settings"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              role="menuitem"
              className="chrome-settings__item"
              onClick={() => {
                closeMenu();
                setCredsOpen(true);
              }}
            >
              <KeyIcon />
              <span>Credentials ({credentials.length})</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="chrome-settings__item"
              disabled={nodes.length === 0}
              title={nodes.length === 0 ? 'Add a node before exporting.' : undefined}
              onClick={() => {
                closeMenu();
                fileMenuRef.current?.openExport();
              }}
            >
              <ExportIcon />
              <span>Export</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="chrome-settings__item"
              disabled={isRunning}
              title={isRunning ? "Can't import while the workflow is running." : undefined}
              onClick={() => {
                closeMenu();
                fileMenuRef.current?.openImport();
              }}
            >
              <ImportIcon />
              <span>Import</span>
            </button>

            <div className="chrome-settings__divider" role="separator" />

            {(() => {
              const current = THEME_CYCLE.find((o) => o.value === themePreference) ?? THEME_CYCLE[0];
              const Icon = current.Icon;
              return (
                <button
                  type="button"
                  role="menuitem"
                  className="chrome-settings__item chrome-settings__theme-toggle"
                  aria-label={`Theme: ${current.label} (click to switch)`}
                  title={`Theme: ${current.label} — click to switch`}
                  onClick={() => setThemePreference(nextThemePreference(themePreference))}
                >
                  <Icon />
                  <span>Theme: {current.label}</span>
                </button>
              );
            })()}
          </div>
        )}
      </div>

      <CredentialsPanel showTrigger={false} open={credsOpen} onOpenChange={setCredsOpen} />
      <WorkflowFileMenu ref={fileMenuRef} hideButtons />
    </>
  );
}

function SettingsGearIcon() {
  return (
    <svg className="chrome-settings__icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="currentColor"
        d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.07 7.07 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.59.24-1.13.55-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.77 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.89 14.5a.5.5 0 0 0-.12.64l1.92 3.32c.12.22.37.3.6.22l2.39-.96c.5.39 1.04.71 1.63.94l.36 2.54c.05.24.26.42.5.42h3.84c.24 0 .45-.18.5-.42l.36-2.54c.59-.24 1.13-.55 1.63-.94l2.39.96c.23.08.48 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"
      />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg className="chrome-settings__item-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="M10.5 2a3.5 3.5 0 0 0-3.37 4.4L2 11.53V14h2.5l.5-.5.5.5H8v-1.5L11.6 8.87A3.5 3.5 0 1 0 10.5 2zm0 2a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z"
      />
    </svg>
  );
}

function ExportIcon() {
  return (
    <svg className="chrome-settings__item-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 2.5 4.5 6h2v4h3V6h2L8 2.5zM3 12v1.5h10V12H3z"
      />
    </svg>
  );
}

function ImportIcon() {
  return (
    <svg className="chrome-settings__item-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 10.5 11.5 7h-2V3h-3v4h-2L8 10.5zM3 12v1.5h10V12H3z"
      />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg className="chrome-settings__item-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <circle cx="8" cy="8" r="3.2" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        <line x1="8" y1="0.8" x2="8" y2="2.6" />
        <line x1="8" y1="13.4" x2="8" y2="15.2" />
        <line x1="0.8" y1="8" x2="2.6" y2="8" />
        <line x1="13.4" y1="8" x2="15.2" y2="8" />
        <line x1="2.87" y1="2.87" x2="4.16" y2="4.16" />
        <line x1="11.84" y1="11.84" x2="13.13" y2="13.13" />
        <line x1="2.87" y1="13.13" x2="4.16" y2="11.84" />
        <line x1="11.84" y1="4.16" x2="13.13" y2="2.87" />
      </g>
    </svg>
  );
}

function MoonIcon() {
  // A crescent silhouette — a filled circle with a second, offset circle
  // masked out of it — rather than a hand-picked path, so the shape is
  // guaranteed to actually render as a crescent regardless of the exact
  // radii/offset chosen. `maskId` is per-instance (useId) so this stays
  // correct even if this icon is ever mounted more than once at a time.
  const maskId = useId();
  return (
    <svg className="chrome-settings__item-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <mask id={maskId}>
        <rect width="16" height="16" fill="#fff" />
        <circle cx="10.5" cy="5.5" r="5" fill="#000" />
      </mask>
      <circle cx="7.5" cy="8" r="6.5" fill="currentColor" mask={`url(#${maskId})`} />
    </svg>
  );
}

function SystemIcon() {
  return (
    <svg className="chrome-settings__item-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="1.3" y="2.3" width="13.4" height="9" rx="1.2" />
      <path strokeLinecap="round" d="M5.5 14h5M8 11.3V14" />
    </svg>
  );
}
