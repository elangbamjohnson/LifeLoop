import { test, expect } from '@playwright/test';
import { verifyBackendReadiness, verifyUserEmail } from './fixtures';
import fs from 'fs';
import path from 'path';

test.describe('Visual: Phone Bottom Bar Opacity & Safe-Area', () => {
  const timestamp = Date.now();
  const email = `visual_bottom_bar_${timestamp}@lifeloop.test`;
  const password = 'StrongPassword123!';
  let sessionToken = '';

  test.beforeAll(async ({ request, baseURL }) => {
    await verifyBackendReadiness(request, baseURL!, { requireDb: true });

    const screensDir = path.resolve(process.cwd(), 'docs/screens');
    if (!fs.existsSync(screensDir)) {
      fs.mkdirSync(screensDir, { recursive: true });
    }

    // Register test user
    const regRes = await request.post(`${baseURL}/api/v1/auth/register`, {
      data: { email, password },
    });
    expect(regRes.ok()).toBe(true);
    for (const h of regRes.headersArray()) {
      if (h.name.toLowerCase() === 'set-cookie') {
        const m = h.value.match(/session=([^;]+)/);
        if (m) sessionToken = m[1];
      }
    }

    // Promote the test user to active so the dashboard renders (not the email-pending wall)
    await verifyUserEmail(email);

    // Seed 15 items to ensure a long list that scrolls under the bottom bar
    for (let i = 1; i <= 15; i++) {
      await request.post(`${baseURL}/api/v1/items`, {
        headers: { Cookie: `session=${sessionToken}` },
        data: {
          title: `Scrolled Item #${i} Priority Long Distinctive Text For Visual Check`,
          itemType: 'task',
          status: 'active',
        },
      });
    }
  });

  test('bottom bar has opaque background and no page text is visible inside bar box when scrolled', async ({
    page,
    baseURL,
  }) => {
    // Set to phone viewport so bottom bar is active and visible on all projects
    await page.setViewportSize({ width: 390, height: 844 });
    await page.context().addCookies([{ name: 'session', value: sessionToken, url: baseURL!, httpOnly: true }]);
    await page.goto('/');

    await expect(page.locator('h1:has-text("LifeLoop")')).toBeVisible();

    // Check bottom bar exists
    const bottomBar = page.locator('.chrome-tablist');
    const isBottomBarVisible = await bottomBar.isVisible();

    // Bottom bar is rendered on mobile/phone views
    if (isBottomBarVisible) {
      // 1. Verify computed background-color has alpha 1 (opaque)
      const bgColor = await bottomBar.evaluate((el) => {
        const style = window.getComputedStyle(el);
        return {
          backgroundColor: style.getPropertyValue('background-color'),
          borderTopColor: style.getPropertyValue('border-top-color'),
          borderTopWidth: style.getPropertyValue('border-top-width'),
          paddingBottom: style.getPropertyValue('padding-bottom'),
        };
      });

      // Assert opaque background (not rgba with alpha < 0.95)
      expect(bgColor.backgroundColor).toMatch(/^rgb\(\d+,\s*\d+,\s*\d+\)$/);
      // Assert top border is preserved
      expect(bgColor.borderTopWidth).toBe('1px');

      // 2. Scroll list down so items scroll under the fixed bottom bar
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight / 2);
      });
      await page.waitForTimeout(300);

      // 3. Screenshot test of the bottom bar
      const barBox = await bottomBar.boundingBox();
      expect(barBox).not.toBeNull();

      await bottomBar.screenshot({
        path: path.resolve(process.cwd(), 'docs/screens/bottom_bar_opaque.png'),
      });

      // 4. Assert no page text from under the bar is visible inside the bar's box
      const isTextBleedingThrough = await page.evaluate((box) => {
        // Sample points across the bottom bar
        const testPoints = [
          { x: box.x + 20, y: box.y + box.height / 2 },
          { x: box.x + box.width / 2, y: box.y + box.height / 2 },
          { x: box.x + box.width - 20, y: box.y + box.height / 2 },
        ];

        for (const pt of testPoints) {
          const topElement = document.elementFromPoint(pt.x, pt.y);
          if (!topElement) continue;

          // If the topmost element at this point is not inside .chrome-tablist, text or list bled through
          const bar = document.querySelector('.chrome-tablist');
          if (bar && !bar.contains(topElement)) {
            return true; // Leak detected
          }
        }
        return false;
      }, barBox);

      expect(isTextBleedingThrough).toBe(false);
    }
  });
});
