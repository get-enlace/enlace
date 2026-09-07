import { flattenResponseFields } from '../../utils/flattenSchema.js';
import { operationIdOf } from '../../utils/workflowNode.js';
import type { FieldValue, Operation, WorkflowNode } from '../../types.js';

/**
 * One row per key the attached oauth2 credential declares in its
 * `extraTokenParams`, always visible while the section's own "Override
 * credential extra params?" toggle is on (see NodeConfig.tsx, the only
 * caller) — three states: "Default" (no entry in
 * `credentialExtraParamOverrides`, falls through to whatever the
 * credential itself has configured), "Mapped" (pulled from an ancestor
 * node's response), "Static" (a literal value typed here, scoped to this
 * node only — for when you want a different value per node without
 * editing the shared credential).
 */
export function CredentialParamOverrideRow({
  paramKey,
  override,
  ancestorNodes,
  operations,
  nodeLabels,
  onChange,
}: {
  paramKey: string;
  override: FieldValue | undefined;
  ancestorNodes: WorkflowNode[];
  operations: Operation[];
  nodeLabels: Map<string, string>;
  onChange: (override: FieldValue | null) => void;
}) {
  const mode = override?.source ?? 'default';
  const isMapped = override?.source === 'mapped';
  const sourceNode = isMapped ? ancestorNodes.find((n) => n.id === override.fromNodeId) : undefined;
  const sourceOperation = operations.find((o) => o.id === operationIdOf(sourceNode));
  const responseFields = sourceOperation ? flattenResponseFields(sourceOperation) : [];

  return (
    <div className="node-config__field">
      <label>{paramKey}</label>

      <div className={`node-config__field-row${isMapped ? ' node-config__field-row--mapped' : ''}`}>
        <select
          className="node-config__source-select"
          value={mode}
          aria-label={`Source for extra param ${paramKey}`}
          onChange={(e) => {
            const next = e.target.value;
            if (next === 'default') {
              onChange(null);
            } else if (next === 'static') {
              onChange({ source: 'static', value: '' });
            } else if (next === 'mapped' && ancestorNodes[0]) {
              onChange({ source: 'mapped', fromNodeId: ancestorNodes[0].id, fromResponseFieldPath: '' });
            }
          }}
        >
          <option value="default">Default</option>
          <option value="mapped" disabled={ancestorNodes.length === 0}>
            Mapped
          </option>
          <option value="static">Static</option>
        </select>

        {override?.source === 'static' && (
          <input
            type="text"
            aria-label={`Static value for extra param ${paramKey}`}
            value={String(override.value ?? '')}
            onChange={(e) => onChange({ source: 'static', value: e.target.value })}
          />
        )}

        {override?.source === 'mapped' && (
          <>
            <select
              aria-label={`Map extra param ${paramKey} from node`}
              value={override.fromNodeId}
              onChange={(e) => onChange({ ...override, fromNodeId: e.target.value })}
            >
              {ancestorNodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {nodeLabels.get(n.id)}
                </option>
              ))}
            </select>
            <select
              aria-label={`Map extra param ${paramKey} from response field`}
              value={override.fromResponseFieldPath}
              onChange={(e) => onChange({ ...override, fromResponseFieldPath: e.target.value })}
            >
              <option value="">Select field...</option>
              {responseFields.map((rf) => (
                <option key={rf.path} value={rf.path} disabled={!rf.supported} title={rf.reason}>
                  {rf.path}
                  {!rf.supported ? ' (unsupported)' : ''}
                </option>
              ))}
            </select>
          </>
        )}
      </div>
    </div>
  );
}
