import { formatPresetLabel } from '@get-enlace/core';
import { AssertCheckRow } from './AssertCheckRow.js';
import type { AssertCheck, Operation, PresetsNode, WorkflowNode } from '../../types.js';

/**
 * A preset's own config — Wait's duration, or Assert's checks list. Lives
 * here, not on the presets canvas card (PresetsNodeCard.tsx), which only
 * ever shows a summary row (icon + formatPresetLabel) plus reorder/remove,
 * so every row stays the same compact width regardless of kind; clicking
 * one just calls `selectPreset`, which is what `selectedPresetId` (in
 * NodeConfig, the only caller) reflects. Reorder, add (drag from the
 * palette), and remove-the-whole-preset stay on the card itself — only
 * per-preset *configuration* moved here.
 */
export function PresetsConfig({
  node,
  selectedPresetId,
  ancestorNodes,
  operations,
  nodeLabels,
  isRunning,
  setPresetDurationMs,
  addAssertCheck,
  removeAssertCheck,
  updateAssertCheck,
}: {
  node: PresetsNode;
  selectedPresetId: string | null;
  ancestorNodes: WorkflowNode[];
  operations: Operation[];
  nodeLabels: Map<string, string>;
  isRunning: boolean;
  setPresetDurationMs: (nodeId: string, presetId: string, durationMs: number) => void;
  addAssertCheck: (nodeId: string, presetId: string) => void;
  removeAssertCheck: (nodeId: string, presetId: string, checkId: string) => void;
  updateAssertCheck: (nodeId: string, presetId: string, checkId: string, patch: Partial<Omit<AssertCheck, 'id'>>) => void;
}) {
  const preset = node.presets?.find((p) => p.id === selectedPresetId);
  if (!preset) {
    return (
      <aside className="node-config node-config--empty">
        <p className="node-config__empty-msg">Select a preset on the canvas to configure it.</p>
      </aside>
    );
  }

  return (
    <aside className="node-config">
      {isRunning && <p className="node-config__banner">Workflow is running — editing is locked until it finishes.</p>}
      <fieldset className="node-config__fieldset" disabled={isRunning}>
        <div className="node-config__header">
          <div className="node-config__op-title">
            <span
              className={`presets-node__step-icon${preset.kind === 'assert' ? ' presets-node__step-icon--assert' : ' presets-node__step-icon--wait'}`}
              aria-hidden="true"
            >
              {preset.kind === 'wait' ? '⏱' : '✓'}
            </span>
            <h2 className="node-config__path">{formatPresetLabel(preset)}</h2>
          </div>
        </div>

        {preset.kind === 'wait' ? (
          <div className="node-config__field">
            <label>Duration (seconds)</label>
            <div className="node-config__field-row">
              <input
                type="number"
                min={0}
                step={0.1}
                aria-label="Duration in seconds"
                value={(preset.durationMs ?? 0) / 1000}
                onChange={(e) => {
                  const seconds = Number(e.target.value);
                  const nextMs = Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : 0;
                  setPresetDurationMs(node.id, preset.id, nextMs);
                }}
              />
            </div>
          </div>
        ) : (
          <section className="node-config__section">
            <h4 className="node-config__section-title">Checks</h4>
            {(preset.checks ?? []).length === 0 && <p className="node-config__hint">No checks yet — add one below.</p>}
            <ul className="node-config__check-list">
              {(preset.checks ?? []).map((check, index) => (
                <AssertCheckRow
                  key={check.id}
                  check={check}
                  index={index}
                  ancestorNodes={ancestorNodes}
                  operations={operations}
                  nodeLabels={nodeLabels}
                  disabled={isRunning}
                  onUpdate={(patch) => updateAssertCheck(node.id, preset.id, check.id, patch)}
                  onRemove={() => removeAssertCheck(node.id, preset.id, check.id)}
                />
              ))}
            </ul>
            <button type="button" className="node-config__add-check" onClick={() => addAssertCheck(node.id, preset.id)}>
              + Add check
            </button>
          </section>
        )}
      </fieldset>
    </aside>
  );
}
