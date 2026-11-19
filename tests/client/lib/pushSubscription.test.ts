// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { disableBrowserPush } from '../../../src/client/lib/pushSubscription';
const unsubscribe = vi.fn();
const original = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
beforeEach(() => {
  unsubscribe.mockReset().mockResolvedValue(true);
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {
    getRegistration: async () => ({ pushManager: { getSubscription: async () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/test', unsubscribe }) } }),
  } });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ success: true, removed: true })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (original) Object.defineProperty(navigator, 'serviceWorker', original);
  else Reflect.deleteProperty(navigator, 'serviceWorker');
});
it('disables the browser subscription even when the API is unreachable', async () => {
  vi.mocked(fetch).mockRejectedValue(new TypeError('offline'));
  await expect(disableBrowserPush()).resolves.toBeUndefined();
  expect(unsubscribe).toHaveBeenCalledOnce();
});
it('removes server registration if browser unsubscribe fails', async () => {
  unsubscribe.mockRejectedValue(new Error('browser error'));
  await expect(disableBrowserPush()).resolves.toBeUndefined();
  expect(fetch).toHaveBeenCalledWith('/api/v1/push/subscribe', expect.objectContaining({ method: 'DELETE' }));
});
it.each([false, true])('reports failure when neither side can confirm removal (API failure: %s)', async (apiFails) => {
  unsubscribe.mockRejectedValue(new Error('browser error'));
  vi.mocked(fetch).mockResolvedValue(Response.json({ removed: false }, { status: apiFails ? 500 : 200 }));
  await expect(disableBrowserPush()).rejects.toThrow("Couldn't turn off notifications");
});
