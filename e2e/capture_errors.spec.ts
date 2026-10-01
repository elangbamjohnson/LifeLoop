import { test, expect } from '@playwright/test';
import { authenticateAndSeedSession } from './fixtures';

test.use({ serviceWorkers: 'block' });

test.describe('Capture Dialog Error Handling (POST /api/v1/captures)', () => {
  test.beforeEach(async ({ page, request, baseURL }) => {
    await authenticateAndSeedSession(page, request, baseURL!, { isAdmin: true });
  });

  test('dialog stays open and keeps text on 403, 500, and network error, then closes on success', async ({ page }) => {
    let mode: '403' | '500' | 'abort' | 'success' = '403';
    const noteText = 'Playwright capture test notes that must be preserved';

    await page.route('**/api/v1/captures', (route) => {
      if (route.request().method() !== 'POST') {
        return route.continue();
      }
      if (mode === '403') {
        return route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Please verify your email address to access this resource' }),
        });
      }
      if (mode === '500') {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Database syntax error: table not found at node_modules...' }),
        });
      }
      if (mode === 'abort') {
        return route.abort('failed');
      }
      if (mode === 'success') {
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            capture: {
              id: 'cap_test_e2e_success',
              type: 'text',
              rawPayload: noteText,
              status: 'pending',
              createdAt: new Date().toISOString(),
            },
          }),
        });
      }
      return route.continue();
    });

    await page.goto('/');
    await page.waitForSelector('main', { state: 'visible' });

    // Open Capture Dialog
    const captureBtn = page.locator('#global-capture-btn');
    await expect(captureBtn).toBeVisible({ timeout: 10000 });
    await captureBtn.click();

    const captureDialog = page.locator('#capture-dialog');
    await expect(captureDialog).toBeVisible({ timeout: 5000 });

    const textarea = captureDialog.locator('textarea');
    await textarea.fill(noteText);
    await expect(textarea).toHaveValue(noteText);

    const saveBtn = captureDialog.locator('button[type="submit"]');
    const alertLocator = captureDialog.locator('[role="alert"]');

    // 1. Simulating 403 Forbidden
    mode = '403';
    await saveBtn.click();

    // Assert dialog stays open, text is still there, and error alert is visible
    await expect(captureDialog).toBeVisible();
    await expect(textarea).toHaveValue(noteText);
    await expect(alertLocator).toBeVisible({ timeout: 5000 });
    await expect(alertLocator).toContainText('Please verify your email address to access this resource');
    await expect(saveBtn).toBeEnabled();

    // 2. Simulating 500 Internal Server Error
    mode = '500';
    await saveBtn.click();

    // Assert dialog stays open, text is still there, and safe 5xx message is visible (never leaking server text)
    await expect(captureDialog).toBeVisible();
    await expect(textarea).toHaveValue(noteText);
    await expect(alertLocator).toBeVisible({ timeout: 5000 });
    await expect(alertLocator).toContainText(
      'Something went wrong on our side. Your note is still here, please try again.'
    );
    await expect(alertLocator).not.toContainText('Database syntax error');
    await expect(saveBtn).toBeEnabled();

    // 3. Simulating Network Failure (request abort)
    mode = 'abort';
    await saveBtn.click();

    // Assert dialog stays open, text is still there, and network error message is visible
    await expect(captureDialog).toBeVisible();
    await expect(textarea).toHaveValue(noteText);
    await expect(alertLocator).toBeVisible({ timeout: 5000 });
    await expect(alertLocator).toContainText(
      "Couldn't reach the server. Check your connection and try again."
    );
    await expect(saveBtn).toBeEnabled();

    // 4. Successful Submission
    mode = 'success';
    await saveBtn.click();

    // Assert dialog successfully closes
    await expect(captureDialog).toBeHidden({ timeout: 10000 });
  });

  test('preferences modal stays open on PUT error, shows error with role="alert", and closes on success', async ({
    page,
  }) => {
    let prefMode: '500' | 'success' = '500';

    await page.route('**/api/v1/reminders/preferences', (route) => {
      if (route.request().method() !== 'PUT') {
        return route.continue();
      }
      if (prefMode === '500') {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Internal Server Error' }),
        });
      }
      if (prefMode === 'success') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
      }
      return route.continue();
    });

    await page.goto('/');
    await page.waitForSelector('main', { state: 'visible' });

    // Open profile preferences
    const profileBtn = page.locator('#user-profile-menu-btn');
    await expect(profileBtn).toBeVisible({ timeout: 10000 });
    await profileBtn.click();

    const prefsBtn = page.locator('#profile-preferences-btn');
    await expect(prefsBtn).toBeVisible({ timeout: 5000 });
    await prefsBtn.click();

    const prefsCard = page.locator('#preferences-modal-card');
    await expect(prefsCard).toBeVisible({ timeout: 5000 });

    const saveBtn = page.locator('#preferences-save-btn');
    const alertLocator = prefsCard.locator('[role="alert"]');

    // 1. Trigger failure
    prefMode = '500';
    await saveBtn.click();

    // Assert modal stays open and error alert is shown
    await expect(prefsCard).toBeVisible();
    await expect(alertLocator).toBeVisible({ timeout: 5000 });
    await expect(alertLocator).toContainText(
      'Something went wrong on our side. Your changes are still here, please try again.'
    );
    await expect(alertLocator).not.toContainText('note');
    await expect(saveBtn).toBeEnabled();

    // 2. Toggling setting clears error alert
    const autoRemindersRow = page.locator('#auto-reminders-row');
    await autoRemindersRow.click();
    await expect(alertLocator).toBeHidden();

    // 3. Trigger success
    prefMode = 'success';
    await saveBtn.click();

    // Assert modal closes
    await expect(prefsCard).toBeHidden({ timeout: 10000 });
  });
});
