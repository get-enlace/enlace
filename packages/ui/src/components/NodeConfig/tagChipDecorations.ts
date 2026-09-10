import { Annotation, StateEffect, EditorState, type Extension } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view';
import { makeTagPlaceholder, tagPattern } from '@get-enlace/core';
import { randomId } from '../../utils/randomId.js';
import type { BodyTag, WorkflowNode } from '../../types.js';

/**
 * Tag-chip rendering/editing plumbing shared by every CodeMirror-based Raw
 * editor — the full multi-line JSON body/params/header editor
 * (RawBodyEditor.tsx) and the single-line per-field editor
 * (FieldValueEditor.tsx). Everything here works over plain document text via
 * `tagPattern()`'s regex, with no dependency on the JSON language extension
 * — a chip renders identically whether it's sitting inside a JSON string or
 * is a bare scalar field's entire content.
 */

/** Transactions we dispatch ourselves as part of an already-complete state update (tag inserted/removed) — the update listener skips reporting these, since the caller already has the authoritative combined {template, tags} to report in one go. */
export const scripted = Annotation.define<boolean>();
/** Dispatched with no document change, purely to make the chip decoration plugin recompute labels after a tag's config (not its placeholder text) changes. */
export const refreshChips = StateEffect.define<void>();
/** Carries the freshly cloned tag(s) a paste produced (see buildTagAutoCloneExtension) from the transactionFilter that computed them through to the caller's updateListener, which is the only place with access to the rest of rawBody.tags needed to merge them in. Exported so a test can inspect a clone's content directly. */
export const cloneTagsEffect = StateEffect.define<Record<string, BodyTag>>();

function tagLabel(tag: BodyTag, nodesById: Map<string, WorkflowNode>, nodeLabels: Map<string, string>): string {
  // uploaded_file has no sourceNodeId at all — a local attachment, not a
  // reference into another node's response — so it gets its own label
  // before any of the sourceNodeId-based ones below even run.
  if (tag.type === 'uploaded_file') return `📎 ${tag.fileName}`;

  const label = nodesById.has(tag.sourceNodeId) ? nodeLabels.get(tag.sourceNodeId)! : '(missing)';
  if (tag.type === 'response_header') return `${label} → header ${tag.headerName}`;
  if (tag.type === 'response_raw') return `${label} → raw body`;
  if (tag.type === 'response_status') return `${label} → status code`;
  return `${label} → ${tag.jsonPath || 'body'}`;
}

export interface ChipConfig {
  tags: Record<string, BodyTag>;
  nodesById: Map<string, WorkflowNode>;
  nodeLabels: Map<string, string>;
  onClickChip: (tagId: string) => void;
}

class TagChipWidget extends WidgetType {
  constructor(
    readonly tagId: string,
    readonly label: string,
    /** True when the tag's source node no longer exists on the canvas (deleted after the mapping was made), or the placeholder references a tag id with no config at all — either way, this mapping is broken and needs attention, not a normal, healthy chip. */
    readonly broken: boolean,
    /** Null for an unrecognized tag id — there's no BodyTag to edit, so the chip is a plain (non-clickable) warning rather than an entry point into the config modal. */
    readonly onClick: ((tagId: string) => void) | null
  ) {
    super();
  }
  eq(other: TagChipWidget) {
    return other.tagId === this.tagId && other.label === this.label && other.broken === this.broken;
  }
  toDOM() {
    const span = document.createElement('span');
    span.className = this.broken ? 'tag-chip tag-chip--broken' : 'tag-chip';
    span.textContent = this.label;
    if (this.onClick) {
      span.title = this.broken
        ? 'This mapping\'s source node no longer exists — click to fix or remove it'
        : 'Click to edit this mapping';
      // Keep CodeMirror from placing the cursor inside the widget on mousedown.
      span.addEventListener('mousedown', (e) => e.preventDefault());
      span.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onClick!(this.tagId);
      });
    } else {
      span.title = 'Unrecognized tag reference — no mapping is configured for this';
      span.style.cursor = 'default'; // nothing to click into — overrides .tag-chip's default pointer cursor
    }
    return span;
  }
  ignoreEvent() {
    return true;
  }
}

