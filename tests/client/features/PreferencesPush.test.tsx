// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PreferencesModal } from '../../../src/client/features/dashboard/PreferencesModal';

let saved = false;
let registrationFails = false;
let configured = true;
const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/test', toJSON: () => ({ keys: { p256dh: 'key', auth: 'auth' } }) };
const subscribe = vi.fn();
const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
beforeEach(() => {
  saved = false;
  registrationFails = false;
  configured = true;
  subscribe.mockReset().mockResolvedValue(subscription);
  vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn().mockResolvedValue('granted') });
  vi.stubGlobal('PushManager', class {});
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {
    getRegistration: async () => ({ active: {}, pushManager: { getSubscription: async () => subscription, subscribe } }),
  } });
  vi.stubGlobal('fetch', vi.fn(async (url, options) => {
    if (url === '/api/v1/push/status') return Response.json({ registered: saved, available: configured });
    if (url === '/api/v1/push/public-key') return Response.json({ publicKey: configured ? 'dGVzdA' : '' });
    if (url === '/api/v1/push/subscribe' && options?.method === 'POST') {
      if (registrationFails) return Response.json({ error: 'Internal Server Error' }, { status: 500 });
      saved = true;
      return Response.json({ success: true });
    }
    return Response.json({ preferences: { channels: ['web'] } });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (originalServiceWorker) Object.defineProperty(navigator, 'serviceWorker', originalServiceWorker);
  else Reflect.deleteProperty(navigator, 'serviceWorker');
});
async function openPreferences() {
  render(<PreferencesModal isOpen onClose={() => {}} />);
  const toggle = screen.getByRole('button', { name: 'In-App / Push Notifications' });
  await waitFor(() => expect(toggle.getAttribute('aria-busy')).toBe('false'));
  return toggle;
}
it('does not show On from browser permission and preferences alone', async () => {
  await openPreferences();
  expect(screen.getByTestId('push-status-badge').textContent).toBe('off');
});
it('shows On for a confirmed subscription belonging to this account', async () => {
  saved = true;
  await openPreferences();
  expect(screen.getByTestId('push-status-badge').textContent).toBe('on');
});
it('keeps push Off and reports a failed registration, then permits retry', async () => {
  registrationFails = true;
  const toggle = await openPreferences();
  fireEvent.click(toggle);
  await screen.findByRole('alert');
  expect(screen.getByTestId('push-status-badge').textContent).toBe('off');
  registrationFails = false;
  fireEvent.click(toggle);
  await waitFor(() => expect(screen.getByTestId('push-status-badge').textContent).toBe('on'));
});
it('keeps push Off when VAPID configuration is unavailable', async () => {
  saved = true;
  configured = false;
  const toggle = await openPreferences();
  expect(screen.getByTestId('push-status-badge').textContent).toBe('off');
  fireEvent.click(toggle);
  expect((await screen.findByRole('alert')).textContent).toContain('Push notifications are unavailable');
  expect(subscribe).not.toHaveBeenCalled();
});
