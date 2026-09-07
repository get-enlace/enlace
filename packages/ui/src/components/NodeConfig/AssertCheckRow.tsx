import { flattenResponseFields } from '../../utils/flattenSchema.js';
import { operationIdOf } from '../../utils/workflowNode.js';
import type { AssertCheck, AssertOperator, BodyTagType, Operation, WorkflowNode } from '../../types.js';

// Excludes 'uploaded_file' deliberately — an assert check compares against
// a captured response (AssertCheck.source is ResponseBodyTagRef, not
// BodyTag; see types.ts), never a locally-attached file.
type AssertSourceType = Exclude<BodyTagType, 'uploaded_file'>;

const SOURCE_TYPE_LABELS: Record<AssertSourceType, string> = {
  response_status: 'Status',
  response_body: 'Body field',
  response_header: 'Header',
  response_raw: 'Raw body',
};

const OPERATOR_LABELS: Record<AssertOperator, string> = {
  equals: 'equals',
  notEquals: 'not equals',
  contains: 'contains',
  exists: 'exists',
  notExists: "doesn't exist",
  greaterThan: '>',
  lessThan: '<',
};

/**
 * One check row inside an assert preset's config — source node + what to
 * read from it (mirrors NodeConfig's own request-field "Map from..."
 * picker, minus its target-field type-compatibility filtering: a check
 * isn't matching against a typed request field, any response shape is
 * fair game) + the comparison itself. Lives here, not on the presets
 * canvas card — see PresetsConfig, the only caller, for why.
 */
export function AssertCheckRow({
  check,
  index,
  ancestorNodes,
  operations,
  nodeLabels,
  disabled,
  onUpdate,
  onRemove,
}: {
  check: AssertCheck;
  index: number;
  ancestorNodes: WorkflowNode[];
  operations: Operation[];
  nodeLabels: Map<string, string>;
  disabled: boolean;
  onUpdate: (patch: Partial<Omit<AssertCheck, 'id'>>) => void;
  onRemove: () => void;
}) {
  const sourceNode = ancestorNodes.find((n) => n.id === check.source.sourceNodeId);
  const sourceOperation = operations.find((o) => o.id === operationIdOf(sourceNode));
  const responseFields = sourceOperation ? flattenResponseFields(sourceOperation) : [];
  const needsExpected = check.operator !== 'exists' && check.operator !== 'notExists';

  return (
    <li className="node-config__check-row">
      <select
        disabled={disabled}
        aria-label={`Check ${index + 1} source node`}
        value={check.source.sourceNodeId}
        onChange={(e) => onUpdate({ source: { ...check.source, sourceNodeId: e.target.value } })}
      >
        <option value="">Select node...</option>
        {ancestorNodes.map((n) => (
          <option key={n.id} value={n.id}>
            {nodeLabels.get(n.id) ?? n.id}
          </option>
        ))}
      </select>
      <select
        disabled={disabled}
        aria-label={`Check ${index + 1} source type`}
        value={check.source.type}
        onChange={(e) => {
          // Rebuilt fresh per variant, not spread from check.source — a
          // discriminated union's other-variant-only fields (jsonPath,
          // headerName) shouldn't survive a type switch, and a spread
          // inside this closure can't be narrowed to "the variant matching
          // the dropdown's old value" anyway (TS can't carry a property's
          // narrowing across a closure boundary — see AssertCheck.source's
          // own comment in types.ts for why the type is what it is).
          // `sourceNodeId` alone is safe to read unnarrowed since every
          // variant here has it.
          const type = e.target.value as AssertSourceType;
          const sourceNodeId = check.source.sourceNodeId;
          const source: AssertCheck['source'] =
            type === 'response_body'
              ? { type, sourceNodeId, jsonPath: '' }
              : type === 'response_header'
                ? { type, sourceNodeId, headerName: '' }
                : { type, sourceNodeId };
          onUpdate({ source });
        }}
      >
        {(Object.keys(SOURCE_TYPE_LABELS) as AssertSourceType[]).map((type) => (
          <option key={type} value={type}>
            {SOURCE_TYPE_LABELS[type]}
          </option>
        ))}
      </select>
      {check.source.type === 'response_body' &&
        (responseFields.length > 0 ? (
          <select
            disabled={disabled}
            aria-label={`Check ${index + 1} response field`}
            value={check.source.jsonPath ?? ''}
            onChange={(e) =>
              onUpdate({ source: { type: 'response_body', sourceNodeId: check.source.sourceNodeId, jsonPath: e.target.value } })
            }
          >
            <option value="">Select field...</option>
            {responseFields.map((rf) => (
              <option key={rf.path} value={rf.path} disabled={!rf.supported} title={rf.reason}>
                {rf.path}
                {!rf.supported ? ' (unsupported)' : ''}
              </option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            disabled={disabled}
            placeholder="e.g. items[0].id"
            aria-label={`Check ${index + 1} response field path`}
            value={check.source.jsonPath ?? ''}
            onChange={(e) =>
              onUpdate({ source: { type: 'response_body', sourceNodeId: check.source.sourceNodeId, jsonPath: e.target.value } })
            }
          />
        ))}
      {check.source.type === 'response_header' && (
        <input
          type="text"
          disabled={disabled}
          placeholder="e.g. x-trace-id"
          aria-label={`Check ${index + 1} header name`}
          value={check.source.headerName ?? ''}
          onChange={(e) =>
            onUpdate({ source: { type: 'response_header', sourceNodeId: check.source.sourceNodeId, headerName: e.target.value } })
          }
        />
      )}
      <select
        disabled={disabled}
        aria-label={`Check ${index + 1} operator`}
        value={check.operator}
        onChange={(e) => onUpdate({ operator: e.target.value as AssertOperator })}
      >
        {(Object.keys(OPERATOR_LABELS) as AssertOperator[]).map((op) => (
          <option key={op} value={op}>
            {OPERATOR_LABELS[op]}
          </option>
        ))}
      </select>
      {needsExpected && (
        <input
          type="text"
          disabled={disabled}
          placeholder="expected value"
          aria-label={`Check ${index + 1} expected value`}
          value={check.expected ?? ''}
          onChange={(e) => onUpdate({ expected: e.target.value })}
        />
      )}
      <button
        type="button"
        className="node-config__check-remove"
        disabled={disabled}
        aria-label={`Remove check ${index + 1}`}
        title="Remove check"
        onClick={onRemove}
      >
        ×
      </button>
    </li>
  );
}