export function buildDecorations(text: string, config: ChipConfig): DecorationSet {
  const ranges = [];
  for (const match of text.matchAll(tagPattern())) {
    const tagId = match[1];
    const tag = config.tags[tagId];
    const from = match.index ?? 0;
    const to = from + match[0].length;

    if (!tag) {
      // Orphaned placeholder — text matches the tag syntax but no config
      // is registered for it (e.g. hand-typed, or copy-pasted from
      // elsewhere). Flagged rather than hidden or rendered as a normal
      // chip, but there's nothing to open a config modal for.
      ranges.push(Decoration.replace({ widget: new TagChipWidget(tagId, 'Unrecognized tag', true, null) }).range(from, to));
      continue;
    }

    // uploaded_file has no sourceNodeId to go stale — whether its actual
    // File is still around only matters at request time (see
    // rawBodyResolver.ts's own "re-select the file" error), not something
    // this decoration plugin has visibility into.
    const broken = tag.type !== 'uploaded_file' && !config.nodesById.has(tag.sourceNodeId);
    const label = tagLabel(tag, config.nodesById, config.nodeLabels);
    ranges.push(Decoration.replace({ widget: new TagChipWidget(tagId, label, broken, config.onClickChip) }).range(from, to));
  }
  return Decoration.set(ranges);
}

export function chipPlugin(configRef: { current: ChipConfig }) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildDecorations(view.state.doc.toString(), configRef.current);
      }
      update(update: ViewUpdate) {
        const forced = update.transactions.some((tr) => tr.effects.some((e) => e.is(refreshChips)));
        if (update.docChanged || forced) {
          this.decorations = buildDecorations(update.state.doc.toString(), configRef.current);
        }
      }
    },
    { decorations: (v) => v.decorations }
  );
}

/**
 * A tag chip's placeholder text (`{{enlace:<id>}}`) is, to CodeMirror, just
 * plain document text — copying a chip and pasting it into another field
 * copies that literal text, id and all, rather than the config it renders.
 * Left alone, that produces two placeholders sharing one `BodyTag` entry:
 * editing "the pasted one" is really editing the one shared config, so the
 * original chip silently changes too. Every *other* way of getting a
 * placeholder into the doc (typing `{{` through the autocomplete flow)
 * always mints a fresh id, so this is reachable only via copy-paste — and
 * nobody pasting a chip expects aliasing.
 *
 * This transactionFilter runs on every doc-changing transaction (including
 * paste) and, whenever it finds a placeholder id repeated in the resulting
 * document, rewrites every occurrence past the first to a freshly minted id
 * with its own cloned copy of the original tag's config — as part of the
 * *same* transaction (`sequential: true` interprets the rename's positions
 * against the document the first spec just produced, not the pre-paste
 * one), so the doc and its tags never observably pass through the aliased
 * state. The clone itself travels to the caller's updateListener via
 * `cloneTagsEffect`, since only the caller has the rest of rawBody.tags in
 * scope to merge it into.
 *
 * `getExistingTags` is read fresh on every transaction (not captured once)
 * so this always clones from the current config, not a stale closure.
 */
export function buildTagAutoCloneExtension(getExistingTags: () => Record<string, BodyTag>): Extension {
  return EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged || tr.annotation(scripted)) return tr;

    const existingTags = getExistingTags();
    const newText = tr.newDoc.toString();
    const seenIds = new Set<string>();
    const renameChanges: { from: number; to: number; insert: string }[] = [];
    const cloned: Record<string, BodyTag> = {};

    for (const match of newText.matchAll(tagPattern())) {
      const id = match[1];
      if (!seenIds.has(id)) {
        seenIds.add(id);
        continue;
      }
      const original = existingTags[id];
      if (!original) continue; // orphaned/unrecognized id — nothing to clone from

      const newId = randomId();
      cloned[newId] = { ...original, id: newId };
      const from = match.index ?? 0;
      renameChanges.push({ from, to: from + match[0].length, insert: makeTagPlaceholder(newId) });
    }

    if (renameChanges.length === 0) return tr;
    return [tr, { changes: renameChanges, effects: cloneTagsEffect.of(cloned), sequential: true }];
  });
}
