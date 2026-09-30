// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PreferencesModal } from '../../../src/client/features/dashboard/PreferencesModal';

describe('PreferencesModal Save Error Handling', () => {
  const originalFetch = global.fetch;
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    cleanup();
  });

  it('keeps modal open, shows error with role="alert", and re-enables save button on PUT failure', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.includes('/api/v1/reminders/preferences') && init?.method === 'PUT') {
        return {
          ok: false,
          status: 403,
          json: async () => ({ error: 'Please verify your email address to access this resource' }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ preferences: { autoReminders: false, emailReminders: false, channels: ['web'] } }),
      } as Response;
    });

    render(React.createElement(PreferencesModal, { isOpen: true, onClose }));

    const saveButton = screen.getByRole('button', { name: /save preferences/i });
    fireEvent.click(saveButton);

    await vi.waitFor(() => {
      expect(screen.getByRole('alert')).not.toBeNull();
    });

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Please verify your email address to access this resource');

    // Modal stays open
    expect(onClose).not.toHaveBeenCalled();

    // Save button is re-enabled
    expect((saveButton as HTMLButtonElement).disabled).toBe(false);

    // Toggling autoReminders clears error alert
    const autoRemindersRow = screen.getByLabelText('Automatic Reminders');
    fireEvent.click(autoRemindersRow);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('handles network failure (fetch throws) with friendly error', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        throw new TypeError('Failed to fetch');
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ preferences: {} }),
      } as Response;
    });

    render(React.createElement(PreferencesModal, { isOpen: true, onClose }));

    const saveButton = screen.getByRole('button', { name: /save preferences/i });
    fireEvent.click(saveButton);

    await vi.waitFor(() => {
      expect(screen.getByRole('alert')).not.toBeNull();
    });

    expect(screen.getByRole('alert').textContent).toContain(
      "Couldn't reach the server. Check your connection and try again."
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
