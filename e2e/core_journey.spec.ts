import { test, expect } from '@playwright/test';
import { verifyBackendReadiness, navigateToTab, promoteUserToAdmin } from './fixtures';

test.describe('LifeLoop End-to-End User Journeys', () => {
  const timestamp = Date.now();
  const userAEmail = `e2e_user_a_${timestamp}@lifeloop.test`;
  const userBEmail = `e2e_user_b_${timestamp}@lifeloop.test`;
  const password = 'StrongPassword123!';

  test.beforeEach(async ({ request, baseURL }) => {
    await verifyBackendReadiness(request, baseURL!, { requireDb: true });
  });

  test('1. Authentication Failure: Reject invalid password with clear feedback', async ({ page }) => {
    await page.goto('/auth');

    // Attempt login with non-existent / invalid credentials
    await page.fill('input[placeholder="you@example.com"]', 'nonexistent@lifeloop.test');
    await page.fill('input[placeholder="••••••••"]', 'WrongPassword123!');
    await page.click('button:has-text("Sign In")');

    // Verify error message displayed safely without crashing
    const errorMsg = page.locator('p.text-red-500');
    await expect(errorMsg).toBeVisible();
    await expect(errorMsg).toContainText(/Invalid credentials|Authentication failed/);
  });

  test('2. Core Journey: Register -> Capture -> AI Process -> Confirm -> Timeline -> Ask -> Family', async ({ page }, testInfo) => {
    // 1. REGISTER USER_A
    await page.goto('/auth');
    await page.click('button:has-text("Need an account? Register")');
    await expect(page.locator('button:has-text("Create Account")')).toBeVisible();

    await page.fill('input[placeholder="you@example.com"]', userAEmail);
    await page.fill('input[placeholder="••••••••"]', password);
    await page.click('button:has-text("Create Account")');

    // Verify redirected to Dashboard
    await expect(page).toHaveURL('/');
    // Promote User A to admin to test Ask features
    await promoteUserToAdmin(userAEmail);
    await page.reload();
    await expect(page.locator('h1:has-text("LifeLoop")')).toBeVisible();

    // 2. CREATE TEXT CAPTURE (Wait-for & Insurance)
    await page.click('#global-capture-btn');
    const textarea = page.locator('textarea[placeholder*="What\'s on your mind?"]');
    await expect(textarea).toBeVisible();

    await textarea.fill('Waiting on AutoZone for $120 refund on car battery');
    await page.click('button:has-text("Save to LifeLoop")');

    // 3. HOME TAB & CONFIRM AI EXTRACTION
    await page.click('#tab-priority');
    const autoZoneCard = page.locator('text=AutoZone').first();
    await autoZoneCard.waitFor({ state: 'visible', timeout: 10000 });
    const confirmBtn = page.locator('button:has-text("Confirm")').first();
    if (await confirmBtn.isVisible()) {
      await confirmBtn.click();
      await page.waitForTimeout(500);
    }

    // 4. TIMELINE TAB
    await page.click('#tab-timeline');
    const ariaSelected = await page.locator('#tab-timeline').getAttribute('aria-selected');
    console.log(`[Timeline Tab] #tab-timeline aria-selected right after click: "${ariaSelected}"`);
    await page.screenshot({ path: `test-results/timeline-tab-clicked-${testInfo.project.name}.png` });
    await expect(page.getByRole('heading', { level: 3, name: 'AutoZone' })).toBeVisible({ timeout: 5000 });

    // 5. ASK MY LIFE
    await page.click('#tab-ask');
    const askInput = page.locator('input[placeholder*="Ask about bills"]');
    await expect(askInput).toBeVisible();

    await askInput.fill('When is my AutoZone refund coming?');
    await page.click('button[type="submit"]');

    // Expect AI answer mentioning AutoZone
    await expect(page.locator('text=AutoZone').first()).toBeVisible({ timeout: 10000 });

    // 6. FAMILY SHARING
    await navigateToTab(page, 'family');
    
    // Check if empty state or existing family
    const createFamilyBtn = page.locator('button:has-text("Create a Family")');
    if (await createFamilyBtn.isVisible()) {
      await createFamilyBtn.click();
      await page.fill('input[placeholder*="The Johnsons"]', 'The LifeLoop Alpha Family');
      await page.click('button:has-text("Create Family")');
      await expect(page.locator('text=The LifeLoop Alpha Family')).toBeVisible();
    } else {
      await expect(page.locator('text=Members')).toBeVisible();
    }
  });

  test('3. Security Boundary: Private items remain isolated from non-members', async ({ page, request }) => {
    // Register User B in new browser context
    await page.goto('/auth');
    await page.click('button:has-text("Need an account? Register")');
    await page.fill('input[placeholder="you@example.com"]', userBEmail);
    await page.fill('input[placeholder="••••••••"]', password);
    await page.click('button:has-text("Create Account")');

    await expect(page).toHaveURL('/');
    // Promote User B to admin to test Ask boundary
    await promoteUserToAdmin(userBEmail);
    await page.reload();

    // Verify User B's dashboard does not contain User A's private items
    await page.click('#tab-timeline');
    await expect(page.locator('text=AutoZone')).not.toBeVisible();

    // User B attempts Ask My Life for User A's data
    await page.click('#tab-ask');
    const askInput = page.locator('input[placeholder*="Ask about bills"]');
    await expect(askInput).toBeVisible();
    await askInput.fill('What refund am I waiting for?');
    await page.click('button[type="submit"]');

    // Must return fallback message and NOT leak User A's AutoZone refund
    await expect(page.locator('text=AutoZone')).not.toBeVisible();
    await expect(page.locator('text=couldn\'t find that in your LifeLoop')).toBeVisible({ timeout: 10000 });
  });

  test('4. Resiliency & Failure State: Graceful handling of backend API errors', async ({ page }) => {
    // Intercept /api/v1/captures to simulate server failure
    await page.route('**/api/v1/captures', route => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { message: 'Internal Server Error' } }),
      });
    });

    await page.goto('/auth');
    await page.fill('input[placeholder="you@example.com"]', userAEmail);
    await page.fill('input[placeholder="••••••••"]', password);
    await page.click('button:has-text("Sign In")');

    // Page must remain functional and not blank/crash
    await expect(page.locator('h1:has-text("LifeLoop")')).toBeVisible();
  });
});
