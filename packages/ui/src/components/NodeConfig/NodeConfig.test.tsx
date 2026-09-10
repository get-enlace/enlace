import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NodeConfig } from './NodeConfig.js';
import { useWorkflowStore } from '../../store/workflowStore.js';
import type { AssertPreset, Operation, OperationNode, Preset, PresetsNode, WaitPreset, WorkflowNode } from '../../types.js';

// Preset is a real discriminated union (WaitPreset | AssertPreset) — these
// narrow-or-throw so a test can read a kind-specific field directly instead
// of every call site repeating an `as`/`!` that would silently hide a
// wrong-kind preset instead of failing the test on it.
function asWaitPreset(preset: Preset): WaitPreset {
  if (preset.kind !== 'wait') throw new Error(`expected a wait preset, got "${preset.kind}"`);
  return preset;
}
function asAssertPreset(preset: Preset): AssertPreset {
  if (preset.kind !== 'assert') throw new Error(`expected an assert preset, got "${preset.kind}"`);
  return preset;
}

// Same "narrow-or-throw" idiom, one level up — WorkflowNode is itself now a
// discriminated union (OperationNode | PresetsNode).
function asOperationNode(node: WorkflowNode): OperationNode {
  if (node.kind === 'presets') throw new Error('expected an operation node, got a presets collection');
  return node;
}
function asPresetsNode(node: WorkflowNode): PresetsNode {
  if (node.kind !== 'presets') throw new Error('expected a presets collection, got an operation node');
  return node;
}

const petOperation: Operation = {
  id: 'POST /pet',
  method: 'post',
  path: '/pet',
  parameters: [],
  requestBodySchema: {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string' },
      qty: { type: 'integer' },
      status: { type: 'string', enum: ['available', 'pending', 'sold'] },
    },
  },
  requestBodyContentType: 'application/json',
  responseSchema: {
    type: 'object',
    properties: { id: { type: 'integer' }, name: { type: 'string' } },
  },
};

const getPetOperation: Operation = {
  id: 'GET /pet/{petId}',
  method: 'get',
  path: '/pet/{petId}',
  parameters: [],
  requestBodySchema: null,
  requestBodyContentType: null,
  responseSchema: petOperation.responseSchema,
};

// Every section is Raw JSON only now — a node's own rawParams/
// rawHeaders/rawBody being non-null (not the operation's schema) is what
// decides whether NodeConfig.tsx renders that section at all, so tests that
// care about a specific section pass it in directly rather than relying on
// the store's own addNode auto-seeding (see graphSlice.ts's addNode).
function makeNode(overrides: Partial<OperationNode> = {}): OperationNode {
  return {
    id: 'node-1',
    kind: 'operation',
    operationId: 'POST /pet',
    credentialId: null,
    ...overrides,
  };
}

// CredentialParamOverrideRow's field label ("audience", etc.) renders as a
// plain <label>{paramKey}</label> — find its row by that text, then scope
// queries to it with `within`.
function fieldRow(label: string) {
  const el = screen.getByText((_, node) => node?.tagName === 'LABEL' && node.textContent === label);
  return within(el.parentElement!);
}

