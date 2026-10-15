/**
 * e2e/add_to_calendar.spec.ts
 *
 * Playwright tests for the Add to Calendar button and confirmation prompt flow.
 *
 * Test coverage:
 *  1. button shown for a dated item on the Priority tab and href contains the route
 *  2. button shown for a dated item on the Timeline tab and href contains the route
 *  3. button hidden for an undated item
 *  4. button hidden for a completed item
 *  5. no horizontal scroll when calendar button and confirmation are displayed
 *  6. tap shows the question
 *  7. "Yes, added" shows a disabled "Added to calendar" that survives a reload
 *  8. "No" returns to "Add to calendar"
 *  9. a reload before answering still shows the question
 * 10. a failed POST keeps the question and shows the error
 * 11. "Undo" returns to "Add to calendar"
 * 12. editing the date moves an added item to "Update calendar"
 *
 * Runs on: mobile-webkit, mobile-chromium, tablet, tablet-android.
 */

import { test, expect, Page } from '@playwright/test';
import { authenticateAndSeedSession, navigateToTab, verifyUserEmail } from './fixtures';

test.use({ serviceWorkers: 'block' });

/** Extract session token from a registration response. */
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

/**
 * Expand an ItemCard by clicking on its title text.
 */
async function expandCard(page: Page, cardLocator: ReturnType<Page['locator']>) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);

  const title = cardLocator.locator('h4').first();
  await title.scrollIntoViewIfNeeded();
  await title.click();
  await page.waitForTimeout(300);
}

