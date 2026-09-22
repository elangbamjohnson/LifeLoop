// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CaptureDialog } from '../../../src/client/features/dashboard/CaptureDialog';

// Mock useAuth
const mockUser = { id: 'user-1', email: 'user@example.com', isAdmin: false };
vi.mock('../../../src/client/hooks/useAuth', () => ({
  useAuth: () => ({
    user: mockUser,
    loading: false,
    checkAuth: vi.fn(),
    logout: vi.fn(),
  }),
}));

describe('CaptureDialog Admin Media Option Gating', () => {
  const onClose = vi.fn();
  const onSubmit = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    mockUser.isAdmin = false;
  });

  afterEach(() => {
    cleanup();
  });

  it('hides the Media tab button for non-admin user (via prop isAdmin=false)', () => {
    render(
      React.createElement(CaptureDialog, {
        isOpen: true,
        onClose,
        onSubmit,
        isAdmin: false,
      })
    );

    expect(screen.getByRole('button', { name: /text/i })).not.toBeNull();
    expect(screen.queryByRole('button', { name: /media/i })).toBeNull();
    expect(document.getElementById('capture-tab-media')).toBeNull();
  });

  it('hides the Media tab button for non-admin user (fallback from useAuth user.isAdmin=false)', () => {
    mockUser.isAdmin = false;
    render(
      React.createElement(CaptureDialog, {
        isOpen: true,
        onClose,
        onSubmit,
      })
    );

    expect(screen.getByRole('button', { name: /text/i })).not.toBeNull();
    expect(screen.queryByRole('button', { name: /media/i })).toBeNull();
  });

  it('shows the Media tab button for admin user (via prop isAdmin=true)', () => {
    render(
      React.createElement(CaptureDialog, {
        isOpen: true,
        onClose,
        onSubmit,
        isAdmin: true,
      })
    );

    const textTab = screen.getByRole('button', { name: /text/i });
    const mediaTab = screen.getByRole('button', { name: /media/i });

    expect(textTab).not.toBeNull();
    expect(mediaTab).not.toBeNull();
    expect(document.getElementById('capture-tab-media')).not.toBeNull();
  });

  it('shows the Media tab button for admin user (fallback from useAuth user.isAdmin=true)', () => {
    mockUser.isAdmin = true;
    render(
      React.createElement(CaptureDialog, {
        isOpen: true,
        onClose,
        onSubmit,
      })
    );

    expect(screen.getByRole('button', { name: /media/i })).not.toBeNull();
  });

  it('allows admin to switch to media tab and see upload interface', () => {
    render(
      React.createElement(CaptureDialog, {
        isOpen: true,
        onClose,
        onSubmit,
        isAdmin: true,
      })
    );

    const mediaTab = screen.getByRole('button', { name: /media/i });
    fireEvent.click(mediaTab);

    expect(screen.getByText(/upload file/i)).not.toBeNull();
  });

  it('non-admin cannot submit media even if file state was set', async () => {
    render(
      React.createElement(CaptureDialog, {
        isOpen: true,
        onClose,
        onSubmit,
        isAdmin: false,
      })
    );

    // Only text input should be rendered
    const textarea = screen.getByPlaceholderText(/what's on your mind/i);
    expect(textarea).not.toBeNull();

    fireEvent.change(textarea, { target: { value: 'Buy groceries' } });
    fireEvent.click(screen.getByRole('button', { name: /save to lifeloop/i }));

    expect(onSubmit).toHaveBeenCalledWith({ type: 'text', payload: 'Buy groceries' });
  });
});
