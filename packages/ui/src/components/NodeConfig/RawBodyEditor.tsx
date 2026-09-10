import { useEffect, useRef, useState } from 'react';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, keymap, lineNumbers, tooltips } from '@codemirror/view';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { codeFolding, foldGutter, foldKeymap, HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { linter } from '@codemirror/lint';
import { tags as t } from '@lezer/highlight';
import {
  autocompletion,
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { listRandomMethodNames, makeTagPlaceholder, RANDOM_METHOD_ARG_HINTS, randomExprPattern, tagPattern } from '@get-enlace/core';
import type { BodyTag, BodyTagType, Operation, RawBody, WorkflowNode } from '../../types.js';
import { BeautifyIcon } from '../chromeIcons.js';
import { TagConfigModal } from './TagConfigModal.js';
import { buildTagAutoCloneExtension, chipPlugin, cloneTagsEffect, refreshChips, scripted, type ChipConfig } from './tagChipDecorations.js';

export interface RawBodyEditorProps {
  rawBody: RawBody;
  onChange: (rawBody: RawBody) => void;
  ancestorNodes: WorkflowNode[];
  /** Precomputed by the caller across the *whole* workflow (see utils/nodeLabel.ts's
   * buildNodeLabels) — not just `ancestorNodes` — so a tag chip's label always matches what the
   * same node shows on its canvas card and in every other picker. */
  nodeLabels: Map<string, string>;
  /** Forwarded to TagConfigModal, which uses it to power the "Filter (JSONPath)" field's response-path autocomplete. */
  operations: Operation[];
  /**
   * Rejects edits at the CodeMirror level (`EditorState.readOnly`), not
   * just by the caller ignoring `onChange` — this editor isn't a plain
   * controlled React input, so it manages its own document imperatively;
   * blocking the store update alone would leave a keystroke visibly
   * "stick" in the editor with no way for it to ever resync back to the
   * true (unchanged) `rawBody.template`, since the resync effect below
   * only fires when that prop actually changes. See NodeConfig.tsx,
   * the only caller, for why this is ever true (a run in progress).
   */
  readOnly?: boolean;
  /** When false, skip the per-editor "{{" tip — NodeConfig shows one shared hint under Request. */
  showHint?: boolean;
  /** Body-only, multipart-only: offers "Upload file" in the `{{` popup and the config modal's own type dropdown. Omitted (path/query editors, or a non-multipart body) means neither ever appears — a File has nowhere to go outside a multipart body (see rawBodyResolver.ts). */
  allowFileUpload?: boolean;
  /** Body-only: offers `$rand.<method>()` completion (see randCompletionSource below). Omitted for path/query/header editors — those values are read off the response/URL, not generated, so a random string there is never actually useful. */
  allowRandom?: boolean;
  /**
   * Path/query/header only: drops the line-number and fold gutters. Those
   * sections are always flat (OpenAPI never nests a param), usually one or
   * two keys, and seeded compact (see utils/rawDefaults.ts) rather than
   * pretty-printed — the gutters (and folding, meaningless with nothing to
   * fold) were disproportionate editor chrome for content that's often a
   * single line. Body keeps both, since real nesting there is common and
   * folding earns its keep.
   */
  compact?: boolean;
  /** Required whenever `allowFileUpload` is true — this component only collects the `File` (via TagConfigModal), it never touches the store itself; the caller (NodeConfig.tsx) is what has the node id `uploadedFiles` needs to be keyed under (see bodyTags.ts's `rawFileTagFieldPath`). `file: null` on an edit means "the file was cleared" — currently only reachable by deleting the whole tag instead, kept nullable for symmetry with NodeConfig's own `setUploadedFile`. */
  onUploadFile?: (tagId: string, file: File | null) => void;
}

// `json()` only supplies the parser/language — it applies no color on its
// own; without a `syntaxHighlighting` extension the doc renders as flat,
// unstyled text regardless of language support. Colors reuse the app's
// existing method-badge palette (styles/method-badges.css) rather than a
// generic code-theme, so the editor reads as part of the same system:
// property names in the same blue as a GET badge, string values in the
// same green as a POST badge, numbers/booleans in PUT's orange, null in
// the cookie-credential purple, punctuation muted.
const jsonHighlightStyle = HighlightStyle.define([
  { tag: t.propertyName, color: 'var(--color-get)' },
  { tag: t.string, color: 'var(--color-post)' },
  { tag: [t.number, t.bool], color: 'var(--color-put)' },
  { tag: t.null, color: 'var(--color-cookie)' },
  { tag: [t.separator, t.squareBracket, t.brace], color: 'var(--color-text-muted)' },
]);

/**
 * Autocomplete source: typing `{{` while the cursor is inside a JSON
 * string literal offers a single "Response" entry point — since every tag
 * type maps from an upstream response, splitting that into three
 * separately-typed options up front just made you commit to one before
 * you'd even picked a request to map from. Picking it opens the config
 * modal defaulted to `response_body` (the common case); the modal's own
 * "Map" dropdown (see TagConfigModal.tsx) is where the type actually gets
 * chosen/changed, mirroring the reference tool's "Function to Perform" +
 * "Attribute" split. The placeholder itself is inserted only once that
 * modal is confirmed (see handleInsertConfirm), replacing only the typed
 * `{{...` trigger text — not the whole enclosing string.
 *
 * That's deliberate, not an oversight: composing a chip with surrounding
 * literal text in the same field (`"Bearer {{token}}"`, `"order-{{id}}"`)
 * is a real, common need — prefixing/suffixing a mapped value — and
 * forcing the whole field to become just the chip would make that
 * impossible to build through this discoverable flow. The one trap this
 * reopens (typing `{{` inside Raw mode's schema-example placeholder text,
 * e.g. `"string"`, without clearing it first, leaves the chip embedded in
 * leftover text you probably didn't mean to keep) is a copy-editing rough
 * edge, not a correctness one: engine/rawBodyResolver.ts's resolveRawBody
 * resolves an embedded tag correctly regardless, so the worst case is a
 * field that looks cluttered, never one that
 * silently sends an unresolved placeholder.
 */
function tagCompletionSource(
  onTrigger: (type: BodyTagType, from: number, to: number) => void,
  /** Body-only, multipart-only — see RawBodyEditor's own `allowFileUpload` prop for why this isn't just always offered. */
  allowFileUpload: boolean
) {
  return (context: CompletionContext): CompletionResult | null => {
    const match = context.matchBefore(/\{\{\w*/);
    if (!match) return null;

    const node = syntaxTree(context.state).resolveInner(match.from, -1);
    if (node.name !== 'String') return null;

    return {
      from: match.from,
      to: match.to,
      // CodeMirror's default fuzzy-match filtering compares the option's
      // *label* against the literal typed text (here, "{{") and drops
      // anything that doesn't match — fine for normal word completion, but
      // "Response → Map from..." has nothing to do with the `{{` trigger
      // text, so the default filter would silently discard it and close
      // the popup before it's ever seen.
      filter: false,
      options: [
        {
          label: 'Response → Map from...',
          // No document edit here — accepting the option only opens the
          // config modal; the typed `{{` is left untouched until the
          // modal is confirmed, so canceling leaves the document exactly
          // as it was mid-edit rather than having already deleted
          // something.
          apply: (_view, _completion, from, to) => onTrigger('response_body', from, to),
        },
        ...(allowFileUpload
          ? ([{ label: 'Upload file', apply: (_view, _completion, from, to) => onTrigger('uploaded_file', from, to) }] satisfies Completion[])
          : []),
      ],
    };
  };
}

/**
 * Turns a method's `RANDOM_METHOD_ARG_HINTS` entry into a snippet template
 * — the hint text becomes a selected, editable placeholder (`${...}`) the
 * user tabs into and overwrites, rather than plain inserted text. Braces
 * in the hint itself (`{min: 0, max: 100}`) are escaped since `${`/`}`
 * are the snippet template's own placeholder delimiters (see
 * @codemirror/autocomplete's `snippet` doc). A method with no hint (or
 * none listed at all — anything outside the curated table) just gets
 * empty parens with no placeholder, same as if the user had typed the
 * call by hand and left the args empty.
 */
function randExpressionSnippet(method: string): string {
  const hint = RANDOM_METHOD_ARG_HINTS[method];
  if (!hint) return `$rand.${method}()`;
  const escaped = hint.replace(/[{}]/g, '\\$&');
  return `$rand.${method}(\${${escaped}})`;
}

/**
 * `$rand.`-triggered completion for the Chance-backed random generator
 * (@get-enlace/core's engine/randomExpr.ts) — deliberately *not* routed
 * through `onTrigger`/a config modal the way `{{`'s tag completion is:
 * the whole point of this syntax is that it needs no side-table entry
 * (see randomExpr.ts's own doc), so accepting an option just writes text
 * into the document like any ordinary word-completion, nothing opens.
 * `methodNames` is a live reflection of the bundled Chance instance (see
 * `listRandomMethodNames`), not hand-maintained here — this function just
 * turns that list into completions.
 */
function randCompletionSource(methodNames: string[]) {
  const options: Completion[] = methodNames.map((name) =>
    snippetCompletion(randExpressionSnippet(name), { label: `$rand.${name}()`, type: 'function', detail: 'random value' })
  );

  return (context: CompletionContext): CompletionResult | null => {
    const match = context.matchBefore(/\$rand\.\w*/);
    if (!match) return null;

    const node = syntaxTree(context.state).resolveInner(match.from, -1);
    if (node.name !== 'String') return null;

    return { from: match.from, to: match.to, options };
  };
}

/**
 * Marks every `$rand.<method>(<args>)` call with a distinct italic style
 * so it reads as "resolves to something different every run" instead of
 * blending into ordinary string text. Purely visual — a `Decoration.mark`
 * wraps the matched range without replacing it, unlike a tag chip's
 * placeholder (`TagChipWidget` above), which *is* replaced with a widget;
 * `$rand.` text stays live, selectable, editable document text throughout.
 * Only ever installed when `allowRandom` is set (see `buildJsonAutocompleteExtensions`) —
 * mirrors the completion source right above it, which is the same gate.
 */
function randExpressionHighlightPlugin() {
  function build(view: EditorView): DecorationSet {
    const text = view.state.doc.toString();
    const ranges = [...text.matchAll(randomExprPattern())].map((match) => {
      const from = match.index ?? 0;
      return Decoration.mark({ class: 'cm-rand-expr' }).range(from, from + match[0].length);
    });
    return Decoration.set(ranges);
  }

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view);
      }
      update(update: ViewUpdate) {
        if (update.docChanged) this.decorations = build(update.view);
      }
    },
    { decorations: (v) => v.decorations }
  );
}

