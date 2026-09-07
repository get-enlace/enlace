import { useMemo, useState } from 'react';
import { useWorkflowStore } from '../../store/workflowStore.js';
import { flattenRequestFields } from '../../utils/flattenSchema.js';
import { buildNodeLabels, computeAncestors, listRandomMethodNames, rawFileTagFieldPath } from '@get-enlace/core';
import { hasUnrepresentableShape } from '../../utils/schemaExample.js';
import { fillBodyWithRandomData, fillRawBodyWithRandomData } from '../../utils/randomFill.js';
import { buildRawBodyFromForm, buildRawParamsFromForm, convertRawBodyToFieldValues, convertRawParamsToFieldValues } from '../../utils/bodyTemplate.js';
import { operationIdOf } from '../../utils/workflowNode.js';
import { RawBodyEditor } from './RawBodyEditor.js';
import { NodeConfigHeader } from './NodeConfigHeader.js';
import { CredentialParamOverrideRow } from './CredentialParamOverrideRow.js';
import { RequestField } from './RequestField.js';
import { PresetsConfig } from './PresetsConfig.js';
import { Modal } from '../Modal.js';
import { DiceIcon } from '../chromeIcons.js';
import type { FieldValue } from '../../types.js';

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
    setFieldValue,
    mergeFieldValues,
    setCredentialExtraParamOverride,
    setCredentialExtraParamOverridesEnabled,
    setUploadedFile,
    uploadedFiles,
    setRequestMode,
    setRawPath,
    setRawQuery,
    setRawBody,
    setPresetDurationMs,
    addAssertCheck,
    removeAssertCheck,
    updateAssertCheck,
  } = useWorkflowStore();

  const node = nodes.find((n) => n.id === selectedNodeId);
  const operation = operations.find((o) => o.id === operationIdOf(node));
  const operationsById = useMemo(() => new Map(operations.map((o) => [o.id, o])), [operations]);
  const fields = useMemo(() => (operation ? flattenRequestFields(operation) : []), [operation]);
  const pathFields = useMemo(() => fields.filter((f) => f.path.startsWith('path.')), [fields]);
  const queryFields = useMemo(() => fields.filter((f) => f.path.startsWith('query.')), [fields]);
  const headerFields = useMemo(() => fields.filter((f) => f.path.startsWith('header.')), [fields]);
  const bodyFields = useMemo(() => fields.filter((f) => f.path.startsWith('body.')), [fields]);
  // Reflects the live Chance prototype (see randomExpr.ts) rather than a
  // hand-maintained list — computed once, not per field/render.
  const randomMethodNames = useMemo(() => listRandomMethodNames(), []);

  const [switchError, setSwitchError] = useState<string | null>(null);
  const [pendingFormSwitch, setPendingFormSwitch] = useState<{
    fieldValues: Record<string, FieldValue>;
    fileFieldTagIds: Record<string, string>;
  } | null>(null);

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
  // A multipart body's Raw mode carries its file field(s) as `uploaded_file`
  // tag chips (see RawBodyEditor.tsx's `allowFileUpload` and
  // rawBodyResolver.ts) — no longer forced to Form-only.
  const bodyMode = node.requestMode ?? 'form';
  const hasRequestToggle = pathFields.length > 0 || queryFields.length > 0 || Boolean(operation.requestBodySchema);
  const selectedCredential = credentials.find((c) => c.id === node.credentialId) ?? null;
  // Only these two grant types have extraTokenParams at all — see
  // WorkflowNode.credentialExtraParamOverrides's own comment on why this
  // stays a per-node override rather than living on the shared Credential.
  const extraParamKeys =
    selectedCredential?.type === 'oauth2_clientCredentials' || selectedCredential?.type === 'oauth2_password'
      ? Object.keys(selectedCredential.extraTokenParams ?? {})
      : [];
  const overridesEnabled = node.credentialExtraParamOverridesEnabled ?? false;

  function switchToRaw() {
    if (!node || !operation) return;
    setSwitchError(null);
    // Always rebuild from the current form fields — Form is the mode being
    // left, so it's the authoritative source. Stale raw* left over from an
    // earlier raw-mode session must not win over field edits made since.
    if (pathFields.length > 0) {
      setRawPath(node.id, buildRawParamsFromForm('path', operation, node.fieldValues));
    }
    if (queryFields.length > 0) {
      setRawQuery(node.id, buildRawParamsFromForm('query', operation, node.fieldValues));
    }
    if (operation.requestBodySchema) {
      const { rawBody, fileFieldTagIds } = buildRawBodyFromForm(operation, node.fieldValues);
      setRawBody(node.id, rawBody);
      // The template/tag now references each file field by its new tag id
      // — the actual File blob has to follow it there, since
      // buildRawBodyFromForm only ever sees the `{ source: 'file',
      // fileName }` marker, never the blob itself (see its own doc).
      for (const [fieldPath, tagId] of Object.entries(fileFieldTagIds)) {
        const file = uploadedFiles[`${node.id}::body.${fieldPath}`];
        if (file) setUploadedFile(node.id, rawFileTagFieldPath(tagId), file);
      }
    }
    setRequestMode(node.id, 'raw');
  }

  function switchToForm() {
    if (!node || !operation) return;
    setSwitchError(null);

    const merged: Record<string, FieldValue> = {};
    const fileFieldTagIds: Record<string, string> = {};
    let lossy = false;

    if (opNode.rawPath && pathFields.length > 0) {
      const result = convertRawParamsToFieldValues('path', opNode.rawPath, operation);
      if (result.parseError) {
        setSwitchError(`Can't switch to Form view — path Raw JSON isn't valid: ${result.parseError}`);
        return;
      }
      Object.assign(merged, result.fieldValues);
      Object.assign(fileFieldTagIds, result.fileFieldTagIds);
      lossy = lossy || result.lossy;
    }
    if (opNode.rawQuery && queryFields.length > 0) {
      const result = convertRawParamsToFieldValues('query', opNode.rawQuery, operation);
      if (result.parseError) {
        setSwitchError(`Can't switch to Form view — query Raw JSON isn't valid: ${result.parseError}`);
        return;
      }
      Object.assign(merged, result.fieldValues);
      Object.assign(fileFieldTagIds, result.fileFieldTagIds);
      lossy = lossy || result.lossy;
    }
    if (opNode.rawBody && operation.requestBodySchema) {
      const result = convertRawBodyToFieldValues(opNode.rawBody, operation);
      if (result.parseError) {
        setSwitchError(`Can't switch to Form view — body Raw JSON isn't valid: ${result.parseError}`);
        return;
      }
      Object.assign(merged, result.fieldValues);
      Object.assign(fileFieldTagIds, result.fileFieldTagIds);
      lossy = lossy || result.lossy;
    }

    if (lossy) {
      setPendingFormSwitch({ fieldValues: merged, fileFieldTagIds });
      return;
    }
    mergeFieldValues(node.id, merged);
    applyFileFieldTagIds(node.id, fileFieldTagIds);
    setRequestMode(node.id, 'form');
  }

  // Copies each converted file field's actual File blob from its raw tag's
  // key back to the field's own key (see bodyTemplate.ts's
  // RawToFormResult.fileFieldTagIds) — deferred until the switch is
  // actually applied (here, or from confirmLossyFormSwitch below), not
  // done eagerly in switchToForm itself, so canceling a lossy-switch
  // confirmation doesn't leave a copy sitting under a field path that
  // never actually got its FieldValue set.
  function applyFileFieldTagIds(nodeId: string, fileFieldTagIds: Record<string, string>) {
    for (const [fieldPath, tagId] of Object.entries(fileFieldTagIds)) {
      const file = uploadedFiles[`${nodeId}::${rawFileTagFieldPath(tagId)}`];
      if (file) setUploadedFile(nodeId, fieldPath, file);
    }
  }

  function confirmLossyFormSwitch() {
    if (!node || !pendingFormSwitch) return;
    mergeFieldValues(node.id, pendingFormSwitch.fieldValues);
    applyFileFieldTagIds(node.id, pendingFormSwitch.fileFieldTagIds);
    setRequestMode(node.id, 'form');
    setPendingFormSwitch(null);
  }

  return (
    <aside className="node-config">
      {/* Shared by every "Random" field's expression input below (see
          RequestField) — one list for the whole pane, not one per field. */}
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
          bodyMode={bodyMode}
          hasBody={Boolean(operation.requestBodySchema)}
          showMapFromHint={ancestorNodes.length === 0 && fields.length > 0}
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

        <div className="node-config__request-header">
          <h3>Request</h3>
          {hasRequestToggle && (
            <label
              className="body-mode-switch"
              title="Switch to Raw to edit path, query, and body as JSON and map values with tag chips."
            >
              <span className="body-mode-switch__label">{bodyMode === 'raw' ? 'Raw' : 'Form'}</span>
              <input
                type="checkbox"
                checked={bodyMode === 'raw'}
                onChange={(e) => (e.target.checked ? switchToRaw() : switchToForm())}
                aria-label={bodyMode === 'raw' ? 'Switch to Form view' : 'Switch to Raw view'}
              />
              <span className="body-mode-switch__track">
                <span className="body-mode-switch__thumb" />
              </span>
            </label>
          )}
        </div>
        {switchError && <p className="node-config__error">{switchError}</p>}

        {pathFields.length > 0 && (
          <section className="node-config__section">
            <h4 className="node-config__section-title">Path variables</h4>
            {bodyMode === 'form' ? (
              pathFields.map((f) => (
                <RequestField
                  key={f.path}
                  field={f}
                  allowRandom={false}
                  fieldValue={node.fieldValues[f.path]}
                  ancestorNodes={ancestorNodes}
                  operations={operations}
                  nodeLabels={nodeLabels}
                  onChange={(value) => setFieldValue(node.id, f.path, value)}
                  onUploadFile={(file) => setUploadedFile(node.id, f.path, file)}
                />
              ))
            ) : node.rawPath ? (
              <RawBodyEditor
                key={node.id}
                rawBody={node.rawPath}
                onChange={(rawPath) => setRawPath(node.id, rawPath)}
                ancestorNodes={ancestorNodes}
                nodeLabels={nodeLabels}
                readOnly={isRunning}
                showHint={false}
              />
            ) : null}
          </section>
        )}

        {queryFields.length > 0 && (
          <section className="node-config__section">
            <h4 className="node-config__section-title">Query params</h4>
            {bodyMode === 'form' ? (
              queryFields.map((f) => (
                <RequestField
                  key={f.path}
                  field={f}
                  allowRandom={false}
                  fieldValue={node.fieldValues[f.path]}
                  ancestorNodes={ancestorNodes}
                  operations={operations}
                  nodeLabels={nodeLabels}
                  onChange={(value) => setFieldValue(node.id, f.path, value)}
                  onUploadFile={(file) => setUploadedFile(node.id, f.path, file)}
                />
              ))
            ) : node.rawQuery ? (
              <RawBodyEditor
                key={node.id}
                rawBody={node.rawQuery}
                onChange={(rawQuery) => setRawQuery(node.id, rawQuery)}
                ancestorNodes={ancestorNodes}
                nodeLabels={nodeLabels}
                readOnly={isRunning}
                showHint={false}
              />
            ) : null}
          </section>
        )}

        {headerFields.length > 0 && (
          <section className="node-config__section">
            <h4 className="node-config__section-title">Headers</h4>
            {headerFields.map((f) => (
              <RequestField
                key={f.path}
                field={f}
                allowRandom={false}
                fieldValue={node.fieldValues[f.path]}
                ancestorNodes={ancestorNodes}
                operations={operations}
                nodeLabels={nodeLabels}
                onChange={(value) => setFieldValue(node.id, f.path, value)}
                onUploadFile={(file) => setUploadedFile(node.id, f.path, file)}
              />
            ))}
          </section>
        )}

        {operation.requestBodySchema && (
          <section className="node-config__section node-config__body">
            <div className="node-config__section-title-row">
              <h4 className="node-config__section-title">Body</h4>
              {(bodyMode === 'form' ? bodyFields.length > 0 : Boolean(node.rawBody)) && (
                <button
                  type="button"
                  className="node-config__fill-random"
                  aria-label="Fill with random data"
                  title="Fill with random data — overwrites whatever's already there, editable afterward."
                  onClick={() =>
                    bodyMode === 'form'
                      ? mergeFieldValues(node!.id, fillBodyWithRandomData(operation, node!.fieldValues, false))
                      : setRawBody(node!.id, fillRawBodyWithRandomData(operation))
                  }
                >
                  <DiceIcon />
                </button>
              )}
            </div>

            {bodyMode === 'form' && hasUnrepresentableShape(operation.requestBodySchema) ? (
              <p className="node-config__banner">
                This body has a shape the form can't fully represent (arrays of objects or polymorphic fields).{' '}
                <button type="button" onClick={switchToRaw}>
                  Switch to Raw
                </button>
              </p>
            ) : null}

            {bodyMode === 'form' ? (
              bodyFields.map((f) => (
                <RequestField
                  key={f.path}
                  field={f}
                  allowRandom
                  fieldValue={node.fieldValues[f.path]}
                  ancestorNodes={ancestorNodes}
                  operations={operations}
                  nodeLabels={nodeLabels}
                  onChange={(value) => setFieldValue(node.id, f.path, value)}
                  onUploadFile={(file) => setUploadedFile(node.id, f.path, file)}
                />
              ))
            ) : node.rawBody ? (
              <RawBodyEditor
                key={node.id}
                rawBody={node.rawBody}
                onChange={(rawBody) => setRawBody(node.id, rawBody)}
                ancestorNodes={ancestorNodes}
                nodeLabels={nodeLabels}
                readOnly={isRunning}
                showHint={false}
                allowFileUpload={isMultipart}
                allowRandom
                onUploadFile={(tagId, file) => setUploadedFile(node!.id, rawFileTagFieldPath(tagId), file)}
              />
            ) : null}
          </section>
        )}
      </fieldset>

      {pendingFormSwitch && (
        <Modal title="Switch to Form view?" onClose={() => setPendingFormSwitch(null)}>
          <p>Switching to Form view may lose custom JSON structure — continue?</p>
          <div className="tag-config-modal__actions">
            <button type="button" onClick={() => setPendingFormSwitch(null)}>
              Cancel
            </button>
            <button type="button" onClick={confirmLossyFormSwitch}>
              Switch anyway
            </button>
          </div>
        </Modal>
      )}
    </aside>
  );
}
