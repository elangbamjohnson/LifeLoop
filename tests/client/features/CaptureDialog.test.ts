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

describe('CaptureDialog Save Error Handling & Form State Retention', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('keeps dialog open, keeps text and file, shows error with role="alert", and re-enables save button on failure', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("Please verify your email address to access this resource"));

    render(
      React.createElement(CaptureDialog, {
        isOpen: true,
        onClose,
        onSubmit,
        isAdmin: true,
      })
    );

    const textarea = screen.getByPlaceholderText(/what's on your mind/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Important meeting notes' } });
    expect(textarea.value).toBe('Important meeting notes');

    const saveButton = screen.getByRole('button', { name: /save to lifeloop/i });
    fireEvent.click(saveButton);

    // Wait for async rejection to be processed
    await vi.waitFor(() => {
      expect(screen.getByRole('alert')).not.toBeNull();
    });

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Please verify your email address to access this resource');

    // Dialog stays open: onClose was NOT called
    expect(onClose).not.toHaveBeenCalled();

    // Text is still preserved
    expect(textarea.value).toBe('Important meeting notes');

    // Save button is re-enabled
    expect((saveButton as HTMLButtonElement).disabled).toBe(false);

    // Editing the text clears the error alert
    fireEvent.change(textarea, { target: { value: 'Important meeting notes edited' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('clears text and closes dialog on successful submission', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      React.createElement(CaptureDialog, {
        isOpen: true,
        onClose,
        onSubmit,
        isAdmin: true,
      })
    );

    const textarea = screen.getByPlaceholderText(/what's on your mind/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Grocery list' } });

    const saveButton = screen.getByRole('button', { name: /save to lifeloop/i });
    fireEvent.click(saveButton);

    await vi.waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    expect(textarea.value).toBe('');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('prevents double submission: clicking save twice while in flight only invokes onSubmit once', async () => {
    let resolveSubmission: () => void = () => {};
    const pendingPromise = new Promise<void>((resolve) => {
      resolveSubmission = resolve;
    });
    const onSubmit = vi.fn().mockReturnValue(pendingPromise);

    render(
      React.createElement(CaptureDialog, {
        isOpen: true,
        onClose,
        onSubmit,
        isAdmin: true,
      })
    );

    const textarea = screen.getByPlaceholderText(/what's on your mind/i);
    fireEvent.change(textarea, { target: { value: 'Single submit note' } });

    const saveButton = screen.getByRole('button', { name: /save to lifeloop/i });
    // First click initiates request
    fireEvent.click(saveButton);
    expect(onSubmit).toHaveBeenCalledTimes(1);

    // Second click during in-flight request should be ignored
    fireEvent.click(saveButton);
    expect(onSubmit).toHaveBeenCalledTimes(1);

    // Resolve the promise
    resolveSubmission();
    await vi.waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});