/**
 * The doc-shape-independent half of the editor's extensions — split out
 * from the component so a test can build a real `EditorView` against them
 * directly (see RawBodyEditor.test.tsx's tooltip-clipping regression
 * test), without needing React or the chip-decoration plumbing that
 * depends on per-node config.
 */
export function buildJsonAutocompleteExtensions(
  onTriggerTag: (type: BodyTagType, from: number, to: number) => void,
  allowFileUpload = false,
  allowRandom = false,
  compact = false
): Extension[] {
  return [
    json(),
    syntaxHighlighting(jsonHighlightStyle),
    history(),
    // Line numbers + fold gutter (and the fold behavior/keymap they
    // trigger) are skipped in `compact` mode — see RawBodyEditorProps'
    // own `compact` doc for why path/query/header opt out of both.
    // codeFolding() supplies the fold behavior itself (json()'s language
    // data already knows how to find an object/array's foldable range);
    // foldGutter() is just the clickable arrow that triggers it in the
    // line-number gutter.
    ...(compact ? [] : [lineNumbers(), codeFolding(), foldGutter()]),
    linter(jsonParseLinter(), { delay: 300 }),
    keymap.of([...defaultKeymap, ...historyKeymap, ...(compact ? [] : foldKeymap)]),
    autocompletion({
      override: [
        tagCompletionSource(onTriggerTag, allowFileUpload),
        ...(allowRandom ? [randCompletionSource(listRandomMethodNames())] : []),
      ],
    }),
    ...(allowRandom ? [randExpressionHighlightPlugin()] : []),
    EditorView.lineWrapping,
    // CodeMirror defaults to its *light* base theme (caret-color: black)
    // unless told otherwise — our CSS paints this editor with a near-
    // black background to match the app's dark palette, so without this
    // the caret is black-on-black and never visible, even though it's
    // there and blinking. This flips the `dark` facet so the base
    // theme's `&dark` caret/selection/active-line defaults (white caret,
    // etc.) apply instead.
    EditorView.theme({}, { dark: true }),
    // Autocomplete's popup is (by default) appended as a plain child of
    // the editor's own root element and positioned `fixed` — but our
    // wrapper CSS sets `overflow: hidden` (for the rounded-corner look),
    // which clips any DOM descendant regardless of its `position`, so
    // the popup would render completely invisible instead of just
    // missing. Mounting tooltips on `document.body` instead is
    // CodeMirror's documented fix for an editor that lives inside a
    // clipping/scrolling container.
    tooltips({ parent: document.body }),
  ];
}

