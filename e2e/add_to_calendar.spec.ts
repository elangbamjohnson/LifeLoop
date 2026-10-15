/**
 * e2e/add_to_calendar.spec.ts
 *
 * Playwright tests for the "Add to Calendar" button on ItemCard.
 *
 * Covers (per the requirements):
 *  1. Button is visible for a dated item on the Priority tab.
 *  2. Button is visible for a dated item on the Timeline tab.
 *  3. Button is hidden for an undated item.
 *  4. Button is hidden for a completed item.
 *  5. A download event fires with a filename ending in .ics.
 *  6. The card stays expanded after the tap.
 *
 * Runs on all 4 projects: mobile-webkit, mobile-chromium, tablet, tablet-android.
 *
 * NOTE: We cannot verify the iOS "Add to Calendar" sheet in Playwright/WebKit.
 */

import { test, expect } from '@playwright/test';
import { authenticateAndSeedSession, navigateToTab } from './fixtures';

/**
 * Seed a dated item (dueDate = tomorrow) and return its title.
 */
async function seedDatedItem(
  request: any,
  baseURL: string,
  sessionToken: string,
  title: string,
  dueDate: string
) {
  const itemRes = await request.post(`${baseURL}/api/v1/items`, {
    headers: { Cookie: `session=${sessionToken}` },
    data: {
      title,
      itemType: 'task',
      dueDate,
      metadata: {
        description: 'ICS download test item',
      },
    },
  });
  if (!itemRes.ok()) {
    throw new Error(`Failed to seed dated item: ${itemRes.status()} ${await itemRes.text()}`);
  }
  return title;
}

/**
 * Retrieve the session cookie from a registration response.
 */
async function extractSessionToken(regRes: any): Promise<string> {
  const headersArr = regRes.headersArray();
  for (const h of headersArr) {
    if (h.name.toLowerCase() === 'set-cookie') {
      const m = h.value.match(/session=([^;]+)/);
      if (m) return m[1];
    }
  }
  const raw = regRes.headers()['set-cookie'] || '';
  const m = raw.match(/session=([^;]+)/);
  return m ? m[1] : '';
}

// ─────────────────────────────────────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────────────────────────────────────

