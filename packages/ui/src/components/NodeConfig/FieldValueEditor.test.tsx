import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { buildNodeLabels } from '@get-enlace/core';
import { FieldValueEditor } from './FieldValueEditor.js';
import type { Operation, RawBody, WorkflowNode } from '../../types.js';

function node(id: string, operationId: string): WorkflowNode {
  return { id, kind: 'operation', operationId, credentialId: null };
}

const ops: Operation[] = [
  {
    id: 'GET /orders/{id}',
    method: 'get',
    path: '/orders/{id}',
    parameters: [],
    requestBodySchema: null,
    requestBodyContentType: null,
    responseSchema: { type: 'object', properties: { id: { type: 'string' } } },
  },
];
const labelsFor = (nodes: WorkflowNode[]) => buildNodeLabels(nodes, new Map(ops.map((o) => [o.id, o])));

describe('FieldValueEditor', () => {
  it('renders its label inline with the field, and the initial literal text inside the CodeMirror doc', async () => {
    const value: RawBody = { template: 'cust-42', tags: {} };
    const { container } = render(
      <FieldValueEditor label="id" value={value} onChange={() => {}} ancestorNodes={[]} nodeLabels={labelsFor([])} operations={[]} />
    );
    expect(screen.getByText('id')).toBeInTheDocument();
    await waitFor(() => {
      expect(container.querySelector('.cm-content')?.textContent).toContain('cust-42');
    });
  });

  it('renders a tag chip for a placeholder present in the template', async () => {
    const a = node('node-a', 'GET /orders/{id}');
    const value: RawBody = {
      template: '{{enlace:tag1}}',
      tags: { tag1: { id: 'tag1', type: 'response_body', sourceNodeId: 'node-a', jsonPath: 'id' } },
    };
    const { container } = render(
      <FieldValueEditor label="id" value={value} onChange={() => {}} ancestorNodes={[a]} nodeLabels={labelsFor([a])} operations={ops} />
    );
    await waitFor(() => {
      expect(container.querySelector('.tag-chip')).toBeTruthy();
    });
    // The chip itself is the "this is mapped" indicator — no separate mode/toggle.
    expect(container.querySelector('.tag-chip')?.textContent).toContain('id');
  });

  it('opens the edit modal (with a delete option) when a chip is clicked, matching RawBodyEditor\'s own flow', async () => {
    const a = node('node-a', 'GET /orders/{id}');
    const value: RawBody = {
      template: '{{enlace:tag1}}Suffix',
      tags: { tag1: { id: 'tag1', type: 'response_body', sourceNodeId: 'node-a', jsonPath: 'id' } },
    };
    const { container } = render(
      <FieldValueEditor label="id" value={value} onChange={() => {}} ancestorNodes={[a]} nodeLabels={labelsFor([a])} operations={ops} />
    );
    const chip = await waitFor(() => {
      const el = container.querySelector('.tag-chip');
      expect(el).toBeTruthy();
      return el!;
    });
    fireEvent.click(chip);
    expect(await screen.findByText('Edit mapping')).toBeInTheDocument();
    expect(screen.getByText('Remove mapping')).toBeInTheDocument();
  });

  it('deletes the chip and its tag when "Remove mapping" is confirmed', async () => {
    const a = node('node-a', 'GET /orders/{id}');
    const onChange = vi.fn();
    const value: RawBody = {
      template: '{{enlace:tag1}}Suffix',
      tags: { tag1: { id: 'tag1', type: 'response_body', sourceNodeId: 'node-a', jsonPath: 'id' } },
    };
    const { container } = render(
      <FieldValueEditor label="id" value={value} onChange={onChange} ancestorNodes={[a]} nodeLabels={labelsFor([a])} operations={ops} />
    );
    const chip = await waitFor(() => {
      const el = container.querySelector('.tag-chip');
      expect(el).toBeTruthy();
      return el!;
    });
    fireEvent.click(chip);
    fireEvent.click(await screen.findByText('Remove mapping'));

    expect(onChange).toHaveBeenCalledWith({ template: 'Suffix', tags: {} });
  });

  it('renders read-only (dimmed, non-editable) chrome when readOnly is set', async () => {
    const value: RawBody = { template: 'literal', tags: {} };
    const { container } = render(
      <FieldValueEditor label="id" value={value} onChange={() => {}} ancestorNodes={[]} nodeLabels={labelsFor([])} operations={[]} readOnly />
    );
    await waitFor(() => {
      expect(container.querySelector('.raw-body-editor__codemirror--readonly')).toBeTruthy();
    });
  });
});