describe('NodeConfig', () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      nodes: [],
      connections: [],
      operations: [petOperation, getPetOperation],
      selectedNodeId: null,
      selectedPresetId: null,
      credentials: [],
      isRunning: false,
    });
  });

  it('shows a placeholder when no node is selected', () => {
    render(<NodeConfig />);
    expect(screen.getByText('Select a node to configure it.')).toBeInTheDocument();
  });

  it('switching selection between a presets node and an operation node does not throw (stable hook order)', () => {
    useWorkflowStore.setState({
      nodes: [
        { id: 'g1', kind: 'presets', credentialId: null, presets: [{ id: 'p1', kind: 'wait', durationMs: 1000 }] },
        makeNode({ id: 'node-1' }),
      ],
      selectedNodeId: 'g1',
      selectedPresetId: 'p1',
    });
    const { rerender } = render(<NodeConfig />);
    expect(screen.getByText('Wait 1s')).toBeInTheDocument();

    useWorkflowStore.setState({ selectedNodeId: 'node-1', selectedPresetId: null });
    rerender(<NodeConfig />);
    expect(screen.getByRole('heading', { name: 'Request' })).toBeInTheDocument();

    useWorkflowStore.setState({ selectedNodeId: 'g1', selectedPresetId: 'p1' });
    rerender(<NodeConfig />);
    expect(screen.getByText('Wait 1s')).toBeInTheDocument();
  });

  it('shows a placeholder for a presets node until a preset is selected', () => {
    useWorkflowStore.setState({
      nodes: [{ id: 'g1', kind: 'presets', credentialId: null, presets: [] }],
      selectedNodeId: 'g1',
      selectedPresetId: null,
    });
    render(<NodeConfig />);

    expect(screen.getByText('Select a preset on the canvas to configure it.')).toBeInTheDocument();
    expect(screen.queryByText('Select a node to configure it.')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Request' })).not.toBeInTheDocument();
  });

  describe('preset config', () => {
    function makePresetsNode(overrides: Partial<PresetsNode> = {}): PresetsNode {
      return { id: 'g1', kind: 'presets', credentialId: null, presets: [], ...overrides };
    }

    it("renders a Wait preset's duration in seconds, and editing it updates the store", () => {
      const presetsNode = makePresetsNode({ presets: [{ id: 'p1', kind: 'wait', durationMs: 1000 }] });
      useWorkflowStore.setState({ nodes: [presetsNode], selectedNodeId: 'g1', selectedPresetId: 'p1' });
      render(<NodeConfig />);

      expect(screen.getByText('Wait 1s')).toBeInTheDocument(); // panel header
      const input = screen.getByLabelText('Duration in seconds');
      expect(input).toHaveValue(1);

      fireEvent.change(input, { target: { value: '3' } });
      expect(asWaitPreset(asPresetsNode(useWorkflowStore.getState().nodes[0]).presets![0]).durationMs).toBe(3000);
    });

    it('dropping an Assert preset from the palette appends it with no checks', () => {
      // Regression coverage for addPreset's own selection behavior — kept
      // here (not just in the store test) since it's what makes an assert
      // preset's config show up immediately after a palette drop.
      const { addPresetsNode, addPreset } = useWorkflowStore.getState();
      const id = addPresetsNode({ x: 0, y: 0 });
      addPreset(id, { kind: 'assert', checks: [] });
      render(<NodeConfig />);

      expect(screen.getByText('Assert (0 checks)')).toBeInTheDocument();
    });

    it('+ Add check appends a blank check to the store', async () => {
      const user = userEvent.setup();
      const presetsNode = makePresetsNode({ presets: [{ id: 'p1', kind: 'assert', checks: [] }] });
      useWorkflowStore.setState({ nodes: [presetsNode], selectedNodeId: 'g1', selectedPresetId: 'p1' });
      render(<NodeConfig />);

      await user.click(screen.getByRole('button', { name: '+ Add check' }));
      const checks = asAssertPreset(asPresetsNode(useWorkflowStore.getState().nodes[0]).presets![0]).checks;
      expect(checks).toHaveLength(1);
      expect(checks[0]).toMatchObject({ operator: 'equals', source: { type: 'response_body' } });
    });

    // Each field's own onChange handler is exercised against a fixture that
    // already has the check in place, rather than chaining off a prior "+
    // Add check" click within the same render — like every other test in
    // this file, `useWorkflowStore.setState` is a snapshot taken before
    // render(), so a store update from an earlier interaction never
    // re-renders this component; only the store's own resulting state is
    // observable afterward.
    it('editing a check row updates the store', async () => {
      const user = userEvent.setup();
      const opNode: WorkflowNode = { id: 'op1', kind: 'operation', operationId: 'POST /orders', credentialId: null };
      const presetsNode = makePresetsNode({
        presets: [
          { id: 'p1', kind: 'assert', checks: [{ id: 'c1', source: { type: 'response_body', sourceNodeId: '' }, operator: 'equals' }] },
        ],
      });
      useWorkflowStore.setState({
        nodes: [opNode, presetsNode],
        connections: [{ fromNodeId: 'op1', toNodeId: 'g1' }],
        selectedNodeId: 'g1',
        selectedPresetId: 'p1',
        operations: [
          {
            id: 'POST /orders',
            method: 'post',
            path: '/orders',
            parameters: [],
            requestBodySchema: null,
            requestBodyContentType: null,
            responseSchema: null,
          },
        ],
      });
      render(<NodeConfig />);

      const checksOf1 = () => asAssertPreset(asPresetsNode(useWorkflowStore.getState().nodes[1]).presets![0]).checks;

      await user.selectOptions(screen.getByLabelText('Check 1 source node'), 'op1');
      expect(checksOf1()[0].source.sourceNodeId).toBe('op1');

      await user.selectOptions(screen.getByLabelText('Check 1 source type'), 'response_status');
      expect(checksOf1()[0].source.type).toBe('response_status');

      await user.selectOptions(screen.getByLabelText('Check 1 operator'), 'greaterThan');
      expect(checksOf1()[0].operator).toBe('greaterThan');

      fireEvent.change(screen.getByLabelText('Check 1 expected value'), { target: { value: '199' } });
      expect(checksOf1()[0].expected).toBe('199');
    });

    it('shows the expected-value input for equals but hides it for exists', () => {
      const equalsPreset = makePresetsNode({
        presets: [
          { id: 'p1', kind: 'assert', checks: [{ id: 'c1', source: { type: 'response_body', sourceNodeId: '' }, operator: 'equals' }] },
        ],
      });
      useWorkflowStore.setState({ nodes: [equalsPreset], selectedNodeId: 'g1', selectedPresetId: 'p1' });
      const { unmount } = render(<NodeConfig />);
      expect(screen.getByLabelText('Check 1 expected value')).toBeInTheDocument();
      unmount();

      const existsPreset = makePresetsNode({
        presets: [
          { id: 'p1', kind: 'assert', checks: [{ id: 'c1', source: { type: 'response_body', sourceNodeId: '' }, operator: 'exists' }] },
        ],
      });
      useWorkflowStore.setState({ nodes: [existsPreset], selectedNodeId: 'g1', selectedPresetId: 'p1' });
      render(<NodeConfig />);
      expect(screen.queryByLabelText('Check 1 expected value')).not.toBeInTheDocument();
    });

    it('removes a check via its × button', async () => {
      const user = userEvent.setup();
      const presetsNode = makePresetsNode({
        presets: [
          {
            id: 'p1',
            kind: 'assert',
            checks: [{ id: 'c1', source: { type: 'response_body', sourceNodeId: '' }, operator: 'equals' }],
          },
        ],
      });
      useWorkflowStore.setState({ nodes: [presetsNode], selectedNodeId: 'g1', selectedPresetId: 'p1' });
      render(<NodeConfig />);

      await user.click(screen.getByRole('button', { name: 'Remove check 1' }));
      expect(asAssertPreset(asPresetsNode(useWorkflowStore.getState().nodes[0]).presets![0]).checks).toEqual([]);
    });
  });

  describe('Request sections', () => {
    it('renders a heading + one field editor per declared path/query/header param, plus one Raw JSON editor for the body', () => {
      useWorkflowStore.setState({
        nodes: [
          makeNode({
            rawParams: { paths: { id: { template: '', tags: {} } }, queries: { limit: { template: '', tags: {} } } },
            rawHeaders: { 'x-trace-id': { template: '', tags: {} } },
            rawBody: { template: '{"name":""}', tags: {} },
          }),
        ],
        selectedNodeId: 'node-1',
      });
      render(<NodeConfig />);

      expect(screen.getByRole('heading', { name: 'Request' })).toBeInTheDocument();
      // Path and query params are their own sections again now that each
      // param is a single inline row (label + input) rather than a shared
      // JSON blob — the visual-bulk problem that motivated merging them
      // doesn't apply once there's nothing to merge.
      expect(screen.getByRole('heading', { name: 'Path params' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Query params' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Headers' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Body' })).toBeInTheDocument();
      // One single-line field editor per declared path/query/header param (id, limit, x-trace-id).
      expect(document.querySelectorAll('.field-value-editor')).toHaveLength(3);
      // Body alone still gets the full multi-line Raw JSON editor.
      expect(document.querySelectorAll('.raw-body-editor')).toHaveLength(1);
    });

    it('omits a section entirely when the node has none of it (e.g. no path/query/header params declared)', () => {
      useWorkflowStore.setState({
        nodes: [makeNode({ rawBody: { template: '{"name":""}', tags: {} } })], // body only
        selectedNodeId: 'node-1',
      });
      render(<NodeConfig />);

      expect(screen.getByRole('heading', { name: 'Body' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Path params' })).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Query params' })).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Headers' })).not.toBeInTheDocument();
      expect(document.querySelectorAll('.raw-body-editor')).toHaveLength(1);
    });

    it('renders nothing under Request for an operation with no path/query/header/body at all', () => {
      useWorkflowStore.setState({
        nodes: [makeNode({ operationId: 'GET /pet/{petId}' })],
        selectedNodeId: 'node-1',
      });
      render(<NodeConfig />);

      expect(screen.getByRole('heading', { name: 'Request' })).toBeInTheDocument();
      expect(document.querySelectorAll('.raw-body-editor')).toHaveLength(0);
    });

    it('renders only the "Path params" section for a node with a path param and no query params, not an empty "Query params" section', () => {
      useWorkflowStore.setState({
        nodes: [makeNode({ rawParams: { paths: { id: { template: '', tags: {} } }, queries: {} } })], // path only, no query
        selectedNodeId: 'node-1',
      });
      render(<NodeConfig />);

      expect(screen.getByRole('heading', { name: 'Path params' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Query params' })).not.toBeInTheDocument();
      expect(document.querySelectorAll('.field-value-editor')).toHaveLength(1);
    });
  });

  it('lists credentials on the lock picker and sets the selected one on the node', async () => {
    const user = userEvent.setup();
    useWorkflowStore.setState({
      nodes: [makeNode()],
      selectedNodeId: 'node-1',
      credentials: [{ id: 'cred-1', name: 'staging', type: 'bearer', token: 'x' }],
    });
    render(<NodeConfig />);

    const lock = screen.getByRole('button', { name: 'Credential' });
    expect(lock).not.toHaveClass('node-config__cred-lock--set');
    await user.click(lock);
    await user.click(screen.getByRole('option', { name: 'staging' }));

    expect(useWorkflowStore.getState().nodes[0].credentialId).toBe('cred-1');
    expect(screen.getByRole('button', { name: 'Credential' })).toHaveClass('node-config__cred-lock--set');
  });

  describe('credential extra params', () => {
    const oauth2Credential = {
      id: 'cred-oauth2',
      name: 'staging-oauth2',
      type: 'oauth2_clientCredentials' as const,
      tokenUrl: 'http://auth.test/token',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      clientAuthMethod: 'body' as const,
      extraTokenParams: { audience: 'api://default' },
    };

    it("doesn't render the section when no credential, or a non-oauth2 credential, is attached", () => {
      useWorkflowStore.setState({
        nodes: [makeNode({ credentialId: 'cred-bearer' })],
        selectedNodeId: 'node-1',
        credentials: [{ id: 'cred-bearer', name: 'bearer', type: 'bearer', token: 'x' }],
      });
      const { rerender } = render(<NodeConfig />);
      expect(screen.queryByRole('heading', { name: 'Credential extra params' })).not.toBeInTheDocument();

      useWorkflowStore.setState({ nodes: [makeNode({ credentialId: null })] });
      rerender(<NodeConfig />);
      expect(screen.queryByRole('heading', { name: 'Credential extra params' })).not.toBeInTheDocument();
    });

    it("doesn't render the section for an oauth2 credential with no extraTokenParams configured", () => {
      useWorkflowStore.setState({
        nodes: [makeNode({ credentialId: 'cred-oauth2' })],
        selectedNodeId: 'node-1',
        credentials: [{ ...oauth2Credential, extraTokenParams: undefined }],
      });
      render(<NodeConfig />);
      expect(screen.queryByRole('heading', { name: 'Credential extra params' })).not.toBeInTheDocument();
    });

    it('shows the toggle off by default, with no field rows', () => {
      useWorkflowStore.setState({
        nodes: [makeNode({ credentialId: 'cred-oauth2' })],
        selectedNodeId: 'node-1',
        credentials: [oauth2Credential],
      });
      render(<NodeConfig />);

      expect(screen.getByRole('heading', { name: 'Override credential extra params?' })).toBeInTheDocument();
      const toggle = screen.getByRole('checkbox', { name: 'Override credential extra params' });
      expect(toggle).not.toBeChecked();
      expect(screen.queryByText((_, el) => el?.tagName === 'LABEL' && el.textContent === 'audience')).not.toBeInTheDocument();
    });

    it("stays off, with no rows, even when the node's overrideMap already has data — a leftover override is inert until toggled on", () => {
      useWorkflowStore.setState({
        nodes: [
          makeNode({
            credentialId: 'cred-oauth2',
            credentialExtraParamOverrides: { audience: { source: 'static', value: 'api://leftover' } },
          }),
        ],
        selectedNodeId: 'node-1',
        credentials: [oauth2Credential],
      });
      render(<NodeConfig />);

      expect(screen.getByRole('checkbox', { name: 'Override credential extra params' })).not.toBeChecked();
      expect(screen.queryByText((_, el) => el?.tagName === 'LABEL' && el.textContent === 'audience')).not.toBeInTheDocument();
    });

    it('turning the toggle on reveals one row per extraTokenParams key, defaulting to "Default"', async () => {
      const user = userEvent.setup();
      useWorkflowStore.setState({
        nodes: [makeNode({ credentialId: 'cred-oauth2' })],
        selectedNodeId: 'node-1',
        credentials: [oauth2Credential],
      });
      render(<NodeConfig />);

      await user.click(screen.getByRole('checkbox', { name: 'Override credential extra params' }));

      expect(asOperationNode(useWorkflowStore.getState().nodes[0]).credentialExtraParamOverridesEnabled).toBe(true);
      const row = fieldRow('audience');
      expect(row.getByRole('combobox', { name: 'Source for extra param audience' })).toHaveValue('default');
    });

    it('switching a row to Mapped defaults to the first ancestor with no response field selected, and stores it', async () => {
      const user = userEvent.setup();
      useWorkflowStore.setState({
        nodes: [
          makeNode({ id: 'a', operationId: 'GET /pet/{petId}', credentialId: null }),
          makeNode({ id: 'node-1', credentialId: 'cred-oauth2', credentialExtraParamOverridesEnabled: true }),
        ],
        connections: [{ fromNodeId: 'a', toNodeId: 'node-1' }],
        selectedNodeId: 'node-1',
        credentials: [oauth2Credential],
      });
      render(<NodeConfig />);

      const row = fieldRow('audience');
      await user.selectOptions(row.getByRole('combobox', { name: 'Source for extra param audience' }), 'mapped');

      expect(asOperationNode(useWorkflowStore.getState().nodes[1]).credentialExtraParamOverrides).toEqual({
        audience: { source: 'mapped', fromNodeId: 'a', fromResponseFieldPath: '' },
      });

      await user.selectOptions(screen.getByRole('combobox', { name: 'Map extra param audience from response field' }), 'name');
      expect(asOperationNode(useWorkflowStore.getState().nodes[1]).credentialExtraParamOverrides).toEqual({
        audience: { source: 'mapped', fromNodeId: 'a', fromResponseFieldPath: 'name' },
      });
    });

    it('disables the Mapped option with no ancestor node to map from', () => {
      useWorkflowStore.setState({
        nodes: [makeNode({ credentialId: 'cred-oauth2', credentialExtraParamOverridesEnabled: true })],
        selectedNodeId: 'node-1',
        credentials: [oauth2Credential],
      });
      render(<NodeConfig />);

      const row = fieldRow('audience');
      expect(row.getByRole('option', { name: 'Mapped' })).toBeDisabled();
    });

    it('switching a row to Static shows a text input and stores what is typed', async () => {
      const user = userEvent.setup();
      useWorkflowStore.setState({
        nodes: [makeNode({ credentialId: 'cred-oauth2', credentialExtraParamOverridesEnabled: true })],
        selectedNodeId: 'node-1',
        credentials: [oauth2Credential],
      });
      render(<NodeConfig />);

      const row = fieldRow('audience');
      await user.selectOptions(row.getByRole('combobox', { name: 'Source for extra param audience' }), 'static');
      await user.type(screen.getByRole('textbox', { name: 'Static value for extra param audience' }), 'api://custom');

      expect(asOperationNode(useWorkflowStore.getState().nodes[0]).credentialExtraParamOverrides).toEqual({
        audience: { source: 'static', value: 'api://custom' },
      });
    });

    it('switching a row back to Default clears the override entirely', async () => {
      const user = userEvent.setup();
      useWorkflowStore.setState({
        nodes: [
          makeNode({
            credentialId: 'cred-oauth2',
            credentialExtraParamOverridesEnabled: true,
            credentialExtraParamOverrides: { audience: { source: 'static', value: 'api://custom' } },
          }),
        ],
        selectedNodeId: 'node-1',
        credentials: [oauth2Credential],
      });
      render(<NodeConfig />);

      const row = fieldRow('audience');
      await user.selectOptions(row.getByRole('combobox', { name: 'Source for extra param audience' }), 'default');

      expect(asOperationNode(useWorkflowStore.getState().nodes[0]).credentialExtraParamOverrides).toEqual({});
    });

    it('turning the toggle back off hides the rows without clearing the stored overrides', async () => {
      const user = userEvent.setup();
      useWorkflowStore.setState({
        nodes: [
          makeNode({
            credentialId: 'cred-oauth2',
            credentialExtraParamOverridesEnabled: true,
            credentialExtraParamOverrides: { audience: { source: 'static', value: 'api://custom' } },
          }),
        ],
        selectedNodeId: 'node-1',
        credentials: [oauth2Credential],
      });
      render(<NodeConfig />);

      await user.click(screen.getByRole('checkbox', { name: 'Override credential extra params' }));

      expect(asOperationNode(useWorkflowStore.getState().nodes[0]).credentialExtraParamOverridesEnabled).toBe(false);
      expect(asOperationNode(useWorkflowStore.getState().nodes[0]).credentialExtraParamOverrides).toEqual({
        audience: { source: 'static', value: 'api://custom' },
      });
      expect(screen.queryByText((_, el) => el?.tagName === 'LABEL' && el.textContent === 'audience')).not.toBeInTheDocument();
    });
  });

  it('offers no "Fill with random data" bulk-fill control — dropped along with the dice icon', () => {
    useWorkflowStore.setState({
      nodes: [makeNode({ rawBody: { template: '{"name":""}', tags: {} } })],
      selectedNodeId: 'node-1',
    });
    render(<NodeConfig />);
    expect(screen.queryByRole('button', { name: 'Fill with random data' })).not.toBeInTheDocument();
  });

  describe('Request help tooltip', () => {
    it('is hidden until the info button is clicked, and closes again on Escape', () => {
      useWorkflowStore.setState({ nodes: [makeNode()], selectedNodeId: 'node-1' });
      render(<NodeConfig />);

      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Help' }));
      expect(screen.getByRole('tooltip')).toBeInTheDocument();

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });

    it('closes on an outside click', () => {
      useWorkflowStore.setState({ nodes: [makeNode()], selectedNodeId: 'node-1' });
      render(<NodeConfig />);

      fireEvent.click(screen.getByRole('button', { name: 'Help' }));
      expect(screen.getByRole('tooltip')).toBeInTheDocument();

      fireEvent.mouseDown(document.body);
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });

    it('always shows the "{{" mapping tip, and mentions $rand. only for an operation with a request body', () => {
      // Gated by the operation's own requestBodySchema (see NodeConfig.tsx's
      // hasBody), not by whether the node currently has a rawBody section.
      useWorkflowStore.setState({ nodes: [makeNode({ operationId: 'GET /pet/{petId}' })], selectedNodeId: 'node-1' });
      const { rerender } = render(<NodeConfig />);
      fireEvent.click(screen.getByRole('button', { name: 'Help' }));
      expect(screen.getByText(/inside a string to map a value/)).toBeInTheDocument();
      expect(screen.queryByText(/for a random value/)).not.toBeInTheDocument();

      // Tooltip is already open from the click above and stays open across
      // this rerender (its own component state, not tied to node data).
      useWorkflowStore.setState({
        nodes: [makeNode({ operationId: 'POST /pet' })], // petOperation has a body schema
      });
      rerender(<NodeConfig />);
      expect(screen.getByText(/for a random value/)).toBeInTheDocument();
    });
  });

  describe('locked while a run is in progress', () => {
    it('shows a banner and disables the fieldset (credential lock, Raw editors) via the fieldset', () => {
      useWorkflowStore.setState({
        nodes: [makeNode({ rawBody: { template: '{"name":""}', tags: {} } })],
        selectedNodeId: 'node-1',
        isRunning: true,
      });
      render(<NodeConfig />);

      expect(screen.getByText('Workflow is running — editing is locked until it finishes.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Credential' })).toBeDisabled();
      expect(document.querySelector('.node-config__fieldset')).toBeDisabled();
    });

    it("doesn't show the banner or disable anything when not running", () => {
      useWorkflowStore.setState({ nodes: [makeNode()], selectedNodeId: 'node-1', isRunning: false });
      render(<NodeConfig />);

      expect(screen.queryByText(/editing is locked/)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Credential' })).not.toBeDisabled();
    });
  });

  describe('multipart file upload', () => {
    it('renders the Body editor for a multipart operation (file fields are attached via an uploaded_file tag chip — see RawBodyEditor.test.tsx/TagConfigModal.test.tsx)', () => {
      const productOp: Operation = {
        id: 'POST /products',
        method: 'post',
        path: '/products',
        parameters: [],
        requestBodySchema: {
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string' }, image: { type: 'string', format: 'binary' } },
        },
        requestBodyContentType: 'multipart/form-data',
        responseSchema: null,
      };
      useWorkflowStore.setState({
        nodes: [makeNode({ operationId: productOp.id, rawBody: { template: '{"name":""}', tags: {} } })],
        operations: [productOp],
        selectedNodeId: 'node-1',
      });
      render(<NodeConfig />);

      expect(screen.getByRole('heading', { name: 'Body' })).toBeInTheDocument();
      expect(document.querySelectorAll('.raw-body-editor')).toHaveLength(1);
    });
  });
});
