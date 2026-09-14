import { useEffect, useRef, useState } from 'react';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, type ViewUpdate, keymap, tooltips } from '@codemirror/view';
import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { makeTagPlaceholder, tagPattern } from '@get-enlace/core';
import type { BodyTag, BodyTagType, Operation, RawBody, WorkflowNode } from '../../types.js';
import { TagConfigModal } from './TagConfigModal.js';
import { buildTagAutoCloneExtension, chipPlugin, cloneTagsEffect, refreshChips, scripted, type ChipConfig } from './tagChipDecorations.js';
import { useThemeStore } from '../../store/themeStore.js';

export interface FieldValueEditorProps {
  /** Param/header name this field is for — rendered inline immediately before the field's own input box. */
  label: string;
  value: RawBody;
  onChange: (value: RawBody) => void;
  ancestorNodes: WorkflowNode[];
  nodeLabels: Map<string, string>;
  operations: Operation[];
  readOnly?: boolean;
}

/**
 * A single-line, `{{`-aware value editor for one path/query/header field —
 * the per-field sibling of RawBodyEditor.tsx's full multi-line JSON editor
 * (used only for the request body now; see OperationNode's own comments in
 * @get-enlace/core's types.ts for why params/headers split into one field
 * each). One plain CodeMirror doc (no gutters/folding/JSON language — it's
 * not a document, just a scalar): type a literal value, or type `{{` to
 * open the same `TagConfigModal` Body's editor uses and insert a mapped
 * chip — the chip itself, rendered inline via the shared tag-chip
 * decoration plugin, is what shows a field is mapped. There used to be a
 * separate Static/Mapped tab pair here (a plain text box vs. two selects
 * writing the same whole-field chip) — dropped once it was actually tried:
 * the chip is already the visual "this is mapped" signal, so a second UI
 * for producing exactly the same thing it does today (typing `{{`) was
 * redundant, not a real alternative path.
 */
