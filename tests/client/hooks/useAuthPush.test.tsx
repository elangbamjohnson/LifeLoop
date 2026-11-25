// @vitest-environment jsdom
import React from 'react';
import { renderHook, waitFor, act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '../../../src/client/hooks/useAuth';
import { disableBrowserPush, getBrowserPushSubscription, isPushRegistered } from '../../../src/client/lib/pushSubscription';

vi.mock('../../../src/client/lib/pushSubscription', () => ({
  disableBrowserPush: vi.fn(), getBrowserPushSubscription: vi.fn(), isPushRegistered: vi.fn(),
}));
const user = { id: 'account-a', email: 'a@example.test', isAdmin: false };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getBrowserPushSubscription).mockResolvedValue(null);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ user }) }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Push subscriptions and account lifecycle', () => {
  it('disables this device before logging out', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.user?.id).toBe(user.id));
    await act(() => result.current.logout());
    expect(disableBrowserPush).toHaveBeenCalledOnce();
    const disableOrder = vi.mocked(disableBrowserPush).mock.invocationCallOrder[0];
    const logoutOrder = vi.mocked(fetch).mock.invocationCallOrder[1];
    expect(disableOrder).toBeLessThan(logoutOrder);
    expect(result.current.user).toBeNull();
  });

  it('keeps the session and shows an error if notification cleanup fails', async () => {
    vi.mocked(disableBrowserPush).mockRejectedValue(new Error('Cleanup unavailable'));
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.user?.id).toBe(user.id));
    await act(() => result.current.logout());
    expect(result.current.user?.id).toBe(user.id);
    expect(result.current.logoutError).toBe('Cleanup unavailable');
    expect(fetch).not.toHaveBeenCalledWith('/api/v1/auth/logout', expect.anything());
  });

  it('unsubscribes when an existing device subscription belongs to the previous account', async () => {
    const unsubscribe = vi.fn().mockResolvedValue(true);
    vi.mocked(getBrowserPushSubscription).mockResolvedValue({ unsubscribe } as unknown as PushSubscription);
    vi.mocked(isPushRegistered).mockResolvedValue(true);
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(isPushRegistered).toHaveBeenCalled());
    expect(unsubscribe).not.toHaveBeenCalled();
    vi.mocked(isPushRegistered).mockResolvedValue(false);
    act(() => result.current.setUser({ ...user, id: 'account-b' }));
    await waitFor(() => expect(unsubscribe).toHaveBeenCalledOnce());
  });
});
