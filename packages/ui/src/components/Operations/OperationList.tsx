import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import type { Operation } from '../../types.js';

interface Props {
  operations: Operation[];
}

/** Imperative handle so App.tsx's global "press space to search" shortcut can focus this panel's search box without lifting its query state up. */
export interface OperationListHandle {
  focusSearch: () => void;
}

const UNTAGGED = '(untagged)';

type DockTab = 'operations' | 'presets';

/** Every preset the Presets tab can drag — same two kinds PresetsNodeCard.tsx/graphSlice.ts know about. */
const PRESET_DEFS: Array<{ kind: 'wait' | 'assert'; label: string; description: string; icon: string }> = [
  { kind: 'wait', label: 'Wait', description: 'Pause for a set time', icon: '⏱' },
  { kind: 'assert', label: 'Assert', description: 'Check a response value', icon: '✓' },
];

function groupOperations(ops: Operation[]): Array<{ tag: string; operations: Operation[] }> {
  const order: string[] = [];
  const map = new Map<string, Operation[]>();

  for (const op of ops) {
    const tag = op.tags?.[0] ?? UNTAGGED;
    if (!map.has(tag)) {
      order.push(tag);
      map.set(tag, []);
    }
    map.get(tag)!.push(op);
  }

  // Named tags in declaration order, untagged always last.
  return order
    .filter((t) => t !== UNTAGGED)
    .concat(order.includes(UNTAGGED) ? [UNTAGGED] : [])
    .map((tag) => ({ tag, operations: map.get(tag)! }));
}

