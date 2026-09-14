import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChromeSettingsMenu } from './ChromeSettingsMenu.js';
import { useWorkflowStore } from '../../store/workflowStore.js';
import { useThemeStore } from '../../store/themeStore.js';

describe('ChromeSettingsMenu', () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      credentials: [],
      nodes: [],
      connections: [],
      nodePositions: {},
      isRunning: false,
      credentialReview: null,
      operations: [],
      specInfo: null,
    });
    useThemeStore.setState({ preference: 'system', resolved: 'light' });
  });

  it('opens a settings menu with Credentials, Export, and Import', async () => {
    const user = userEvent.setup();
    render(<ChromeSettingsMenu />);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Settings' }));

    const menu = screen.getByRole('menu', { name: 'Settings' });
    expect(menu).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Credentials (0)' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Export' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Import' })).toBeInTheDocument();
  });

  it('reopens after an outside click dismissed it', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <button type="button">Elsewhere</button>
        <ChromeSettingsMenu />
      </div>
    );

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('toggles closed when the gear is clicked again', async () => {
    const user = userEvent.setup();
    render(<ChromeSettingsMenu />);

    const gear = screen.getByRole('button', { name: 'Settings' });
    await user.click(gear);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.click(gear);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('Credentials menu item opens the credentials drawer', async () => {
    const user = userEvent.setup();
    useWorkflowStore.setState({
      credentials: [{ id: 'c1', name: 'staging', type: 'bearer', token: 'secret' }],
    });
    render(<ChromeSettingsMenu />);

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(screen.getByRole('menuitem', { name: 'Credentials (1)' }));

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Credentials' })).toBeInTheDocument();
  });

  it('Export menu item opens the export dialog when the canvas has nodes', async () => {
    const user = userEvent.setup();
    useWorkflowStore.setState({
      nodes: [{ id: 'n1', kind: 'operation', operationId: 'GET /a', credentialId: null }],
      nodePositions: { n1: { x: 0, y: 0 } },
    });
    render(<ChromeSettingsMenu />);

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(screen.getByRole('menuitem', { name: 'Export' }));

    expect(screen.getByRole('dialog', { name: 'Export Enlace collection' })).toBeInTheDocument();
  });

  describe('theme toggle', () => {
    it('shows a single button reflecting the current preference, System by default', async () => {
      const user = userEvent.setup();
      render(<ChromeSettingsMenu />);
      await user.click(screen.getByRole('button', { name: 'Settings' }));

      expect(screen.getByRole('menuitem', { name: /Theme: System/ })).toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: /Theme: Light/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: /Theme: Dark/ })).not.toBeInTheDocument();
    });

    it('clicking cycles System -> Light -> Dark -> System, updating the store each time', async () => {
      const user = userEvent.setup();
      render(<ChromeSettingsMenu />);
      await user.click(screen.getByRole('button', { name: 'Settings' }));

      await user.click(screen.getByRole('menuitem', { name: /Theme: System/ }));
      expect(useThemeStore.getState().preference).toBe('light');
      expect(screen.getByRole('menuitem', { name: /Theme: Light/ })).toBeInTheDocument();

      await user.click(screen.getByRole('menuitem', { name: /Theme: Light/ }));
      expect(useThemeStore.getState().preference).toBe('dark');
      expect(screen.getByRole('menuitem', { name: /Theme: Dark/ })).toBeInTheDocument();

      await user.click(screen.getByRole('menuitem', { name: /Theme: Dark/ }));
      expect(useThemeStore.getState().preference).toBe('system');
      expect(screen.getByRole('menuitem', { name: /Theme: System/ })).toBeInTheDocument();
    });

    it('the choice survives closing and reopening the menu', async () => {
      const user = userEvent.setup();
      render(<ChromeSettingsMenu />);
      await user.click(screen.getByRole('button', { name: 'Settings' }));
      await user.click(screen.getByRole('menuitem', { name: /Theme: System/ }));

      await user.click(screen.getByRole('button', { name: 'Settings' }));
      await user.click(screen.getByRole('button', { name: 'Settings' }));
      expect(screen.getByRole('menuitem', { name: /Theme: Light/ })).toBeInTheDocument();
    });
  });
});