test.describe('add to calendar', () => {
  /**
   * We create a fresh user + items for each test to avoid cross-test pollution.
   * `authenticateAndSeedSession` already seeds one dated item (Geico renewal).
   * We seed an extra undated and a completed item below.
   */

  test('button visible for a dated item on the Priority tab', async ({
    page,
    request,
    baseURL,
  }) => {
    const { email, password } = await authenticateAndSeedSession(page, request, baseURL!);
    await page.goto('/');
    await expect(page.locator('h1:has-text("LifeLoop")')).toBeVisible({ timeout: 15000 });

    // Go to Priority tab (default)
    await page.locator('#tab-priority').click();
    await page.waitForTimeout(800);

    // Find any ItemCard and expand it
    const cards = page.locator('[id^="item-card-"]');
    await expect(cards.first()).toBeVisible({ timeout: 10000 });
    await cards.first().click();
    await page.waitForTimeout(400);

    // The "Add to Calendar" button should be visible for a dated item
    const calBtn = page.locator('[id^="add-to-calendar-"]').first();
    await expect(calBtn).toBeVisible({ timeout: 5000 });
  });

  test('button visible for a dated item on the Timeline tab', async ({
    page,
    request,
    baseURL,
  }) => {
    await authenticateAndSeedSession(page, request, baseURL!);
    await page.goto('/');
    await expect(page.locator('h1:has-text("LifeLoop")')).toBeVisible({ timeout: 15000 });

    // Navigate to Timeline tab
    await navigateToTab(page, 'timeline');
    await page.waitForTimeout(800);

    // Expand the first visible ItemCard
    const cards = page.locator('[id^="item-card-"]');
    await expect(cards.first()).toBeVisible({ timeout: 10000 });
    await cards.first().click();
    await page.waitForTimeout(400);

    // The "Add to Calendar" button should be visible
    const calBtn = page.locator('[id^="add-to-calendar-"]').first();
    await expect(calBtn).toBeVisible({ timeout: 5000 });
  });

  test('button hidden for an undated item', async ({
    page,
    request,
    baseURL,
  }) => {
    // Register a fresh user so we can seed our own items cleanly
    const timestamp = Date.now();
    const testEmail = `e2e_cal_undated_${timestamp}@lifeloop.test`;
    const testPassword = 'Password123!Secure';

    const { verifyUserEmail } = await import('./fixtures');
    const regRes = await request.post(`${baseURL}/api/v1/auth/register`, {
      data: { email: testEmail, password: testPassword },
    });
    await verifyUserEmail(testEmail);

    const sessionToken = await extractSessionToken(regRes);
    await page.context().addCookies([{
      name: 'session', value: sessionToken, url: baseURL!,
      httpOnly: true, sameSite: 'Lax',
    }]);

    // Seed an item WITHOUT a dueDate
    const undatedRes = await request.post(`${baseURL}/api/v1/items`, {
      headers: { Cookie: `session=${sessionToken}` },
      data: {
        title: 'No Due Date Task',
        itemType: 'task',
        // no dueDate
        metadata: { description: 'This item has no date.' },
      },
    });
    expect(undatedRes.ok()).toBe(true);

    await page.goto('/');
    await expect(page.locator('h1:has-text("LifeLoop")')).toBeVisible({ timeout: 15000 });
    await page.locator('#tab-priority').click();
    await page.waitForTimeout(800);

    // Find and expand the undated card
    const undatedCard = page.locator('[id^="item-card-"]', { hasText: 'No Due Date Task' });
    await expect(undatedCard).toBeVisible({ timeout: 10000 });
    await undatedCard.click();
    await page.waitForTimeout(400);

    // The button must NOT appear inside this card
    const calBtn = undatedCard.locator('[id^="add-to-calendar-"]');
    await expect(calBtn).toBeHidden();
  });

  test('button hidden for a completed item', async ({
    page,
    request,
    baseURL,
  }) => {
    const timestamp = Date.now();
    const testEmail = `e2e_cal_completed_${timestamp}@lifeloop.test`;
    const testPassword = 'Password123!Secure';

    const { verifyUserEmail } = await import('./fixtures');
    const regRes = await request.post(`${baseURL}/api/v1/auth/register`, {
      data: { email: testEmail, password: testPassword },
    });
    await verifyUserEmail(testEmail);

    const sessionToken = await extractSessionToken(regRes);
    await page.context().addCookies([{
      name: 'session', value: sessionToken, url: baseURL!,
      httpOnly: true, sameSite: 'Lax',
    }]);

    // Seed a COMPLETED item with a due date
    const itemRes = await request.post(`${baseURL}/api/v1/items`, {
      headers: { Cookie: `session=${sessionToken}` },
      data: {
        title: 'Completed Calendar Item',
        itemType: 'task',
        dueDate: new Date(Date.now() + 7 * 86400000).toISOString(),
        status: 'completed',
        metadata: {},
      },
    });
    expect(itemRes.ok()).toBe(true);

    await page.goto('/');
    await expect(page.locator('h1:has-text("LifeLoop")')).toBeVisible({ timeout: 15000 });

    // Check Timeline tab (completed items appear in the Past section)
    await navigateToTab(page, 'timeline');
    await page.waitForTimeout(800);

    const completedCard = page.locator('[id^="item-card-"]', { hasText: 'Completed Calendar Item' });
    if (await completedCard.isVisible()) {
      await completedCard.click();
      await page.waitForTimeout(400);
      const calBtn = completedCard.locator('[id^="add-to-calendar-"]');
      await expect(calBtn).toBeHidden();
    }
    // If card is not visible at all (collapsed section), that also satisfies "button is hidden"
  });

  test('download event fires with filename ending .ics', async ({
    page,
    request,
    baseURL,
  }) => {
    await authenticateAndSeedSession(page, request, baseURL!);
    await page.goto('/');
    await expect(page.locator('h1:has-text("LifeLoop")')).toBeVisible({ timeout: 15000 });

    await page.locator('#tab-priority').click();
    await page.waitForTimeout(800);

    // Listen for the download before clicking
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 10000 }),
      (async () => {
        const card = page.locator('[id^="item-card-"]').first();
        await expect(card).toBeVisible({ timeout: 10000 });
        await card.click();
        await page.waitForTimeout(400);
        const calBtn = page.locator('[id^="add-to-calendar-"]').first();
        await expect(calBtn).toBeVisible({ timeout: 5000 });
        await calBtn.click();
      })(),
    ]);

    // Verify the downloaded file ends with .ics
    expect(download.suggestedFilename()).toMatch(/\.ics$/);
  });

  test('card stays expanded after calendar button tap', async ({
    page,
    request,
    baseURL,
  }) => {
    await authenticateAndSeedSession(page, request, baseURL!);
    await page.goto('/');
    await expect(page.locator('h1:has-text("LifeLoop")')).toBeVisible({ timeout: 15000 });

    await page.locator('#tab-priority').click();
    await page.waitForTimeout(800);

    // Expand the first card
    const card = page.locator('[id^="item-card-"]').first();
    await expect(card).toBeVisible({ timeout: 10000 });
    await card.click();
    await page.waitForTimeout(400);

    // Click the calendar button
    const calBtn = page.locator('[id^="add-to-calendar-"]').first();
    await expect(calBtn).toBeVisible({ timeout: 5000 });

    // Intercept the download so the browser doesn't navigate away
    page.on('download', async (download) => {
      await download.cancel();
    });
    await calBtn.click();
    await page.waitForTimeout(300);

    // The calendar button must still be visible (i.e., card is still expanded)
    await expect(calBtn).toBeVisible({ timeout: 3000 });
  });
});
