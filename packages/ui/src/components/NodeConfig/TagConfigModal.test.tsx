import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useWorkflowStore } from '../../store/workflowStore.js';
import { TagConfigModal } from './TagConfigModal.js';
import { buildNodeLabels } from '@get-enlace/core';
import type { Operation, WorkflowNode } from '../../types.js';

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
    responseSchema: null,
  },
  {
    id: 'GET /orders',
    method: 'get',
    path: '/orders',
    parameters: [],
    requestBodySchema: null,
    requestBodyContentType: null,
    responseSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        total: { type: 'integer' },
      },
    },
  },
];
const opsById = new Map(ops.map((o) => [o.id, o]));
const labelsFor = (nodes: WorkflowNode[]) => buildNodeLabels(nodes, opsById);

beforeEach(() => {
  useWorkflowStore.setState({ runResult: null });
});

describe('TagConfigModal', () => {
  it('defaults Request to the first ancestor and disables confirm with no ancestors', () => {
    const onConfirm = vi.fn();
    render(
      <TagConfigModal
        ancestorNodes={[]}
        nodeLabels={labelsFor([])}
        operations={ops}
        initialType="response_body"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />
    );
    expect(screen.getByText('Insert')).toBeDisabled();
  });

  it('shows the JSONPath filter for response_body and inserts a tag on confirm', () => {
    const onConfirm = vi.fn();
    const a = node('node-a', 'GET /orders/{id}');
    render(
      <TagConfigModal
        ancestorNodes={[a]}
        nodeLabels={labelsFor([a])}
        operations={ops}
        initialType="response_body"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />
    );

    fireEvent.change(screen.getByPlaceholderText(/blank = whole body/), { target: { value: '$.items[0].id' } });
    fireEvent.click(screen.getByText('Insert'));

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'response_body', sourceNodeId: 'node-a', jsonPath: '$.items[0].id' })
    );
  });

  it('shows a header name field for response_header and requires it before confirming', () => {
    const onConfirm = vi.fn();
    const a = node('node-a', 'GET /orders/{id}');
    render(
      <TagConfigModal
        ancestorNodes={[a]}
        nodeLabels={labelsFor([a])}
        operations={ops}
        initialType="response_header"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />
    );

    expect(screen.getByText('Insert')).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/x-trace-id/), { target: { value: 'x-trace-id' } });
    expect(screen.getByText('Insert')).not.toBeDisabled();

    fireEvent.click(screen.getByText('Insert'));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'response_header', sourceNodeId: 'node-a', headerName: 'x-trace-id' })
    );
  });

  it('shows "no prior run" preview text when the source node has no captured response', () => {
    const a = node('node-a', 'GET /orders/{id}');
    render(
      <TagConfigModal
        ancestorNodes={[a]}
        nodeLabels={labelsFor([a])}
        operations={ops}
        initialType="response_body"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.getByText(/No prior run captured/)).toBeInTheDocument();
  });

  it('resolves a live preview value from the last run result', () => {
    useWorkflowStore.setState({
      runResult: {
        steps: [
          {
            nodeId: 'node-a',
            request: { method: 'GET', url: 'http://x', headers: {}, credentials: 'omit' },
            response: { status: 200, headers: {}, body: { items: [{ id: 'xyz' }] } },
            timestampStart: '',
            timestampEnd: '',
          },
        ],
      },
    });
    const a = node('node-a', 'GET /orders/{id}');
    render(
      <TagConfigModal
        ancestorNodes={[a]}
        nodeLabels={labelsFor([a])}
        operations={ops}
        initialType="response_body"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    fireEvent.change(screen.getByPlaceholderText(/blank = whole body/), { target: { value: 'items[0].id' } });
    expect(screen.getByText('"xyz"')).toBeInTheDocument();
  });

  it('pre-fills fields and offers a delete action when editing an existing tag', () => {
    const onDelete = vi.fn();
    const a = node('node-a', 'GET /orders/{id}');
    render(
      <TagConfigModal
        ancestorNodes={[a]}
        nodeLabels={labelsFor([a])}
        operations={ops}
        initialType="response_body"
        initialTag={{ id: 'tag1', type: 'response_body', sourceNodeId: 'node-a', jsonPath: 'items[0].id' }}
        onConfirm={() => {}}
        onDelete={onDelete}
        onCancel={() => {}}
      />
    );
    expect(screen.getByDisplayValue('items[0].id')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Remove mapping'));
    expect(onDelete).toHaveBeenCalled();
  });

  it("forces an explicit re-pick when editing a tag whose source node no longer exists, rather than silently keeping the stale one", () => {
    // Regression test for a reported bug: the source node was deleted,
    // then a *different* node was connected and picked as the new source
    // — but Save appeared to work while the tag kept pointing at the
    // deleted node. Root cause: <select value={sourceNodeId}> with no
    // matching <option> (the deleted id isn't in ancestorNodes) falls
    // back to displaying some option while React's own state silently
    // stays on the stale id — so clicking Save without ever firing
    // onChange re-saved the same broken mapping.
    const onConfirm = vi.fn();
    const replacement = node('node-b', 'GET /orders/{id}');
    render(
      <TagConfigModal
        ancestorNodes={[replacement]}
        nodeLabels={labelsFor([replacement])}
        operations={ops}
        initialType="response_body"
        initialTag={{ id: 'tag1', type: 'response_body', sourceNodeId: 'node-deleted', jsonPath: 'item.title' }}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />
    );

    // Nothing is silently pre-selected from the stale id — Save starts disabled.
    expect(screen.getByText('Save')).toBeDisabled();
    fireEvent.click(screen.getByText('Save'));
    expect(onConfirm).not.toHaveBeenCalled();

    // Only an explicit selection enables it, and with the *new* node's id.
    const requestSelect = screen.getByLabelText('Request');
    fireEvent.change(requestSelect, { target: { value: 'node-b' } });
    expect(screen.getByText('Save')).not.toBeDisabled();
    fireEvent.click(screen.getByText('Save'));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ sourceNodeId: 'node-b' }));
  });

  describe('jsonPath autocomplete', () => {
    // Regression coverage for the type-safety follow-up to dropping Form
    // mode: the "Filter (JSONPath)" input used to be entirely blind typing
    // — no way to discover a real response field short of running the
    // chain first. It's now backed by a <datalist> of the selected
    // source's actual response fields (flattenSchema.ts's
    // flattenResponseFields), same low-tech pattern as the `$rand.`
    // methods datalist elsewhere in Node Config.
    it("offers the selected source's response fields, with their type, as datalist options", () => {
      const a = node('node-a', 'GET /orders');
      render(
        <TagConfigModal
          ancestorNodes={[a]}
          nodeLabels={labelsFor([a])}
          operations={ops}
          initialType="response_body"
          onConfirm={() => {}}
          onCancel={() => {}}
        />
      );

      const input = screen.getByPlaceholderText(/blank = whole body/);
      const listId = input.getAttribute('list');
      expect(listId).toBeTruthy();
      // getElementById, not a template-literal CSS selector — useId() ids
      // contain `:`, which isn't a valid bare selector character.
      // eslint-disable-next-line testing-library/no-node-access -- datalist options aren't exposed via any RTL query
      const options = [...document.getElementById(listId!)!.querySelectorAll('option')].map((o) => o.getAttribute('value'));
      expect(options).toEqual(['id', 'total']);
    });

    it('has no datalist options when the source operation declares no response schema', () => {
      const a = node('node-a', 'GET /orders/{id}');
      render(
        <TagConfigModal
          ancestorNodes={[a]}
          nodeLabels={labelsFor([a])}
          operations={ops}
          initialType="response_body"
          onConfirm={() => {}}
          onCancel={() => {}}
        />
      );
      expect(document.querySelector('datalist')).not.toBeInTheDocument();
    });

    it('updates the offered fields when the selected source node changes', () => {
      const a = node('node-a', 'GET /orders/{id}');
      const b = node('node-b', 'GET /orders');
      render(
        <TagConfigModal
          ancestorNodes={[a, b]}
          nodeLabels={labelsFor([a, b])}
          operations={ops}
          initialType="response_body"
          onConfirm={() => {}}
          onCancel={() => {}}
        />
      );
      expect(document.querySelector('datalist')).not.toBeInTheDocument();

      fireEvent.change(screen.getByLabelText('Request'), { target: { value: 'node-b' } });
      const input = screen.getByPlaceholderText(/blank = whole body/);
      const listId = input.getAttribute('list');
      // eslint-disable-next-line testing-library/no-node-access -- datalist options aren't exposed via any RTL query
      const options = [...document.getElementById(listId!)!.querySelectorAll('option')].map((o) => o.getAttribute('value'));
      expect(options).toEqual(['id', 'total']);
    });
  });

  describe('uploaded_file', () => {
    it('does not offer "Upload file" unless allowFileUpload is set', () => {
      render(
        <TagConfigModal
          ancestorNodes={[]}
          nodeLabels={labelsFor([])}
          operations={ops}
          initialType="response_body"
          onConfirm={() => {}}
          onCancel={() => {}}
        />
      );
      expect(screen.queryByText('Upload file')).not.toBeInTheDocument();
    });

    it('inserting a new file: disables Insert until a file is chosen, then confirms with the tag and the File', () => {
      const onConfirm = vi.fn();
      render(
        <TagConfigModal
          ancestorNodes={[]}
          nodeLabels={labelsFor([])}
          operations={ops}
          initialType="uploaded_file"
          allowFileUpload
          onConfirm={onConfirm}
          onCancel={() => {}}
        />
      );

      // No source-node picker for a local file attachment.
      expect(screen.queryByLabelText('Request')).not.toBeInTheDocument();
      expect(screen.getByText('Insert')).toBeDisabled();

      const file = new File(['abc'], 'photo.png', { type: 'image/png' });
      fireEvent.change(screen.getByLabelText('File to upload'), { target: { files: [file] } });
      expect(screen.getByText('Insert')).not.toBeDisabled();
      expect(screen.getByText('File: photo.png')).toBeInTheDocument();

      fireEvent.click(screen.getByText('Insert'));
      expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ type: 'uploaded_file', fileName: 'photo.png' }), file);
    });

    it('editing an existing file tag: Save is already enabled (keeps the current file) without picking a new one', () => {
      const onConfirm = vi.fn();
      render(
        <TagConfigModal
          ancestorNodes={[]}
          nodeLabels={labelsFor([])}
          operations={ops}
          initialType="uploaded_file"
          initialTag={{ id: 'tag1', type: 'uploaded_file', fileName: 'old.png' }}
          allowFileUpload
          onConfirm={onConfirm}
          onCancel={() => {}}
        />
      );

      expect(screen.getByText(/Currently "old\.png"/)).toBeInTheDocument();
      expect(screen.getByText('Save')).not.toBeDisabled();

      fireEvent.click(screen.getByText('Save'));
      // No new File picked — the caller keeps whatever's already stored (see
      // RawBodyEditor.tsx's handleEditConfirm).
      expect(onConfirm).toHaveBeenCalledWith({ id: 'tag1', type: 'uploaded_file', fileName: 'old.png' }, undefined);
    });

    it('editing an existing file tag and picking a replacement confirms with the new file', () => {
      const onConfirm = vi.fn();
      render(
        <TagConfigModal
          ancestorNodes={[]}
          nodeLabels={labelsFor([])}
          operations={ops}
          initialType="uploaded_file"
          initialTag={{ id: 'tag1', type: 'uploaded_file', fileName: 'old.png' }}
          allowFileUpload
          onConfirm={onConfirm}
          onCancel={() => {}}
        />
      );

      // The file input stays reachable even with an existing filename known
      // — no separate "clear" step needed to replace it.
      const file = new File(['abc'], 'new.png', { type: 'image/png' });
      fireEvent.change(screen.getByLabelText('File to upload'), { target: { files: [file] } });
      expect(screen.getByText('new.png')).toBeInTheDocument();
      fireEvent.click(screen.getByText('Save'));

      expect(onConfirm).toHaveBeenCalledWith({ id: 'tag1', type: 'uploaded_file', fileName: 'new.png' }, file);
    });
  });
});