export function FieldValueEditor({ label, value, onChange, ancestorNodes, nodeLabels, operations, readOnly = false }: FieldValueEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const configRef = useRef<ChipConfig>(null as unknown as ChipConfig);
  const liveRef = useRef({ value, onChange });
  liveRef.current = { value, onChange };
  const readOnlyCompartmentRef = useRef(new Compartment());
  // Same reasoning as RawBodyEditor.tsx's own isDark — drives a full
  // rebuild on theme flip rather than a second Compartment.
  const isDark = useThemeStore((s) => s.resolved === 'dark');

  const [pendingInsert, setPendingInsert] = useState<{ type: BodyTagType; from: number; to: number } | null>(null);
  const [editingTagId, setEditingTagId] = useState<string | null>(null);

  const nodesById = new Map(ancestorNodes.map((n) => [n.id, n]));

  configRef.current = {
    tags: value.tags,
    nodesById,
    nodeLabels,
    onClickChip: (tagId) => setEditingTagId(tagId),
  };

  useEffect(() => {
    if (!containerRef.current) return;

    const updateListener = EditorView.updateListener.of((update: ViewUpdate) => {
      if (!update.docChanged) return;
      if (update.transactions.some((tr) => tr.annotation(scripted))) return;

      const clonedTags: Record<string, BodyTag> = {};
      for (const tr of update.transactions) {
        for (const effect of tr.effects) {
          if (effect.is(cloneTagsEffect)) Object.assign(clonedTags, effect.value);
        }
      }

      const template = update.state.doc.toString();
      const presentIds = new Set([...template.matchAll(tagPattern())].map((m) => m[1]));
      const mergedTags = { ...liveRef.current.value.tags, ...clonedTags };
      const tags = Object.fromEntries(Object.entries(mergedTags).filter(([id]) => presentIds.has(id)));
      liveRef.current.onChange({ template, tags });
    });

    const chipPluginType = chipPlugin(configRef);

    const extensions: Extension[] = [
      ...buildScalarExtensions((type, from, to) => setPendingInsert({ type, from, to }), isDark),
      buildTagAutoCloneExtension(() => liveRef.current.value.tags),
      chipPluginType,
      EditorView.atomicRanges.of((view) => view.plugin(chipPluginType)?.decorations ?? Decoration.none),
      updateListener,
      readOnlyCompartmentRef.current.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
    ];

    const view = new EditorView({ doc: liveRef.current.value.template, extensions, parent: containerRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Only `isDark` — see RawBodyEditor.tsx's identical mount effect for why.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDark]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (view.state.doc.toString() === value.template) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value.template }, annotations: scripted.of(true) });
  }, [value.template]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readOnlyCompartmentRef.current.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
    });
  }, [readOnly]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: refreshChips.of() });
  }, [value.tags]);

  // Same focus-return reasoning as RawBodyEditor.tsx's own refocusEditor —
  // a tag popup closing with focus sitting nowhere lets a stray Delete/
  // Backspace fall through to React Flow's node-delete handler.
  function refocusEditor() {
    viewRef.current?.focus();
  }

  function handleInsertConfirm(tag: BodyTag, file?: File) {
    const view = viewRef.current;
    if (!view || !pendingInsert) return;
    const docLength = view.state.doc.length;
    const from = Math.min(pendingInsert.from, docLength);
    const to = Math.min(Math.max(pendingInsert.to, from), docLength);
    view.dispatch({ changes: { from, to, insert: makeTagPlaceholder(tag.id) }, annotations: scripted.of(true) });
    onChange({ template: view.state.doc.toString(), tags: { ...value.tags, [tag.id]: tag } });
    void file; // never set — FieldValueEditor never offers "Upload file" (see TagConfigModal's allowFileUpload, omitted below)
    setPendingInsert(null);
    refocusEditor();
  }

  function handleEditConfirm(tag: BodyTag) {
    onChange({ template: value.template, tags: { ...value.tags, [tag.id]: tag } });
    setEditingTagId(null);
    refocusEditor();
  }

  function handleDelete() {
    const view = viewRef.current;
    if (!view || !editingTagId) return;
    const match = new RegExp(`\\{\\{enlace:${editingTagId}\\}\\}`).exec(view.state.doc.toString());
    if (match) {
      view.dispatch({ changes: { from: match.index, to: match.index + match[0].length, insert: '' }, annotations: scripted.of(true) });
    }
    const tags = { ...value.tags };
    delete tags[editingTagId];
    onChange({ template: view.state.doc.toString(), tags });
    setEditingTagId(null);
    refocusEditor();
  }

  const editingTag = editingTagId ? value.tags[editingTagId] : undefined;

  return (
    <div className="field-value-editor">
      <span className="field-value-editor__label" title={label}>
        {label}
      </span>
      <div
        className={`raw-body-editor__codemirror field-value-editor__codemirror${readOnly ? ' raw-body-editor__codemirror--readonly' : ''}`}
        ref={containerRef}
      />

      {pendingInsert && (
        <TagConfigModal
          ancestorNodes={ancestorNodes}
          nodeLabels={nodeLabels}
          operations={operations}
          initialType={pendingInsert.type}
          onConfirm={handleInsertConfirm}
          onCancel={() => {
            setPendingInsert(null);
            refocusEditor();
          }}
        />
      )}

      {editingTag && (
        <TagConfigModal
          ancestorNodes={ancestorNodes}
          nodeLabels={nodeLabels}
          operations={operations}
          initialType={editingTag.type}
          initialTag={editingTag}
          onConfirm={handleEditConfirm}
          onDelete={handleDelete}
          onCancel={() => {
            setEditingTagId(null);
            refocusEditor();
          }}
        />
      )}
    </div>
  );
}

/** `{{` completion for a single-line scalar field — same "Response → Map from..." entry point RawBodyEditor.tsx's Body editor offers, minus the JSON-string-node check (there's no JSON language installed here; the whole doc is the string) and minus "Upload file" (never valid outside a multipart body). */
function scalarTagCompletionSource(onTrigger: (type: BodyTagType, from: number, to: number) => void) {
  return (context: CompletionContext): CompletionResult | null => {
    const match = context.matchBefore(/\{\{\w*/);
    if (!match) return null;
    return {
      from: match.from,
      to: match.to,
      filter: false,
      options: [
        { label: 'Response → Map from...', apply: (_view, _completion, from, to) => onTrigger('response_body', from, to) },
      ] satisfies Completion[],
    };
  };
}

/** The extension set for a single-line field doc — no JSON language, no gutters/folding/lint (a field is one scalar, never structured), and Enter is swallowed rather than inserting a newline. */
function buildScalarExtensions(
  onTriggerTag: (type: BodyTagType, from: number, to: number) => void,
  /** See RawBodyEditor.tsx's `buildJsonAutocompleteExtensions`'s own `dark` param — same reasoning, same default. */
  dark = true
): Extension[] {
  return [
    history(),
    keymap.of([{ key: 'Enter', run: () => true }, ...defaultKeymap, ...historyKeymap]),
    autocompletion({ override: [scalarTagCompletionSource(onTriggerTag)] }),
    EditorView.theme({}, { dark }),
    tooltips({ parent: document.body }),
  ];
}
