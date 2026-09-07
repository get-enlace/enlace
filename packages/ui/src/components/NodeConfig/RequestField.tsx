import { coerceStaticValue } from '../../utils/coerceValue.js';
import { areFieldTypesCompatible, flattenResponseFields, type SchemaField } from '../../utils/flattenSchema.js';
import { guessRandomExpression } from '../../utils/randomFill.js';
import { operationIdOf } from '../../utils/workflowNode.js';
import { TrashIcon, UploadIcon } from '../chromeIcons.js';
import type { FieldValue, Operation, WorkflowNode } from '../../types.js';

/**
 * One request field row — path/query/header/body — in Form mode. Static,
 * Random, or Mapped source, plus a file-upload drop zone for a `binary`
 * field instead of any of those. Random only actually appears when
 * `allowRandom` is set — see NodeConfig.tsx's own callers: only body
 * fields pass `true`, since a path/query/header value is read off the URL
 * or an upstream response, never generated, so "Random" there would just
 * be dead weight (@get-enlace/core's Chance-backed generator only makes
 * sense for values you're actually sending as a payload).
 */
export function RequestField({
  field,
  allowRandom,
  fieldValue,
  ancestorNodes,
  operations,
  nodeLabels,
  onChange,
  onUploadFile,
}: {
  field: SchemaField;
  allowRandom: boolean;
  fieldValue: FieldValue | undefined;
  ancestorNodes: WorkflowNode[];
  operations: Operation[];
  nodeLabels: Map<string, string>;
  onChange: (value: FieldValue) => void;
  onUploadFile: (file: File | null) => void;
}) {
  const isFileField = field.format === 'binary';
  const isMapped = !isFileField && fieldValue?.source === 'mapped';
  const isRandom = !isFileField && allowRandom && fieldValue?.source === 'random';
  const disabled = !field.supported;

  // Nested/array fields are still shown, just disabled — a missing
  // field looks like a bug, a disabled one with a reason doesn't.
  const sourceNode = isMapped ? ancestorNodes.find((n) => n.id === fieldValue.fromNodeId) : undefined;
  const sourceOperation = operations.find((o) => o.id === operationIdOf(sourceNode));
  const responseFields = sourceOperation ? flattenResponseFields(sourceOperation) : [];

  if (isFileField) {
    const fileName = fieldValue?.source === 'file' ? fieldValue.fileName : '';
    return (
      <div className={`node-config__field${disabled ? ' node-config__field--disabled' : ''}`} title={field.reason}>
        <label>
          {field.path}
          {field.required ? ' *' : ''}
          {' (file)'}
          {disabled ? ' (unsupported)' : ''}
        </label>
        <div
          className={`node-config__file-drop${fileName ? ' node-config__file-drop--filled' : ''}${disabled ? ' node-config__file-drop--disabled' : ''}`}
        >
          {fileName ? (
            <>
              <span className="node-config__file-name" title={fileName}>
                {fileName}
              </span>
              <button
                type="button"
                className="node-config__file-clear"
                disabled={disabled}
                aria-label={`Clear ${field.path}`}
                onClick={() => onUploadFile(null)}
              >
                <TrashIcon />
              </button>
            </>
          ) : (
            <>
              {/* Remount on clear so the same file can be re-picked. */}
              <input
                key="empty"
                type="file"
                className="node-config__file-input"
                disabled={disabled}
                aria-label={field.path}
                onChange={(e) => onUploadFile(e.target.files?.[0] ?? null)}
              />
              <span className="node-config__file-prompt" aria-hidden="true">
                <UploadIcon />
              </span>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`node-config__field${disabled ? ' node-config__field--disabled' : ''}`} title={field.reason}>
      <label>
        {field.path}
        {field.required ? ' *' : ''}
        {field.type ? ` (${field.type})` : ''}
        {disabled ? ' (unsupported)' : ''}
      </label>

      <div className={`node-config__field-row${isMapped ? ' node-config__field-row--mapped' : ''}`}>
        <select
          className="node-config__source-select"
          disabled={disabled}
          value={isMapped ? 'mapped' : isRandom ? 'random' : 'static'}
          aria-label={`Source for ${field.path}`}
          onChange={(e) => {
            if (e.target.value === 'static') {
              onChange({ source: 'static', value: '' });
            } else if (e.target.value === 'random') {
              onChange({ source: 'random', expression: guessRandomExpression(field) });
            } else if (ancestorNodes[0]) {
              onChange({ source: 'mapped', fromNodeId: ancestorNodes[0].id, fromResponseFieldPath: '' });
            }
          }}
        >
          <option value="static">Static</option>
          {allowRandom && <option value="random">Random</option>}
          <option value="mapped" disabled={ancestorNodes.length === 0}>
            Mapped
          </option>
        </select>

        {isRandom && (
          <input
            type="text"
            className="node-config__random-expression"
            disabled={disabled}
            aria-label={`Random value for ${field.path}`}
            list="node-config__random-methods"
            placeholder="$rand.first()"
            value={fieldValue.expression}
            onChange={(e) => onChange({ source: 'random', expression: e.target.value })}
          />
        )}

        {!isMapped &&
          !isRandom &&
          (field.type === 'array' ? (
            <textarea
              rows={3}
              disabled={disabled}
              placeholder={field.reason}
              title={field.reason}
              aria-label={field.path}
              value={
                fieldValue?.source === 'static'
                  ? typeof fieldValue.value === 'string'
                    ? fieldValue.value
                    : JSON.stringify(fieldValue.value, null, 2)
                  : ''
              }
              onChange={(e) => onChange({ source: 'static', value: coerceStaticValue(e.target.value, field.type) })}
            />
          ) : field.enum ? (
            <select
              disabled={disabled}
              aria-label={field.path}
              value={fieldValue?.source === 'static' ? String(fieldValue.value ?? '') : ''}
              onChange={(e) => onChange({ source: 'static', value: coerceStaticValue(e.target.value, field.type) })}
            >
              <option value="">Select...</option>
              {field.enum.map((v) => (
                <option key={String(v)} value={String(v)}>
                  {String(v)}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              disabled={disabled}
              aria-label={field.path}
              value={fieldValue?.source === 'static' ? String(fieldValue.value ?? '') : ''}
              onChange={(e) => onChange({ source: 'static', value: coerceStaticValue(e.target.value, field.type) })}
            />
          ))}

        {isMapped && (
          <>
            <select
              disabled={disabled}
              aria-label={`Map ${field.path} from node`}
              value={fieldValue.fromNodeId}
              onChange={(e) => onChange({ ...fieldValue, fromNodeId: e.target.value })}
            >
              {ancestorNodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {nodeLabels.get(n.id)}
                </option>
              ))}
            </select>
            <select
              disabled={disabled}
              aria-label={`Map ${field.path} from response field`}
              value={fieldValue.fromResponseFieldPath}
              onChange={(e) => onChange({ ...fieldValue, fromResponseFieldPath: e.target.value })}
            >
              <option value="">Select field...</option>
              {responseFields.map((rf) => {
                const typeMismatch = rf.supported && !areFieldTypesCompatible(field.type, rf.type);
                const optionDisabled = !rf.supported || typeMismatch;
                // An array source is only ever safe to wire into an array-typed
                // target (a straight whole-array copy) — anything else needs
                // Raw mode, same reasoning as the bare-array-response case
                // below, so the message says so explicitly instead of just
                // "type mismatch".
                const reason = !rf.supported
                  ? rf.reason
                  : typeMismatch
                    ? rf.type === 'array'
                      ? `"${rf.path}" is an array — switch to Raw mode to map an item into "${field.path}" (${field.type}).`
                      : `Type mismatch: "${field.path}" expects ${field.type}, this field is ${rf.type}.`
                    : undefined;
                return (
                  <option key={rf.path} value={rf.path} disabled={optionDisabled} title={reason}>
                    {rf.path}
                    {!rf.supported ? ' (unsupported)' : typeMismatch ? (rf.type === 'array' ? ' (array — use Raw mode)' : ' (type mismatch)') : ''}
                  </option>
                );
              })}
            </select>
          </>
        )}
      </div>
    </div>
  );
}