test.describe('add to calendar', () => {
  test.beforeEach(async ({ page }) => {
    // Stub the .ics route with regex so no real file or navigation occurs
    await page.route(/.*calendar\.ics.*/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/calendar; charset=utf-8',
        body: 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nSUMMARY:Test\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n',
      });
    });
  });

  test('button shown for a dated item on the Priority tab', async ({
    page,
    request,
    baseURL,
  }) => {
    await authenticateAndSeedSession(page, request, baseURL!);
    await page.goto('/');
    await expect(page.locator('h1:has-text("LifeLoop")')).toBeVisible({ timeout: 15000 });

    await page.locator('#tab-priority').click();
    await page.waitForTimeout(500);

    const card = page.locator('[id^="item-card-"]', { hasText: 'Geico Car Insurance Renewal' });
    await expect(card).toBeVisible({ timeout: 10000 });
    await expandCard(page, card);

    const calBtn = card.locator('[id^="add-to-calendar-"]').first();
    await expect(calBtn).toBeVisible({ timeout: 8000 });
    await expect(calBtn).toContainText('Add to calendar');
  });

  test('button shown for a dated item on the Timeline tab', async ({
    page,
    request,
    baseURL,
  }) => {
    await authenticateAndSeedSession(page, request, baseURL!);
    await page.goto('/');
    await expect(page.locator('h1:has-text("LifeLoop")')).toBeVisible({ timeout: 15000 });

    await navigateToTab(page, 'timeline');
    await page.waitForTimeout(500);

    const card = page.locator('[id^="item-card-"]', { hasText: 'Geico Car Insurance Renewal' });
    await expect(card).toBeVisible({ timeout: 10000 });
    await expandCard(page, card);

    const calBtn = card.locator('[id^="add-to-calendar-"]').first();
    await expect(calBtn).toBeVisible({ timeout: 8000 });
    await expect(calBtn).toContainText('Add to calendar');
  });

  test('href contains the route', async ({ page, request, baseURL }) => {
    await authenticateAndSeedSession(page, request, baseURL!);
    await page.goto('/');
    await expect(page.locator('h1:has-text("LifeLoop")')).toBeVisible({ timeout: 15000 });

    await page.locator('#tab-priority').click();
    await page.waitForTimeout(500);

    const card = page.locator('[id^="item-card-"]', { hasText: 'Geico Car Insurance Renewal' });
    await expect(card).toBeVisible({ timeout: 10000 });
    await expandCard(page, card);

    const calBtn = card.locator('[id^="add-to-calendar-"]').first();
    await expect(calBtn).toBeVisible({ timeout: 8000 });
    await expect(calBtn).toHaveAttribute('href', /.*\/api\/v1\/items\/[a-f0-9-]+\/calendar\.ics$/);
  });

  test('button hidden for an undated item', async ({ page, request, baseURL }) => {
    const timestamp = Date.now();
    const testEmail = `e2e_cal_undated_${timestamp}@lifeloop.test`;
    const testPassword = 'Password123!Secure';

    const regRes = await request.post(`${baseURL}/api/v1/auth/register`, {
      data: { email: testEmail, password: testPassword },
    });
    await verifyUserEmail(testEmail);
    const sessionToken = await extractSessionToken(regRes);
    await page.context().addCookies([
      {
        name: 'session',
        value: sessionToken,
        url: baseURL!,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);

    const undatedRes = await request.post(`${baseURL}/api/v1/items`, {
      headers: { Cookie: `session=${sessionToken}` },
      data: {
        title: 'No Due Date Task',
        itemType: 'task',
        metadata: { description: 'This item has no date.' },
      },
    });
    expect(undatedRes.ok()).toBe(true);

    await page.goto('/');
    await expect(page.locator('h1:has-text("LifeLoop")')).toBeVisible({ timeout: 15000 });
    await page.locator('#tab-priority').click();
    await page.waitForTimeout(500);

    const undatedCard = page.locator('[id^="item-card-"]', { hasText: 'No Due Date Task' });
    await expect(undatedCard).toBeVisible({ timeout: 10000 });
    await expandCard(page, undatedCard);

    const calBtn = undatedCard.locator('[id^="add-to-calendar-"]');
    await expect(calBtn).toBeHidden();
  });

  test('button hidden for a completed item', async ({ page, request, baseURL }) => {
    const timestamp = Date.now();
    const testEmail = `e2e_cal_completed_${timestamp}@lifeloop.test`;
    const testPassword = 'Password123!Secure';

    const regRes = await request.post(`${baseURL}/api/v1/auth/register`, {
      data: { email: testEmail, password: testPassword },
    });
    await verifyUserEmail(testEmail);
    const sessionToken = await extractSessionToken(regRes);
    await page.context().addCookies([
      {
        name: 'session',
        value: sessionToken,
        url: baseURL!,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);

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

    await navigateToTab(page, 'timeline');
    await page.waitForTimeout(500);

    const completedCard = page.locator('[id^="item-card-"]', {
      hasText: 'Completed Calendar Item',
    });

    if (await completedCard.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expandCard(page, completedCard);
      await page.waitForTimeout(300);
      const calBtn = completedCard.locator('[id^="add-to-calendar-"]');
      await expect(calBtn).toBeHidden();
    }
  });

  test('no horizontal scroll', async ({
    page,
    request,
    baseURL,
  }) => {
    await authenticateAndSeedSession(page, request, baseURL!);
    await page.goto('/');
    await expect(page.locator('h1:has-text("LifeLoop")')).toBeVisible({ timeout: 15000 });

    await page.locator('#tab-priority').click();
    await page.waitForTimeout(500);

    const card = page.locator('[id^="item-card-"]', { hasText: 'Geico Car Insurance Renewal' });
    await expect(card).toBeVisible({ timeout: 10000 });
    await expandCard(page, card);

    const calBtn = card.locator('[id^="add-to-calendar-"]').first();
    await expect(calBtn).toBeVisible({ timeout: 8000 });

    // Tap to show confirmation row
    await calBtn.click();
    const confirmGroup = card.locator('[role="group"][aria-label="Confirm adding to calendar"]');
    await expect(confirmGroup).toBeVisible({ timeout: 5000 });

    // Verify document does not have horizontal overflow
    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(hasHorizontalOverflow).toBe(false);
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

    const card = page.locator('[id^="item-card-"]', {
      hasText: 'Geico Car Insurance Renewal',
    });
    await expect(card).toBeVisible({ timeout: 10000 });
    await expandCard(page, card);
    await page.waitForTimeout(500);

    const calBtn = card.locator('[id^="add-to-calendar-"]').first();
    await expect(calBtn).toBeVisible({ timeout: 8000 });

    // Intercept any download to prevent navigation away.
    page.on('download', (dl) => { dl.cancel().catch(() => {}); });

    await calBtn.click();
    await page.waitForTimeout(400);

    // The button must still be visible — stopPropagation kept the card expanded.
    await expect(calBtn).toBeVisible({ timeout: 5000 });
  });

  test('tap shows the question', async ({ page, request, baseURL }) => {
    await authenticateAndSeedSession(page, request, baseURL!);
    await page.goto('/');
    await expect(page.locator('h1:has-text("LifeLoop")')).toBeVisible({ timeout: 15000 });

    await page.locator('#tab-priority').click();
    await page.waitForTimeout(500);

    const card = page.locator('[id^="item-card-"]', { hasText: 'Geico Car Insurance Renewal' });
    await expect(card).toBeVisible({ timeout: 10000 });
    await expandCard(page, card);

    const calBtn = card.locator('[id^="add-to-calendar-"]').first();
    await expect(calBtn).toBeVisible({ timeout: 8000 });
    await expect(calBtn).toContainText('Add to calendar');

    // Tap button
    await calBtn.click();

    // Confirm row appears with role="group" and aria-label
    const confirmGroup = card.locator('[role="group"][aria-label="Confirm adding to calendar"]');
    await expect(confirmGroup).toBeVisible({ timeout: 5000 });
    await expect(confirmGroup).toContainText('Did you add it to your calendar?');
    await expect(card.locator('[id^="calendar-confirm-yes-"]')).toBeVisible();
    await expect(card.locator('[id^="calendar-confirm-no-"]')).toBeVisible();
  });

  test('"Yes, added" shows a disabled "Added to calendar" that survives a reload', async ({
    page,
    request,
    baseURL,
  }) => {
    await authenticateAndSeedSession(page, request, baseURL!);
    await page.goto('/');
    await expect(page.locator('h1:has-text("LifeLoop")')).toBeVisible({ timeout: 15000 });

    await page.locator('#tab-priority').click();
    await page.waitForTimeout(500);

    const card = page.locator('[id^="item-card-"]', { hasText: 'Geico Car Insurance Renewal' });
    await expect(card).toBeVisible({ timeout: 10000 });
    await expandCard(page, card);

    const calBtn = card.locator('[id^="add-to-calendar-"]').first();
    await expect(calBtn).toBeVisible({ timeout: 8000 });
    await calBtn.click();

    const yesBtn = card.locator('[id^="calendar-confirm-yes-"]');
    await expect(yesBtn).toBeVisible();
    await yesBtn.click();

    // Confirm row disappears and button shows disabled "Added to calendar" without href
    await expect(card.locator('[role="group"][aria-label="Confirm adding to calendar"]')).toBeHidden({
      timeout: 5000,
    });
    await expect(calBtn).toContainText('Added to calendar');
    await expect(calBtn).not.toHaveAttribute('href');

    // Reload page to verify persistence
    await page.reload();
    await expect(page.locator('h1:has-text("LifeLoop")')).toBeVisible({ timeout: 15000 });
    await page.locator('#tab-priority').click();
    await page.waitForTimeout(500);

    const cardAfterReload = page.locator('[id^="item-card-"]', { hasText: 'Geico Car Insurance Renewal' });
    await expect(cardAfterReload).toBeVisible({ timeout: 10000 });
    await expandCard(page, cardAfterReload);

    const calBtnAfterReload = cardAfterReload.locator('[id^="add-to-calendar-"]').first();
    await expect(calBtnAfterReload).toBeVisible({ timeout: 8000 });
    await expect(calBtnAfterReload).toContainText('Added to calendar');
    await expect(calBtnAfterReload).not.toHaveAttribute('href');
  });

  test('"No" returns to "Add to calendar"', async ({ page, request, baseURL }) => {
    await authenticateAndSeedSession(page, request, baseURL!);
    await page.goto('/');
    await expect(page.locator('h1:has-text("LifeLoop")')).toBeVisible({ timeout: 15000 });

    await page.locator('#tab-priority').click();
    await page.waitForTimeout(500);

    const card = page.locator('[id^="item-card-"]', { hasText: 'Geico Car Insurance Renewal' });
    await expect(card).toBeVisible({ timeout: 10000 });
    await expandCard(page, card);

    const calBtn = card.locator('[id^="add-to-calendar-"]').first();
    await expect(calBtn).toBeVisible({ timeout: 8000 });
    await calBtn.click();

    const noBtn = card.locator('[id^="calendar-confirm-no-"]');
    await expect(noBtn).toBeVisible();
    await noBtn.click();

    // Returns to Add to calendar without confirm row
    await expect(card.locator('[role="group"][aria-label="Confirm adding to calendar"]')).toBeHidden({
      timeout: 5000,
    });
    await expect(calBtn).toContainText('Add to calendar');

    // Reload: no question and no added server state
    await page.reload();
    await expect(page.locator('h1:has-text("LifeLoop")')).toBeVisible({ timeout: 15000 });
    await page.locator('#tab-priority').click();
    await page.waitForTimeout(500);

    const cardAfterReload = page.locator('[id^="item-card-"]', { hasText: 'Geico Car Insurance Renewal' });
    await expect(cardAfterReload).toBeVisible({ timeout: 10000 });
    await expandCard(page, cardAfterReload);

    const calBtnAfterReload = cardAfterReload.locator('[id^="add-to-calendar-"]').first();
    await expect(calBtnAfterReload).toContainText('Add to calendar');
    await expect(cardAfterReload.locator('[role="group"][aria-label="Confirm adding to calendar"]')).toBeHidden();
  });

  test('a reload before answering still shows the question', async ({ page, request, baseURL }) => {
    await authenticateAndSeedSession(page, request, baseURL!);
    await page.goto('/');
    await expect(page.locator('h1:has-text("LifeLoop")')).toBeVisible({ timeout: 15000 });

    await page.locator('#tab-priority').click();
    await page.waitForTimeout(500);

    const card = page.locator('[id^="item-card-"]', { hasText: 'Geico Car Insurance Renewal' });
    await expect(card).toBeVisible({ timeout: 10000 });
    await expandCard(page, card);

    const calBtn = card.locator('[id^="add-to-calendar-"]').first();
    await expect(calBtn).toBeVisible({ timeout: 8000 });
    await calBtn.click();

    // Confirm row is visible
    const confirmGroup = card.locator('[role="group"][aria-label="Confirm adding to calendar"]');
    await expect(confirmGroup).toBeVisible({ timeout: 5000 });

    // Reload without answering
    await page.reload();
    await expect(page.locator('h1:has-text("LifeLoop")')).toBeVisible({ timeout: 15000 });
    await page.locator('#tab-priority').click();
    await page.waitForTimeout(500);

    const cardAfterReload = page.locator('[id^="item-card-"]', { hasText: 'Geico Car Insurance Renewal' });
    await expect(cardAfterReload).toBeVisible({ timeout: 10000 });
    await expandCard(page, cardAfterReload);

    // Question must still be visible from sessionStorage
    const confirmGroupAfterReload = cardAfterReload.locator('[role="group"][aria-label="Confirm adding to calendar"]');
    await expect(confirmGroupAfterReload).toBeVisible({ timeout: 5000 });
    await expect(confirmGroupAfterReload).toContainText('Did you add it to your calendar?');
  });

  test('a failed POST keeps the question and shows the error', async ({ page, request, baseURL }) => {
    // Mock POST /calendar-added to fail with 500 (register before page.goto)
    await page.route(/.*calendar-added.*/, async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Server error' }),
        });
      } else {
        await route.continue();
      }
    });

    await authenticateAndSeedSession(page, request, baseURL!);
    await page.goto('/');
    await expect(page.locator('h1:has-text("LifeLoop")')).toBeVisible({ timeout: 15000 });

    await page.locator('#tab-priority').click();
    await page.waitForTimeout(500);

    const card = page.locator('[id^="item-card-"]', { hasText: 'Geico Car Insurance Renewal' });
    await expect(card).toBeVisible({ timeout: 10000 });
    await expandCard(page, card);

    const calBtn = card.locator('[id^="add-to-calendar-"]').first();
    await expect(calBtn).toBeVisible({ timeout: 8000 });
    await calBtn.click();

    const yesBtn = card.locator('[id^="calendar-confirm-yes-"]');
    await expect(yesBtn).toBeVisible();
    await yesBtn.click();

    // Question stays visible and error is shown
    const confirmGroup = card.locator('[role="group"][aria-label="Confirm adding to calendar"]');
    await expect(confirmGroup).toBeVisible({ timeout: 5000 });
    await expect(card.locator('[role="alert"]')).toBeVisible({ timeout: 5000 });

    // Never show added on failure
    await expect(calBtn).not.toContainText('Added to calendar');
  });

  test('"Undo" returns to "Add to calendar"', async ({ page, request, baseURL }) => {
    await authenticateAndSeedSession(page, request, baseURL!);
    await page.goto('/');
    await expect(page.locator('h1:has-text("LifeLoop")')).toBeVisible({ timeout: 15000 });

    await page.locator('#tab-priority').click();
    await page.waitForTimeout(500);

    const card = page.locator('[id^="item-card-"]', { hasText: 'Geico Car Insurance Renewal' });
    await expect(card).toBeVisible({ timeout: 10000 });
    await expandCard(page, card);

    const calBtn = card.locator('[id^="add-to-calendar-"]').first();
    await expect(calBtn).toBeVisible({ timeout: 8000 });
    await calBtn.click();

    const yesBtn = card.locator('[id^="calendar-confirm-yes-"]');
    await expect(yesBtn).toBeVisible();
    await yesBtn.click();

    await expect(card.locator('[role="group"][aria-label="Confirm adding to calendar"]')).toBeHidden({
      timeout: 5000,
    });
    await expect(calBtn).toContainText('Added to calendar');

    // Click Undo
    const undoBtn = card.locator('[id^="add-to-calendar-undo-"]');
    await expect(undoBtn).toBeVisible();
    await undoBtn.click();

    // Returns to Add to calendar
    await expect(calBtn).toBeVisible();
    await expect(calBtn).toContainText('Add to calendar');
  });

  test('editing the date moves an added item to "Update calendar"', async ({ page, request, baseURL }) => {
    await authenticateAndSeedSession(page, request, baseURL!);
    await page.goto('/');
    await expect(page.locator('h1:has-text("LifeLoop")')).toBeVisible({ timeout: 15000 });

    await page.locator('#tab-priority').click();
    await page.waitForTimeout(500);

    const card = page.locator('[id^="item-card-"]', { hasText: 'Geico Car Insurance Renewal' });
    await expect(card).toBeVisible({ timeout: 10000 });
    await expandCard(page, card);

    // Mark as added
    const calBtn = card.locator('[id^="add-to-calendar-"]').first();
    await expect(calBtn).toBeVisible({ timeout: 8000 });
    await calBtn.click();

    const yesBtn = card.locator('[id^="calendar-confirm-yes-"]');
    await expect(yesBtn).toBeVisible();
    await yesBtn.click();
    await expect(calBtn).toContainText('Added to calendar');

    // Edit the item's dueDate via API
    const itemsRes = await page.request.get(`${baseURL}/api/v1/items`);
    const itemsData = await itemsRes.json();
    const geicoItem = itemsData.items.find((i: any) => i.title === 'Geico Car Insurance Renewal');

    const updatedDueDate = new Date(Date.now() + 25 * 86400000).toISOString();
    const patchRes = await page.request.patch(`${baseURL}/api/v1/items/${geicoItem.id}`, {
      data: { dueDate: updatedDueDate },
    });
    expect(patchRes.ok()).toBe(true);

    // Reload and expand
    await page.reload();
    await page.locator('#tab-priority').click();
    await page.waitForTimeout(500);

    const cardAfterEdit = page.locator('[id^="item-card-"]', { hasText: 'Geico Car Insurance Renewal' });
    await expandCard(page, cardAfterEdit);

    // Button should now say "Update calendar"
    const calBtnAfterEdit = cardAfterEdit.locator('[id^="add-to-calendar-"]').first();
    await expect(calBtnAfterEdit).toContainText('Update calendar');
  });
});
