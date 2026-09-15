import { createRef } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OperationList, type OperationListHandle } from './OperationList.js';
import type { Operation } from '../../types.js';

function makeOperation(overrides: Partial<Operation>): Operation {
  return {
    id: 'GET /pet',
    method: 'get',
    path: '/pet',
    parameters: [],
    requestBodySchema: null,
    requestBodyContentType: null,
    responseSchema: null,
    ...overrides,
  };
}

describe('OperationList', () => {
  it('renders each operation\'s method and path', () => {
    render(
      <OperationList
        operations={[
          makeOperation({ id: 'GET /pet', method: 'get', path: '/pet' }),
          makeOperation({ id: 'POST /pet', method: 'post', path: '/pet' }),
        ]}
      />
    );

    expect(screen.getByText('GET')).toBeInTheDocument();
    expect(screen.getByText('POST')).toBeInTheDocument();
    expect(screen.getAllByText('/pet')).toHaveLength(2);
  });

  it('shows the operationId as a legend when the spec declares one, omits it otherwise', () => {
    render(
      <OperationList
        operations={[
          makeOperation({ id: 'POST /pet', operationId: 'addPet' }),
          makeOperation({ id: 'GET /pet/{id}', operationId: undefined }),
        ]}
      />
    );

    expect(screen.getByText('addPet')).toBeInTheDocument();
    // No operationId means no <legend> at all — not an empty one.
    expect(document.querySelectorAll('legend')).toHaveLength(1);
  });

  it('sets the operation id as drag data on dragstart, so Canvas can read it on drop', () => {
    render(<OperationList operations={[makeOperation({ id: 'POST /pet' })]} />);

    const item = screen.getByText('/pet').closest('li')!;
    const dataTransfer = { setData: vi.fn() };
    fireEvent.dragStart(item, { dataTransfer });

    expect(dataTransfer.setData).toHaveBeenCalledWith('text/operation-id', 'POST /pet');
  });

  it('shows presets only on the Presets tab, as named rows with a description', async () => {
    const user = userEvent.setup();
    render(<OperationList operations={[makeOperation({ operationId: 'addPet' })]} />);

    expect(screen.queryByText('Wait')).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /Presets/ }));

    expect(screen.getByText('Wait')).toBeInTheDocument();
    expect(screen.getByText('Pause for a set time')).toBeInTheDocument();
    expect(screen.queryByText('addPet')).not.toBeInTheDocument();
  });

  it('Operations is the default tab, and arrow keys switch tabs', async () => {
    const user = userEvent.setup();
    render(<OperationList operations={[]} />);

    expect(screen.getByRole('tab', { name: /Operations/ })).toHaveAttribute('aria-selected', 'true');
    screen.getByRole('tab', { name: /Operations/ }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: /Presets/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('a Wait preset row sets a distinct preset-kind drag payload', async () => {
    const user = userEvent.setup();
    render(<OperationList operations={[]} />);
    await user.click(screen.getByRole('tab', { name: /Presets/ }));

    const item = screen.getByText('Wait').closest('li')!;
    const dataTransfer = { setData: vi.fn() };
    fireEvent.dragStart(item, { dataTransfer });

    expect(dataTransfer.setData).toHaveBeenCalledWith('text/preset-kind', 'wait');
  });

  it('an Assert preset row sets a distinct preset-kind drag payload', async () => {
    const user = userEvent.setup();
    render(<OperationList operations={[]} />);
    await user.click(screen.getByRole('tab', { name: /Presets/ }));

    const item = screen.getByText('Assert').closest('li')!;
    const dataTransfer = { setData: vi.fn() };
    fireEvent.dragStart(item, { dataTransfer });

    expect(dataTransfer.setData).toHaveBeenCalledWith('text/preset-kind', 'assert');
  });

  describe('search', () => {
    const operations = [
      makeOperation({ id: 'POST /pet', operationId: 'addPet' }),
      makeOperation({ id: 'GET /pet/{id}', operationId: 'getPetById' }),
      // No operationId at all — can never match a search, per the
      // operationId-only scope of this first pass.
      makeOperation({ id: 'DELETE /pet/{id}', operationId: undefined }),
    ];

    it('shows every operation when the search box is empty', () => {
      render(<OperationList operations={operations} />);
      expect(screen.getAllByRole('listitem')).toHaveLength(3);
    });

    it('filters by a case-insensitive operationId substring', () => {
      render(<OperationList operations={operations} />);

      fireEvent.change(screen.getByLabelText('Search operations and presets'), {
        target: { value: 'PET' },
      });

      expect(screen.getAllByRole('listitem')).toHaveLength(2);
      expect(screen.getByText('addPet')).toBeInTheDocument();
      expect(screen.getByText('getPetById')).toBeInTheDocument();
      // Neither preset name contains "pet" — no cross-tab hint either.
      expect(screen.queryByText(/in Presets/)).not.toBeInTheDocument();
    });

    it('narrows further on a more specific query', () => {
      render(<OperationList operations={operations} />);

      fireEvent.change(screen.getByLabelText('Search operations and presets'), {
        target: { value: 'addPet' },
      });

      expect(screen.getAllByRole('listitem')).toHaveLength(1);
      expect(screen.getByText('addPet')).toBeInTheDocument();
    });

    it('shows an operations empty-state message when nothing matches', () => {
      render(<OperationList operations={operations} />);

      fireEvent.change(screen.getByLabelText('Search operations and presets'), {
        target: { value: 'nonexistent' },
      });

      expect(screen.queryAllByRole('listitem')).toHaveLength(0);
      expect(screen.getByText('No operations match "nonexistent".')).toBeInTheDocument();
    });

    it('also matches on /path prefix search (operations-only, no cross-tab hint)', () => {
      const mixedOps = [
        makeOperation({ id: 'GET /pets', path: '/pets', operationId: 'listPets' }),
        makeOperation({ id: 'POST /orders', path: '/orders', operationId: 'createOrder' }),
      ];
      render(<OperationList operations={mixedOps} />);

      fireEvent.change(screen.getByLabelText('Search operations and presets'), {
        target: { value: '/orders' },
      });

      expect(screen.getAllByRole('listitem')).toHaveLength(1);
      expect(screen.getByText('createOrder')).toBeInTheDocument();
      expect(screen.queryByText(/in Presets/)).not.toBeInTheDocument();
    });

    it('a /path search with no operation match shows the operations-only empty message, not the combined one', () => {
      render(<OperationList operations={operations} />);

      fireEvent.change(screen.getByLabelText('Search operations and presets'), {
        target: { value: '/nonexistent' },
      });

      expect(screen.getByText('No operations match "/nonexistent".')).toBeInTheDocument();
    });

    it('a plain-text search that only matches a preset name points at the Presets tab, and clicking it switches', async () => {
      const user = userEvent.setup();
      render(<OperationList operations={operations} />);

      fireEvent.change(screen.getByLabelText('Search operations and presets'), {
        target: { value: 'wait' },
      });

      expect(screen.queryAllByRole('listitem')).toHaveLength(0);
      await user.click(screen.getByRole('button', { name: '1 match in Presets →' }));

      expect(screen.getByText('Wait')).toBeInTheDocument();
      expect(screen.queryByText('Assert')).not.toBeInTheDocument();
    });

    it('on the Presets tab, search filters preset names and shows a presets empty message', async () => {
      const user = userEvent.setup();
      render(<OperationList operations={operations} />);
      await user.click(screen.getByRole('tab', { name: /Presets/ }));

      fireEvent.change(screen.getByLabelText('Search operations and presets'), { target: { value: 'ass' } });
      expect(screen.getByText('Assert')).toBeInTheDocument();
      expect(screen.queryByText('Wait')).not.toBeInTheDocument();

      fireEvent.change(screen.getByLabelText('Search operations and presets'), { target: { value: 'zzz' } });
      expect(screen.getByText('No presets match "zzz".')).toBeInTheDocument();
    });
  });

  describe('tag grouping', () => {
    const taggedOps = [
      makeOperation({ id: 'GET /pets', path: '/pets', operationId: 'listPets', tags: ['pets'] }),
      makeOperation({ id: 'POST /pets', path: '/pets', operationId: 'addPet', tags: ['pets'] }),
      makeOperation({ id: 'GET /orders', path: '/orders', operationId: 'listOrders', tags: ['orders'] }),
      makeOperation({ id: 'DELETE /misc', path: '/misc', operationId: 'deleteMisc' }), // untagged → (untagged) group
    ];

    it('renders a collapsible group header for each tag', () => {
      render(<OperationList operations={taggedOps} />);

      expect(screen.getByRole('button', { name: /pets/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /orders/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /untagged/i })).toBeInTheDocument();
    });

    it('all groups start expanded, showing their operations', () => {
      render(<OperationList operations={taggedOps} />);

      expect(screen.getByText('listPets')).toBeInTheDocument();
      expect(screen.getByText('addPet')).toBeInTheDocument();
      expect(screen.getByText('listOrders')).toBeInTheDocument();
      expect(screen.getByText('deleteMisc')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /pets/i })).toHaveAttribute('aria-expanded', 'true');
    });

    it('clicking a group header collapses it, hiding only its operations', async () => {
      const user = userEvent.setup();
      render(<OperationList operations={taggedOps} />);

      await user.click(screen.getByRole('button', { name: /pets/i }));

      expect(screen.queryByText('listPets')).not.toBeInTheDocument();
      expect(screen.queryByText('addPet')).not.toBeInTheDocument();
      expect(screen.getByText('listOrders')).toBeInTheDocument();
    });

    it('clicking a collapsed group expands it again', async () => {
      const user = userEvent.setup();
      render(<OperationList operations={taggedOps} />);

      const btn = screen.getByRole('button', { name: /pets/i });
      await user.click(btn); // collapse
      await user.click(btn); // expand
      expect(screen.getByText('listPets')).toBeInTheDocument();
    });

    it('search expands matching groups and hides empty ones', () => {
      render(<OperationList operations={taggedOps} />);

      fireEvent.change(screen.getByLabelText('Search operations and presets'), {
        target: { value: 'order' },
      });

      expect(screen.getByText('listOrders')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /pets/i })).not.toBeInTheDocument();
    });

    it('clearing the search returns groups to their default (expanded) state', () => {
      render(<OperationList operations={taggedOps} />);

      const input = screen.getByLabelText('Search operations and presets');
      fireEvent.change(input, { target: { value: 'order' } });
      expect(screen.getByText('listOrders')).toBeInTheDocument();

      fireEvent.change(input, { target: { value: '' } });
      expect(screen.getByRole('button', { name: /orders/i })).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByText('listPets')).toBeInTheDocument();
    });

    it('Collapse all / Expand all toggles every group', async () => {
      const user = userEvent.setup();
      render(<OperationList operations={taggedOps} />);

      expect(screen.getByRole('button', { name: 'Collapse all' })).toBeInTheDocument();
      expect(screen.getByText('listPets')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Collapse all' }));
      expect(screen.queryByText('listPets')).not.toBeInTheDocument();
      expect(screen.queryByText('listOrders')).not.toBeInTheDocument();
      expect(screen.queryByText('deleteMisc')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Expand all' })).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Expand all' }));
      expect(screen.getByText('listPets')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Collapse all' })).toBeInTheDocument();
    });

    it('hides the expand/collapse toggle while searching', () => {
      render(<OperationList operations={taggedOps} />);

      fireEvent.change(screen.getByLabelText('Search operations and presets'), {
        target: { value: 'order' },
      });

      expect(screen.queryByRole('button', { name: /Expand all|Collapse all/ })).not.toBeInTheDocument();
    });

    it('renders a flat list (no group headers) when no operations have tags', () => {
      const untagged = [
        makeOperation({ id: 'GET /a', path: '/a', operationId: 'opA' }),
        makeOperation({ id: 'GET /b', path: '/b', operationId: 'opB' }),
      ];
      render(<OperationList operations={untagged} />);

      expect(screen.queryByRole('button', { name: /opA|opB/i })).not.toBeInTheDocument();
      expect(screen.getByText('opA')).toBeInTheDocument();
      expect(screen.getByText('opB')).toBeInTheDocument();
    });
  });

  it('exposes focusSearch via ref, for the app-level "press space to search" shortcut', () => {
    const ref = createRef<OperationListHandle>();
    render(<OperationList ref={ref} operations={[]} />);

    ref.current?.focusSearch();

    expect(screen.getByLabelText('Search operations and presets')).toHaveFocus();
  });
});
