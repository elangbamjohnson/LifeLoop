// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Dashboard } from '../../src/client/features/dashboard/Dashboard';

// Mock matchMedia for jsdom
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

vi.mock('../../src/client/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'user-1', email: 'test@example.com' },
    loading: false,
    logout: vi.fn(),
  }),
}));

vi.mock('../../src/client/hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'light', toggleTheme: vi.fn() }),
}));

vi.mock('../../src/client/hooks/useLiveSync', () => ({
  useLiveSync: vi.fn(),
}));

const mockItems = [
  {
    id: 'item-test-123',
    userId: 'user-1',
    title: 'Renew Passport Now',
    itemType: 'task',
    status: 'active',
    dueDate: '2026-10-30T00:00:00.000Z',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  },
];

vi.mock('../../src/client/hooks/useDashboardPolling', () => ({
  useDashboardPolling: () => ({
    captures: [],
    setCaptures: vi.fn(),
    items: mockItems,
    setItems: vi.fn(),
    loading: false,
    refetch: vi.fn(),
  }),
}));

describe('Open Item from URL (?item=<id>)', () => {
  it('opens item edit modal automatically when item id is present in the URL query string', async () => {
    window.history.pushState({}, '', '/?item=item-test-123');
    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText('Edit Life Item')).toBeDefined();
      expect(screen.getByDisplayValue('Renew Passport Now')).toBeDefined();
    });
  });
});
