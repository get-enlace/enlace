import { useMemo } from 'react';
import { useWorkflowStore } from '../../store/workflowStore.js';
import { buildNodeLabels, computeAncestors, listRandomMethodNames, rawFileTagFieldPath } from '@get-enlace/core';
import { operationIdOf } from '../../utils/workflowNode.js';
import { RawBodyEditor } from './RawBodyEditor.js';
import { FieldValueEditor } from './FieldValueEditor.js';
import { NodeConfigHeader } from './NodeConfigHeader.js';
import { CredentialParamOverrideRow } from './CredentialParamOverrideRow.js';
import { PresetsConfig } from './PresetsConfig.js';

export function NodeConfig() {
  const {
    nodes,
    connections,
    operations,
    selectedNodeId,
    selectedPresetId,
    credentials,
    isRunning,
    setCredential,
    setCredentialExtraParamOverride,
    setCredentialExtraParamOverridesEnabled,
    setUploadedFile,
    setRawParamField,
    setRawHeaderField,
    setRawBody,
    setPresetDurationMs,
    addAssertCheck,
    removeAssertCheck,
    updateAssertCheck,
  } = useWorkflowStore();

  const node = nodes.find((n) => n.id === selectedNodeId);
  const operation = operations.find((o) => o.id === operationIdOf(node));
  const operationsById = useMemo(() => new Map(operations.map((o) => [o.id, o])), [operations]);
  // Reflects the live Chance prototype (see randomExpr.ts) rather than a
  // hand-maintained list — computed once, not per field/render.
  const randomMethodNames = useMemo(() => listRandomMethodNames(), []);

  // "map from" may reach any ancestor in the connection graph, not just the
  // node directly before it — e.g. A -> B -> C where B carries no data, C
  // can still map a field from A. See utils/graph.ts.
  const ancestorNodes = useMemo(() => {
    if (!node) return [];
    const ancestorIds = computeAncestors(nodes, connections, node.id);
    return nodes.filter((n) => ancestorIds.has(n.id));
  }, [nodes, connections, node]);
  // Global — every node in the workflow, not just this node's ancestors — so a node's label here
  // always matches its canvas card and every other picker, regardless of which node is selected
  // (see Canvas.tsx and utils/nodeLabel.ts's buildNodeLabels doc).
  const nodeLabels = useMemo(() => buildNodeLabels(nodes, operationsById), [nodes, operationsById]);

  // A preset's own config lives in PresetsConfig, not on the canvas card —
  // see that component's own doc for why. It handles its own "no preset
  // selected" empty state, so this is a single unconditional delegation.
  if (node && node.kind === 'presets') {
    return (
      <PresetsConfig
        node={node}
        selectedPresetId={selectedPresetId}
        ancestorNodes={ancestorNodes}
        operations={operations}
        nodeLabels={nodeLabels}
        isRunning={isRunning}
        setPresetDurationMs={setPresetDurationMs}
        addAssertCheck={addAssertCheck}
        removeAssertCheck={removeAssertCheck}
        updateAssertCheck={updateAssertCheck}
      />
    );
  }

  if (!node || !operation) {
    return (
      <aside className="node-config node-config--empty">
        <p className="node-config__empty-msg">Select a node to configure it.</p>
      </aside>
    );
  }
  // Narrowed to OperationNode by the presets-kind branch's own early return
  // above — captured in its own const (rather than relying on nested
  // closures below to keep re-deriving the narrowing from `node`, which TS
  // doesn't carry through a function declaration's body) so the rest of
  // this component can read operation-only fields directly.
  const opNode = node;

  const isMultipart = operation.requestBodyContentType === 'multipart/form-data';
  const selectedCredential = credentials.find((c) => c.id === node.credentialId) ?? null;
  // Only these two grant types have extraTokenParams at all — see
  // WorkflowNode.credentialExtraParamOverrides's own comment on why this
  // stays a per-node override rather than living on the shared Credential.
  const extraParamKeys =
    selectedCredential?.type === 'oauth2_clientCredentials' || selectedCredential?.type === 'oauth2_password'
      ? Object.keys(selectedCredential.extraTokenParams ?? {})
      : [];
  const overridesEnabled = node.credentialExtraParamOverridesEnabled ?? false;

  return (
    <aside className="node-config">
      {/* Shared by every Raw JSON body/query/header editor's `$rand.`
          autocomplete below (see RawBodyEditor) — one list for the whole
          pane, not one per editor. */}
      <datalist id="node-config__random-methods">
        {randomMethodNames.map((name) => (
          <option key={name} value={`$rand.${name}()`} />
        ))}
      </datalist>
      {isRunning && (
        <p className="node-config__banner">Workflow is running — editing is locked until it finishes.</p>
      )}
      <fieldset className="node-config__fieldset" disabled={isRunning}>
        <NodeConfigHeader
          operation={operation}
          selectedCredential={selectedCredential}
          credentials={credentials}
          onSelectCredential={(credentialId) => setCredential(node.id, credentialId)}
          hasBody={Boolean(operation.requestBodySchema)}
          selectedNodeId={selectedNodeId}
        />

        {extraParamKeys.length > 0 && (
          <section className="node-config__section">
            <div className="node-config__request-header">
              <h4 className="node-config__section-title">Override credential extra params?</h4>
              <label className="body-mode-switch" title="Override this node's oauth2 credential's extra token params.">
                <span className="body-mode-switch__label">{overridesEnabled ? 'On' : 'Off'}</span>
                <input
                  type="checkbox"
                  checked={overridesEnabled}
                  onChange={(e) => setCredentialExtraParamOverridesEnabled(node!.id, e.target.checked)}
                  aria-label="Override credential extra params"
                />
                <span className="body-mode-switch__track">
                  <span className="body-mode-switch__thumb" />
                </span>
              </label>
            </div>
            {overridesEnabled &&
              extraParamKeys.map((key) => (
                <CredentialParamOverrideRow
                  key={key}
                  paramKey={key}
                  override={opNode.credentialExtraParamOverrides?.[key]}
                  ancestorNodes={ancestorNodes}
                  operations={operations}
                  nodeLabels={nodeLabels}
                  onChange={(override) => setCredentialExtraParamOverride(node.id, key, override)}
                />
              ))}
          </section>
        )}

        <h3>Request</h3>

        {node.rawParams && Object.keys(node.rawParams.paths).length > 0 && (
          <section className="node-config__section">
            <h4 className="node-config__section-title">Path params</h4>
            {Object.entries(node.rawParams.paths).map(([key, field]) => (
              <FieldValueEditor
                key={`${node.id}:path:${key}`}
                label={key}
                value={field}
                onChange={(next) => setRawParamField(node.id, 'paths', key, next)}
                ancestorNodes={ancestorNodes}
                nodeLabels={nodeLabels}
                operations={operations}
                readOnly={isRunning}
              />
            ))}
          </section>
        )}

        {node.rawParams && Object.keys(node.rawParams.queries).length > 0 && (
          <section className="node-config__section">
            <h4 className="node-config__section-title">Query params</h4>
            {Object.entries(node.rawParams.queries).map(([key, field]) => (
              <FieldValueEditor
                key={`${node.id}:query:${key}`}
                label={key}
                value={field}
                onChange={(next) => setRawParamField(node.id, 'queries', key, next)}
                ancestorNodes={ancestorNodes}
                nodeLabels={nodeLabels}
                operations={operations}
                readOnly={isRunning}
              />
            ))}
          </section>
        )}

        {node.rawHeaders && (
          <section className="node-config__section">
            <h4 className="node-config__section-title">Headers</h4>
            {Object.entries(node.rawHeaders).map(([key, field]) => (
              <FieldValueEditor
                key={`${node.id}:header:${key}`}
                label={key}
                value={field}
                onChange={(next) => setRawHeaderField(node.id, key, next)}
                ancestorNodes={ancestorNodes}
                nodeLabels={nodeLabels}
                operations={operations}
                readOnly={isRunning}
              />
            ))}
          </section>
        )}

        {node.rawBody && (
          <section className="node-config__section node-config__body">
            <h4 className="node-config__section-title">Body</h4>

            <RawBodyEditor
              key={node.id}
              rawBody={node.rawBody}
              onChange={(rawBody) => setRawBody(node.id, rawBody)}
              ancestorNodes={ancestorNodes}
              nodeLabels={nodeLabels}
              operations={operations}
              readOnly={isRunning}
              showHint={false}
              allowFileUpload={isMultipart}
              allowRandom
              onUploadFile={(tagId, file) => setUploadedFile(node!.id, rawFileTagFieldPath(tagId), file)}
            />
          </section>
        )}
      </fieldset>
    </aside>
  );
}