export function RawBodyEditor({
  rawBody,
  onChange,
  ancestorNodes,
  nodeLabels,
  operations,
  readOnly = false,
  showHint = true,
  allowFileUpload = false,
  allowRandom = false,
  compact = false,
  onUploadFile,
}: RawBodyEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const configRef = useRef<ChipConfig>(null as unknown as ChipConfig);
  const liveRef = useRef({ rawBody, onChange });
  liveRef.current = { rawBody, onChange };
  // A single Compartment slot, reconfigured (not rebuilt) whenever
  // `readOnly` changes — see the effect below. Stable for the component's
  // whole lifetime, same as viewRef; both are recreated together on
  // remount, which is fine since a Compartment has no state of its own
  // beyond being a handle into one EditorView's extension tree.
  const readOnlyCompartmentRef = useRef(new Compartment());

  const [pendingInsert, setPendingInsert] = useState<{ type: BodyTagType; from: number; to: number } | null>(null);
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [beautifyError, setBeautifyError] = useState<string | null>(null);

  const nodesById = new Map(ancestorNodes.map((n) => [n.id, n]));

  configRef.current = {
    tags: rawBody.tags,
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
      const mergedTags = { ...liveRef.current.rawBody.tags, ...clonedTags };
      const tags = Object.fromEntries(Object.entries(mergedTags).filter(([id]) => presentIds.has(id)));
      liveRef.current.onChange({ template, tags });
    });

    const chipPluginType = chipPlugin(configRef);

    const extensions: Extension[] = [
      ...buildJsonAutocompleteExtensions(
        (type, from, to) => setPendingInsert({ type, from, to }),
        allowFileUpload,
        allowRandom,
        compact
      ),
      buildTagAutoCloneExtension(() => liveRef.current.rawBody.tags),
      chipPluginType,
      EditorView.atomicRanges.of((view) => view.plugin(chipPluginType)?.decorations ?? Decoration.none),
      updateListener,
      // Both together, not just readOnly alone — readOnly blocks the
      // transactions a keystroke/paste would produce, but leaves the doc
      // itself contenteditable; editable(false) is what actually stops the
      // caret/focus/IME too. CodeMirror's own recommended combination for
      // "fully read-only", per its docs.
      readOnlyCompartmentRef.current.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
    ];

    const view = new EditorView({
      doc: liveRef.current.rawBody.template,
      extensions,
      parent: containerRef.current,
    });
    viewRef.current = view;

    return () => view.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reflect external template changes (e.g. Form -> Raw regeneration, or a
  // fresh node selection) into the editor. A no-op when the last change
  // originated from this editor itself, since the doc already matches.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (view.state.doc.toString() === rawBody.template) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: rawBody.template },
      annotations: scripted.of(true),
    });
  }, [rawBody.template]);

  // Toggling readOnly is a reconfigure, not a rebuild — the compartment
  // slot (registered once at mount, above) is the whole point of using one
  // instead of just conditionally including EditorState.readOnly.of(...)
  // in the initial extensions list, which would need the view torn down
  // and rebuilt (losing cursor position, undo history, scroll) every time
  // a run starts or ends.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readOnlyCompartmentRef.current.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ]),
    });
  }, [readOnly]);

  // Tag metadata (jsonPath/sourceNodeId/headerName) can change without the
  // placeholder text changing at all — force the chip widgets to re-render
  // with fresh labels in that case.
  useEffect(() => {
    viewRef.current?.dispatch({ effects: refreshChips.of() });
  }, [rawBody.tags]);

  /**
   * Returns keyboard focus to this field's own CodeMirror doc once its tag
   * popup closes — for any reason: confirm, delete, or cancel.
   *
   * Reproduces a reported bug otherwise: React Flow's built-in Delete/
   * Backspace handler (useGlobalKeyHandler) listens on the whole document
   * and only backs off when the *currently focused* element is an input/
   * textarea/contenteditable (see @reactflow/core's isInputDOMNode). A tag
   * chip's own mousedown handler calls preventDefault() specifically to
   * stop CodeMirror from placing the cursor inside it (see TagChipWidget
   * above) — which also means clicking a chip never gives the editor real
   * DOM focus in the first place. So once its popup closes, focus is
   * sitting nowhere in particular (document.body), which isn't an "input"
   * as far as that guard is concerned: the still-selected node it was
   * opened from stays fully delete-eligible, and any stray Delete/
   * Backspace keystroke — on a Mac, the key labeled "delete" *is*
   * Backspace — wipes the node the user only meant to stop editing.
   * CodeMirror's content is a real contenteditable element, which that
   * guard already recognizes and protects; this just makes sure focus
   * actually lands there again instead of nowhere.
   */
  function refocusEditor() {
    viewRef.current?.focus();
  }

  function handleInsertConfirm(tag: BodyTag, file?: File) {
    const view = viewRef.current;
    if (!view || !pendingInsert) return;
    const docLength = view.state.doc.length;
    // Clamp defensively — the modal is a blocking overlay so the doc
    // shouldn't change while it's open, but if it somehow did, replacing
    // a stale out-of-range span would throw rather than degrade.
    const from = Math.min(pendingInsert.from, docLength);
    const to = Math.min(Math.max(pendingInsert.to, from), docLength);
    view.dispatch({
      changes: { from, to, insert: makeTagPlaceholder(tag.id) },
      annotations: scripted.of(true),
    });
    onChange({ template: view.state.doc.toString(), tags: { ...rawBody.tags, [tag.id]: tag } });
    if (tag.type === 'uploaded_file' && file) onUploadFile?.(tag.id, file);
    setPendingInsert(null);
    refocusEditor();
  }

  function findTagSpan(text: string, tagId: string): { from: number; to: number } | null {
    const match = new RegExp(`\\{\\{enlace:${tagId}\\}\\}`).exec(text);
    if (!match) return null;
    return { from: match.index, to: match.index + match[0].length };
  }

  function handleEditConfirm(tag: BodyTag, file?: File) {
    onChange({ template: rawBody.template, tags: { ...rawBody.tags, [tag.id]: tag } });
    // `file` is only set when the user picked a *new* file while editing —
    // leaving it unset means "keep whatever's already stored" (see
    // TagConfigModal's own onConfirm doc), so there's nothing to write here.
    if (tag.type === 'uploaded_file' && file) onUploadFile?.(tag.id, file);
    setEditingTagId(null);
    refocusEditor();
  }

  function handleDelete() {
    const view = viewRef.current;
    if (!view || !editingTagId) return;
    const span = findTagSpan(view.state.doc.toString(), editingTagId);
    if (span) {
      view.dispatch({ changes: { from: span.from, to: span.to, insert: '' }, annotations: scripted.of(true) });
    }
    const deletedTag = rawBody.tags[editingTagId];
    const tags = { ...rawBody.tags };
    delete tags[editingTagId];
    onChange({ template: view.state.doc.toString(), tags });
    // Same tidy-up a removed Form-mode file field already gets — no reason
    // for its blob to keep sitting in `uploadedFiles` under a tag id
    // nothing references any more.
    if (deletedTag?.type === 'uploaded_file') onUploadFile?.(editingTagId, null);
    setEditingTagId(null);
    refocusEditor();
  }

  function handleCancelInsert() {
    setPendingInsert(null);
    refocusEditor();
  }

  function handleCancelEdit() {
    setEditingTagId(null);
    refocusEditor();
  }

  /**
   * Reformats the document to standard 2-space-indented JSON. A plain
   * dispatch, not the `scripted`-annotated kind `handleInsertConfirm`/
   * `handleDelete` use above — those need to hand the updateListener a
   * combined {template, tags} it couldn't derive on its own (a tag was
   * just inserted/removed); a reformat only ever rearranges whitespace
   * around content that's already there (tag placeholders and `$rand.`
   * calls are just string content to `JSON.parse`/`stringify`, unaffected
   * either way), so the normal doc-changed path already does the right
   * thing — recompute the template, keep every tag whose placeholder is
   * still present, report it through `onChange`.
   */
  function handleBeautify() {
    const view = viewRef.current;
    if (!view) return;
    const text = view.state.doc.toString();
    let formatted: string;
    try {
      formatted = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      setBeautifyError("Can't beautify — this isn't valid JSON right now.");
      return;
    }
    setBeautifyError(null);
    if (formatted === text) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: formatted } });
  }

  const editingTag = editingTagId ? rawBody.tags[editingTagId] : undefined;

  return (
    <div className="raw-body-editor">
      {showHint && (
        <div className="raw-body-editor__hint">
          Type <code>{'{{'}</code> inside a string to map a value from an upstream response.
        </div>
      )}
      {beautifyError && <div className="raw-body-editor__error">{beautifyError}</div>}
      {/* Beautify lives as a floating control docked to the editor's own
          top-right corner (not a separate toolbar row above it) — same
          "attached to the surface it acts on" treatment CodeMirror's own
          fold-gutter arrows get, rather than reading as a whole separate
          piece of chrome. */}
      <div className="raw-body-editor__surface">
        <button
          type="button"
          className="raw-body-editor__beautify"
          disabled={readOnly}
          onClick={handleBeautify}
          aria-label="Beautify JSON"
          title="Beautify — reformat this JSON with standard indentation"
        >
          <BeautifyIcon />
        </button>
        <div className={`raw-body-editor__codemirror${readOnly ? ' raw-body-editor__codemirror--readonly' : ''}`} ref={containerRef} />
      </div>

      {pendingInsert && (
        <TagConfigModal
          ancestorNodes={ancestorNodes}
          nodeLabels={nodeLabels}
          operations={operations}
          initialType={pendingInsert.type}
          allowFileUpload={allowFileUpload}
          onConfirm={handleInsertConfirm}
          onCancel={handleCancelInsert}
        />
      )}

      {editingTag && (
        <TagConfigModal
          ancestorNodes={ancestorNodes}
          nodeLabels={nodeLabels}
          operations={operations}
          initialType={editingTag.type}
          initialTag={editingTag}
          allowFileUpload={allowFileUpload}
          onConfirm={handleEditConfirm}
          onDelete={handleDelete}
          onCancel={handleCancelEdit}
        />
      )}
    </div>
  );
}