export const OperationList = forwardRef<OperationListHandle, Props>(function OperationList({ operations }, ref) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => ({ focusSearch: () => searchInputRef.current?.focus() }));

  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<DockTab>('operations');
  // Groups start expanded (a first-time user should see operations without
  // an extra click); this tracks the ones the user has explicitly collapsed.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const trimmedQuery = query.trim().toLowerCase();
  const searching = trimmedQuery.length > 0;
  // Search is scoped to the active tab. On Operations a leading '/'
  // searches paths only, anything else matches operationId. On Presets it
  // matches the preset name.
  const isPathSearch = trimmedQuery.startsWith('/');

  const matchingOperations = !searching
    ? operations
    : operations.filter((op) =>
        isPathSearch ? op.path.toLowerCase().includes(trimmedQuery) : op.operationId?.toLowerCase().includes(trimmedQuery)
      );
  const matchingPresets = !searching
    ? PRESET_DEFS
    : isPathSearch
      ? []
      : PRESET_DEFS.filter((p) => p.label.toLowerCase().includes(trimmedQuery));

  const filtered = matchingOperations;
  const filteredPresets = matchingPresets;
  // Muted pointer to the *other* tab when it has hits the active one doesn't show.
  const otherTabMatches = searching ? (tab === 'operations' ? filteredPresets.length : filtered.length) : 0;

  const emptyMessage =
    tab === 'presets'
      ? `No presets match "${query}".`
      : isPathSearch
        ? `No operations match "${query}".`
        : `No operations match "${query}".`;

  const groups = groupOperations(filtered);
  const multipleGroups = groups.length > 1 || (groups.length === 1 && groups[0].tag !== UNTAGGED);

  const allTags = groups.map((g) => g.tag);
  const allExpanded = allTags.length > 0 && allTags.every((tag) => !collapsed.has(tag));

  const toggleGroup = (tag: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  const toggleAll = () => {
    setCollapsed(allExpanded ? new Set(allTags) : new Set());
  };

  const renderItem = (op: Operation) => (
    <li key={op.id} draggable onDragStart={(e) => e.dataTransfer.setData('text/operation-id', op.id)}>
      <fieldset className={`operation-list__item operation-list__item--${op.method}`}>
        {op.operationId && <legend className="operation-list__operation-id">{op.operationId}</legend>}
        <span className={`method-badge method-badge--${op.method}`}>{op.method.toUpperCase()}</span>
        <span className="operation-list__path">{op.path}</span>
      </fieldset>
    </li>
  );

  return (
    <aside className="operation-list">
      {/* One search box up top governs both sections below it (see the three
          modes computed above) — search reads as "search this whole panel",
          not "search Operations", so it belongs above both, not wedged
          between them. */}
      <div className="operation-list__search">
        <input
          ref={searchInputRef}
          type="text"
          placeholder={tab === 'presets' ? 'Search presets…' : 'Search operations…'}
          aria-label="Search operations and presets"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="dock-tabs" role="tablist" aria-label="Palette">
        {(['operations', 'presets'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`dock-tab-${t}`}
            aria-selected={tab === t}
            aria-controls="dock-panel"
            tabIndex={tab === t ? 0 : -1}
            className={`dock-tabs__tab${tab === t ? ' dock-tabs__tab--active' : ''}`}
            onClick={() => setTab(t)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                e.preventDefault();
                const next: DockTab = t === 'operations' ? 'presets' : 'operations';
                setTab(next);
                document.getElementById(`dock-tab-${next}`)?.focus();
              }
            }}
          >
            {t === 'operations' ? 'Operations' : 'Presets'}
            <span className="dock-tabs__count">{t === 'operations' ? operations.length : PRESET_DEFS.length}</span>
          </button>
        ))}
      </div>
      {otherTabMatches > 0 && (
        <button
          type="button"
          className="dock-tabs__hint"
          onClick={() => setTab(tab === 'operations' ? 'presets' : 'operations')}
        >
          {otherTabMatches} {otherTabMatches === 1 ? 'match' : 'matches'} in {tab === 'operations' ? 'Presets' : 'Operations'} →
        </button>
      )}
      <div id="dock-panel" role="tabpanel" aria-labelledby={`dock-tab-${tab}`}>
      {tab === 'presets' ? (
        filteredPresets.length === 0 ? (
          <p className="operation-list__empty">{emptyMessage}</p>
        ) : (
          <ul className="preset-rows">
            {filteredPresets.map((preset) => (
              <li
                key={preset.kind}
                className="preset-rows__item"
                draggable
                onDragStart={(e) => e.dataTransfer.setData('text/preset-kind', preset.kind)}
              >
                <span className={`preset-rows__icon preset-rows__icon--${preset.kind}`} aria-hidden="true">
                  {preset.icon}
                </span>
                <span className="preset-rows__text">
                  <span className="preset-rows__name">{preset.label}</span>
                  <span className="preset-rows__desc">{preset.description}</span>
                </span>
              </li>
            ))}
          </ul>
        )
      ) : (
        <>
      {multipleGroups && !searching && (
        <div className="operation-list__heading">
          <button type="button" className="operation-list__toggle-all" onClick={toggleAll}>
            {allExpanded ? 'Collapse all' : 'Expand all'}
          </button>
        </div>
      )}
      {searching && filtered.length === 0 ? (
        <p className="operation-list__empty">{emptyMessage}</p>
      ) : filtered.length === 0 ? null : multipleGroups ? (
        <div className="operation-list__groups">
          {groups.map(({ tag, operations: groupOps }) => {
            // While searching, every remaining group has a match — expand them
            // so the hits are visible without an extra click.
            const isExpanded = searching || !collapsed.has(tag);
            return (
              <div key={tag} className="operation-list__group">
                <button
                  type="button"
                  className={`operation-list__group-header${isExpanded ? '' : ' operation-list__group-header--collapsed'}`}
                  onClick={() => toggleGroup(tag)}
                  aria-expanded={isExpanded}
                >
                  <span className="operation-list__group-chevron">{isExpanded ? '⌄' : '›'}</span>
                  <span className="operation-list__group-name">{tag}</span>
                  <span className="operation-list__group-count">{groupOps.length}</span>
                </button>
                {isExpanded && <ul>{groupOps.map(renderItem)}</ul>}
              </div>
            );
          })}
        </div>
      ) : (
        <ul>{filtered.map(renderItem)}</ul>
      )}
        </>
      )}
      </div>
    </aside>
  );
});
