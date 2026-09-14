import { useCallback, useEffect, useRef, useState } from 'react';
import { useWorkflowStore } from './store/workflowStore.js';
import { hasResumableFailure } from './store/slices/runSlice.js';
import { restoreAutosave, startAutosave } from './persistence/autosaveSync.js';
import {
  Canvas,
  ChromeSettingsMenu,
  DebugPane,
  NodeConfig,
  NodeConfigShell,
  NODE_CONFIG_DEFAULT_WIDTH,
  OperationList,
  type OperationListHandle,
  RunControls,
  WorkflowSwitcher,
} from './components/index.js';

/**
 * True for an element a keystroke should be typed *into* rather than
 * treated as a shortcut — the same three DOM-level cases React Flow's own
 * "is this an input" guard checks (see RawBodyEditor.tsx's refocusEditor
 * doc): a native form control, or any contenteditable region, which is
 * how every CodeMirror editor in this app (RawBodyEditor/FieldValueEditor)
 * renders its document. Deliberately DOM-shape-based, not a hand-maintained
 * list of "editor" component names, so a new editor surface is covered
 * automatically as long as it's a real input or contenteditable node.
 */
function isEditableTarget(el: Element | null): boolean {
  if (!el) return false;
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  return (el as HTMLElement).isContentEditable;
}

export default function App() {
  const {
    operations,
    loadOperations,
    run,
    isRunning,
    nodes,
    stepStatusByNodeId,
    selectedNodeId,
    isDebugRun,
    continueExecution,
    stepNode,
    stopExecution,
    runResult,
  } = useWorkflowStore();
  // Pure view state (not workflow data) — collapsing a pane doesn't change
  // what gets run, just how much canvas room the user gets to work with.
  const [showNodeConfig, setShowNodeConfig] = useState(true);
  const [showDebugPane, setShowDebugPane] = useState(true);
  const [nodeConfigWidth, setNodeConfigWidth] = useState(NODE_CONFIG_DEFAULT_WIDTH);
  const onNodeConfigWidthChange = useCallback((width: number) => setNodeConfigWidth(width), []);
  const operationListRef = useRef<OperationListHandle>(null);

  useEffect(() => {
    let cancelled = false;
    // Wait for the spec before restoring — restoreAutosave's own
    // unknown-operation-id check needs `operations` populated to be
    // meaningful (see its own comment). startAutosave is independent of
    // that and subscribes right away, so nothing typed during the brief
    // load window goes unsaved.
    void loadOperations().then(() => {
      if (!cancelled) void restoreAutosave();
    });
    const stopAutosave = startAutosave();
    return () => {
      cancelled = true;
      stopAutosave();
    };
  }, [loadOperations]);

  // Press space anywhere that isn't itself asking for text (a field, a
  // credential form, ...) to jump straight into the operation/preset
  // search — "hit space, start typing" instead of a mouse trip to the
  // sidebar first. Checked against `document.activeElement`, not the
  // event's own target, so this stays correct even for a key bubbled up
  // from deep inside the canvas or a modal. `preventDefault` matters here:
  // an unhandled space on a plain, non-editable focus target (a button,
  // or nothing at all) otherwise still scrolls the page/canvas.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== ' ' || isEditableTarget(document.activeElement)) return;
      e.preventDefault();
      operationListRef.current?.focusSearch();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // One global set of controls for the whole run, not one per paused node
  // (Results pane pause bar also offers Continue/Step for the focused node).
  const pausedNodeIds = nodes.filter((n) => stepStatusByNodeId[n.id] === 'paused').map((n) => n.id);
  // Step needs one specific target: the selected node if it's actually
  // paused right now, otherwise whichever paused node comes first — so the
  // button always has a sensible default even before you've clicked
  // anything on canvas, but respects your selection once you have.
  const stepTarget = pausedNodeIds.includes(selectedNodeId ?? '') ? selectedNodeId! : pausedNodeIds[0];
  // Hidden, not disabled, when there's nothing to rerun — no button to
  // explain before anyone's run anything yet. The `!isRunning` half is
  // belt-and-suspenders: RunControls' idle branch (the only one that ever
  // renders this button) is itself unreachable while running, since it
  // swaps to the spinner/Continue-Step-Stop chrome first.
  const canRerunFailed = !isRunning && hasResumableFailure(runResult, nodes);

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="app__logo" />
          Enlace
        </h1>
        <WorkflowSwitcher />
        <div className="app__chrome-actions">
          <RunControls
            isRunning={isRunning}
            isDebugRun={isDebugRun}
            pausedCount={pausedNodeIds.length}
            canStep={!!stepTarget}
            canRerunFailed={canRerunFailed}
            onRun={() => run()}
            onDebug={() => run({ useBreakpoints: true })}
            onRerunFailed={() => run({ fromLastRun: true })}
            onContinue={continueExecution}
            onStep={() => stepTarget && stepNode(stepTarget)}
            onStop={stopExecution}
            stepTitle={
              pausedNodeIds.length > 1
                ? 'Step — release just the selected paused node (or the first paused node, if none is selected)'
                : 'Step — release the paused node'
            }
          />
          <ChromeSettingsMenu />
        </div>
      </header>
      <div
        className={`app__body${showNodeConfig ? '' : ' app__body--node-config-collapsed'}`}
        style={
          showNodeConfig
            ? { gridTemplateColumns: `240px minmax(240px, 1fr) ${nodeConfigWidth}px` }
            : undefined
        }
      >
        <OperationList ref={operationListRef} operations={operations} />
        <Canvas />
        {showNodeConfig ? (
          <NodeConfigShell onCollapse={() => setShowNodeConfig(false)} onWidthChange={onNodeConfigWidthChange}>
            <NodeConfig />
          </NodeConfigShell>
        ) : (
          <button
            type="button"
            className="pane-strip pane-strip--right"
            onClick={() => setShowNodeConfig(true)}
            title="Show node config"
            aria-label="Show node config"
          >
            ‹
          </button>
        )}
      </div>
      <DebugPane collapsed={!showDebugPane} onToggleCollapsed={() => setShowDebugPane((v) => !v)} />
    </div>
  );
}
