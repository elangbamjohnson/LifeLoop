import { test, expect, Page } from '@playwright/test';
import { authenticateAndSeedSession } from './fixtures';

async function openPreferencesModal(page: Page) {
  if (await page.locator('#preferences-modal-card').isVisible()) return;

  const profileBtn = page.locator('#user-profile-menu-btn');
  await expect(profileBtn).toBeVisible({ timeout: 10000 });
  await profileBtn.click();

  const prefsBtn = page.locator('#profile-preferences-btn');
  await expect(prefsBtn).toBeVisible({ timeout: 5000 });
  await prefsBtn.click();

  await expect(page.locator('#preferences-modal-card')).toBeVisible({ timeout: 5000 });
}

async function assertNoHorizontalScroll(page: Page) {
  const hasOverflow = await page.evaluate(() => {
    return document.documentElement.scrollWidth > document.documentElement.clientWidth;
  });
  expect(hasOverflow).toBe(false);
}

test.describe('push notifications', () => {
  test('push notifications - state: not supported shows and has no horizontal scroll', async ({
    page,
    request,
    baseURL,
  }) => {
    // Mock Notification and PushManager as undefined/unsupported
    await page.addInitScript(() => {
      Object.defineProperty(window, 'Notification', {
        value: undefined,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        configurable: true,
      });
    });

    await authenticateAndSeedSession(page, request, baseURL!);
    await page.goto(baseURL!);
    await openPreferencesModal(page);

    const badge = page.locator('#channel-web-row [data-testid="push-status-badge"]');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText(/not supported/i);

    await assertNoHorizontalScroll(page);
  });

  test('push notifications - state: on iOS but not installed to the Home Screen shows and has no horizontal scroll', async ({
    page,
    request,
    baseURL,
  }) => {
    // Mock iOS userAgent not in standalone mode
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
        configurable: true,
      });
      Object.defineProperty(navigator, 'standalone', {
        value: false,
        configurable: true,
      });
      const originalMatchMedia = window.matchMedia;
      window.matchMedia = (query) => {
        if (query === '(display-mode: standalone)') {
          return { matches: false, addListener: () => {}, removeListener: () => {} } as any;
        }
        return originalMatchMedia ? originalMatchMedia(query) : ({ matches: false } as any);
      };
    });

    await authenticateAndSeedSession(page, request, baseURL!);
    await page.goto(baseURL!);
    await openPreferencesModal(page);

    const badge = page.locator('#channel-web-row [data-testid="push-status-badge"]');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText(/on iOS but not installed to the Home Screen/i);

    await assertNoHorizontalScroll(page);
  });

  test('push notifications - state: blocked shows and has no horizontal scroll', async ({
    page,
    request,
    baseURL,
  }) => {
    // Mock Notification.permission as denied
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
      (window as any).Notification = {
        permission: 'denied',
        requestPermission: async () => 'denied',
      };
      (window as any).PushManager = class {};
    });

    await authenticateAndSeedSession(page, request, baseURL!);
    await page.goto(baseURL!);
    await openPreferencesModal(page);

    const badge = page.locator('#channel-web-row [data-testid="push-status-badge"]');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText(/blocked/i);

    await assertNoHorizontalScroll(page);
  });

  test('push notifications - state: on shows and has no horizontal scroll', async ({
    page,
    request,
    baseURL,
  }) => {
    // Mock Notification.permission as granted, with PushManager
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
      (window as any).Notification = {
        permission: 'granted',
        requestPermission: async () => 'granted',
      };
      (window as any).PushManager = class {};
    });

    await authenticateAndSeedSession(page, request, baseURL!);
    await page.goto(baseURL!);
    await openPreferencesModal(page);

    const badge = page.locator('#channel-web-row [data-testid="push-status-badge"]');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText(/\bon\b/i);

    await assertNoHorizontalScroll(page);
  });
});
