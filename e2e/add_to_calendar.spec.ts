/**
 * e2e/add_to_calendar.spec.ts
 *
 * Playwright tests for the Add to Calendar confirmation prompt flow.
 *
 * Tests (per requirements):
 *  1. tap shows the question
 *  2. "Yes, added" shows a disabled "Added to calendar" that survives a reload
 *  3. "No" returns to "Add to calendar"
 *  4. a reload before answering still shows the question
 *  5. a failed POST keeps the question and shows the error
 *  6. "Undo" returns to "Add to calendar"
 *  7. editing the date moves an added item to "Update calendar"
 *
 * Runs on: mobile-webkit, mobile-chromium, tablet, tablet-android.
 */

import { test, expect, Page } from '@playwright/test';
import { authenticateAndSeedSession } from './fixtures';

test.use({ serviceWorkers: 'block' });

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
    await expect(calBtn).toHaveAttribute('aria-disabled', 'true');
    expect(await calBtn.getAttribute('href')).toBeNull();

    // Reload page and verify state survives
    await page.reload();
    await page.locator('#tab-priority').click();
    await page.waitForTimeout(500);
    const cardAfterReload = page.locator('[id^="item-card-"]', { hasText: 'Geico Car Insurance Renewal' });
    await expandCard(page, cardAfterReload);

    const calBtnAfterReload = cardAfterReload.locator('[id^="add-to-calendar-"]').first();
    await expect(calBtnAfterReload).toContainText('Added to calendar');
    await expect(calBtnAfterReload).toHaveAttribute('aria-disabled', 'true');
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

    // Question disappears and button returns to "Add to calendar"
    await expect(card.locator('[role="group"][aria-label="Confirm adding to calendar"]')).toBeHidden();
    await expect(calBtn).toContainText('Add to calendar');

    // Reload shows no question and no server state
    await page.reload();
    await page.locator('#tab-priority').click();
    await page.waitForTimeout(500);
    const cardAfterReload = page.locator('[id^="item-card-"]', { hasText: 'Geico Car Insurance Renewal' });
    await expandCard(page, cardAfterReload);

    await expect(cardAfterReload.locator('[role="group"][aria-label="Confirm adding to calendar"]')).toBeHidden();
    await expect(cardAfterReload.locator('[id^="add-to-calendar-"]').first()).toContainText('Add to calendar');
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

    // Question is visible
    const confirmGroup = card.locator('[role="group"][aria-label="Confirm adding to calendar"]');
    await expect(confirmGroup).toBeVisible();

    // Reload before answering
    await page.reload();
    await page.locator('#tab-priority').click();
    await page.waitForTimeout(500);

    const cardAfterReload = page.locator('[id^="item-card-"]', { hasText: 'Geico Car Insurance Renewal' });
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

    // Tap and answer Yes
    const calBtn = card.locator('[id^="add-to-calendar-"]').first();
    await expect(calBtn).toBeVisible({ timeout: 8000 });
    await calBtn.click();

    const yesBtn = card.locator('[id^="calendar-confirm-yes-"]');
    await expect(yesBtn).toBeVisible();
    await yesBtn.click();

    await expect(calBtn).toContainText('Added to calendar');

    // Click Undo
    const undoBtn = card.locator('[id^="add-to-calendar-undo-"]');
    await expect(undoBtn).toBeVisible({ timeout: 5000 });
    await undoBtn.click();

    // Returns to "Add to calendar"
    await expect(calBtn).toContainText('Add to calendar');
    await expect(undoBtn).toBeHidden();
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
