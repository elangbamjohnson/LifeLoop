import { test, expect } from '@playwright/test';
import { authenticateAndSeedSession } from './fixtures';

test.describe('reminder banner', () => {
  test('reminder banner shows, auto-dismisses, tap opens the item, and does not show for another user', async ({
    page,
    request,
    baseURL,
  }) => {
    // 1. Authenticate user and seed session with an item
    await authenticateAndSeedSession(page, request, baseURL!);

    // Fetch user id and seeded item id
    const meRes = await request.get(`${baseURL}/api/v1/auth/me`);
    const { user } = await meRes.json();
    const userId = user.id;

    const itemsRes = await request.get(`${baseURL}/api/v1/items`);
    const { items } = await itemsRes.json();
    const seededItem = items[0];
    expect(seededItem).toBeDefined();

    await page.goto(baseURL!);
    await page.waitForSelector('[id^="item-card-"]', { state: 'visible', timeout: 10000 });
    // Allow SSE connection to establish
    await page.waitForTimeout(500);

    // 2. Assert it does NOT show for another user's events
    await request.post(`${baseURL}/api/v1/test/publish-event`, {
      data: {
        userId: '00000000-0000-0000-0000-000000000000',
        event: {
          type: 'reminder_delivered',
          entity: 'reminder',
          id: 'rem-other-user',
          title: 'Private reminder for someone else',
          itemId: 'other-item-id',
          at: new Date().toISOString(),
        },
      },
    });

    await page.waitForTimeout(500);
    await expect(page.locator('[data-testid="reminder-banner"]')).toBeHidden();

    // 3. Assert banner shows for the current user's event
    await request.post(`${baseURL}/api/v1/test/publish-event`, {
      data: {
        userId,
        event: {
          type: 'reminder_delivered',
          entity: 'reminder',
          id: 'rem-test-1',
          title: 'Renew Geico Policy Today',
          itemId: seededItem.id,
          at: new Date().toISOString(),
        },
      },
    });

    const banner = page.locator('[data-testid="reminder-banner"]');
    await expect(banner).toBeVisible({ timeout: 5000 });
    await expect(banner).toContainText('Renew Geico Policy Today');

    // 4. Tap opens the item
    const bannerContent = page.locator('[data-testid="reminder-banner-content"]');
    await bannerContent.click();

    // Verify item edit modal opened with the item's details
    await expect(page.locator('#item-edit-modal-card')).toBeVisible({ timeout: 5000 });
    await expect(banner).toBeHidden();

    // Close the item modal
    await page.locator('#item-edit-modal-card button').first().click();
    await expect(page.locator('#item-edit-modal-card')).toBeHidden({ timeout: 5000 });

    // 5. Test auto-dismiss: trigger another banner and wait for auto-dismiss (~8 seconds)
    await request.post(`${baseURL}/api/v1/test/publish-event`, {
      data: {
        userId,
        event: {
          type: 'reminder_delivered',
          entity: 'reminder',
          id: 'rem-test-2',
          title: 'Auto Dismissing Notification',
          itemId: seededItem.id,
          at: new Date().toISOString(),
        },
      },
    });

    await expect(banner).toBeVisible({ timeout: 5000 });
    await expect(banner).toContainText('Auto Dismissing Notification');

    // After 8.5 seconds, banner should be automatically dismissed
    await expect(banner).toBeHidden({ timeout: 10000 });
  });
});
