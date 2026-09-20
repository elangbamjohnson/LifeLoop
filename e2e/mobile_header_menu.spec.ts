import { test, expect, Page } from '@playwright/test';
import { authenticateAndSeedSession } from './fixtures';
import fs from 'fs';
import path from 'path';

const VIEWPORTS = [
  { name: '390x844', width: 390, height: 844, orientation: 'portrait' },
  { name: '320x568', width: 320, height: 568, orientation: 'portrait' },
  { name: '852x393', width: 852, height: 393, orientation: 'landscape' },
  { name: '834x1194', width: 834, height: 1194, orientation: 'portrait' },
  { name: '1024x768', width: 1024, height: 768, orientation: 'landscape' },
];

async function applySafeAreas(page: Page, vp: typeof VIEWPORTS[0]) {
  if (vp.orientation === 'portrait') {
    // iPhone emulator portrait: --safe-top 59px, --safe-bottom 34px
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--safe-top', '59px');
      document.documentElement.style.setProperty('--safe-bottom', '34px');
      document.documentElement.style.setProperty('--safe-left', '0px');
      document.documentElement.style.setProperty('--safe-right', '0px');
    });
  } else if (vp.name === '852x393') {
    // iPhone emulator landscape: left and right 59px, bottom 21px
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--safe-top', '0px');
      document.documentElement.style.setProperty('--safe-bottom', '21px');
      document.documentElement.style.setProperty('--safe-left', '59px');
      document.documentElement.style.setProperty('--safe-right', '59px');
    });
  } else {
    // Standard desktop / large landscape
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--safe-top', '0px');
      document.documentElement.style.setProperty('--safe-bottom', '0px');
      document.documentElement.style.setProperty('--safe-left', '0px');
      document.documentElement.style.setProperty('--safe-right', '0px');
    });
  }
}

test.describe('Mobile Header, Profile Menu & Bottom Bar Fixes', () => {
  test.beforeAll(async () => {
    const screensDir = path.resolve(process.cwd(), 'docs/screens');
    if (!fs.existsSync(screensDir)) {
      fs.mkdirSync(screensDir, { recursive: true });
    }
  });

  for (const vp of VIEWPORTS) {
    test(`Verify layout, header, menu, and bottom bar on ${vp.name} (${vp.orientation})`, async ({
      page,
      request,
      baseURL,
    }) => {
      // 1. Authenticate as Admin and seed a capture so count badge is guaranteed to show
      const { email } = await authenticateAndSeedSession(page, request, baseURL!, { isAdmin: true });

      // Seed a capture directly
      await request.post(`${baseURL}/api/v1/captures`, {
        data: {
          type: 'text',
          rawPayload: 'Doctor appointment reminder for next Monday at 10am',
        },
      });

      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/');

      // Override safe-area variables on the page before checks
      await applySafeAreas(page, vp);
      await page.waitForSelector('#search-input');
      // Wait for items/captures to settle
      await page.waitForTimeout(500);

      const isPhone = vp.width <= 599 && vp.height >= 500;
      const headerLocator = isPhone ? page.locator('.chrome-top-bar') : page.locator('header.app-chrome');
      await expect(headerLocator).toBeVisible();

      // Check A1: Logo bounding box fully inside the viewport and inside the header
      const logoLocator = page.locator('.brand-container > div:first-child');
      await expect(logoLocator).toBeVisible();

      const logoBox = await logoLocator.boundingBox();
      const headerBox = await headerLocator.boundingBox();
      expect(logoBox).not.toBeNull();
      expect(headerBox).not.toBeNull();

      // Inside viewport
      expect(logoBox!.x).toBeGreaterThanOrEqual(0);
      expect(logoBox!.y).toBeGreaterThanOrEqual(0);
      expect(logoBox!.x + logoBox!.width).toBeLessThanOrEqual(vp.width + 1);
      expect(logoBox!.y + logoBox!.height).toBeLessThanOrEqual(vp.height + 1);

      // Inside header box (tolerance 1px for subpixel rendering)
      expect(logoBox!.x).toBeGreaterThanOrEqual(headerBox!.x - 1);
      expect(logoBox!.y).toBeGreaterThanOrEqual(headerBox!.y - 1);
      expect(logoBox!.x + logoBox!.width).toBeLessThanOrEqual(headerBox!.x + headerBox!.width + 1);
      expect(logoBox!.y + logoBox!.height).toBeLessThanOrEqual(headerBox!.y + headerBox!.height + 1);

      // Check A2: No header child extends beyond the header box
      const childrenWithinHeader = await headerLocator.evaluate((h, isPhoneMode) => {
        const hRect = h.getBoundingClientRect();
        const allChildren = Array.from(h.querySelectorAll('*')).filter((el) => {
          const s = window.getComputedStyle(el);
          return (
            s.display !== 'none' &&
            s.visibility !== 'hidden' &&
            s.position !== 'fixed' &&
            !el.closest('#profile-popover') &&
            !el.closest('#more-sheet-wrapper')
          );
        });

        return allChildren.every((c) => {
          const r = c.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return true;
          if (isPhoneMode) {
            return (
              r.top >= hRect.top - 1.5 &&
              r.bottom <= hRect.bottom + 1.5 &&
              r.left >= hRect.left - 1.5 &&
              r.right <= hRect.right + 1.5
            );
          } else {
            return r.left >= hRect.left - 1.5 && r.right <= hRect.right + 1.5;
          }
        });
      }, isPhone);
      expect(childrenWithinHeader).toBe(true);

      // Check A3: Gap between the header and the search field <= 24px on phones
      if (isPhone) {
        const searchInput = page.locator('#search-input');
        await expect(searchInput).toBeVisible();
        const searchBox = await searchInput.boundingBox();
        expect(searchBox).not.toBeNull();
        const gap = searchBox!.y - (headerBox!.y + headerBox!.height);
        expect(gap).toBeGreaterThanOrEqual(0);
        expect(gap).toBeLessThanOrEqual(24);
      }

      // Save screenshot for default state
      await page.screenshot({ path: `docs/screens/${vp.name}-default.png` });

      // Check B: Open the profile menu
      const profileBtn = page.locator('#user-profile-menu-btn');
      await expect(profileBtn).toBeVisible();
      await profileBtn.click();

      const profilePopover = page.locator('#profile-popover');
      await expect(profilePopover).toBeVisible();

      // B1: Its bounding box is fully inside the viewport with an 8px margin
      const popoverBox = await profilePopover.boundingBox();
      expect(popoverBox).not.toBeNull();
      expect(popoverBox!.x).toBeGreaterThanOrEqual(7.5);
      expect(popoverBox!.y).toBeGreaterThanOrEqual(7.5);
      expect(popoverBox!.x + popoverBox!.width).toBeLessThanOrEqual(vp.width - 7.5);
      expect(popoverBox!.y + popoverBox!.height).toBeLessThanOrEqual(vp.height - 7.5);

      // B2: elementFromPoint at its center returns the menu
      const centerIsMenu = await page.evaluate(() => {
        const menu = document.querySelector('#profile-popover');
        if (!menu) return false;
        const rect = menu.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const target = document.elementFromPoint(cx, cy);
        return target !== null && menu.contains(target);
      });
      expect(centerIsMenu).toBe(true);

      // Save screenshot for menu open state
      await page.screenshot({ path: `docs/screens/${vp.name}-menu-open.png` });

      // B3: Keyboard Esc closes menu and returns focus
      await page.keyboard.press('Escape');
      await expect(profilePopover).toBeHidden();
      await expect(profileBtn).toBeFocused();

      // Check C: Bottom bar items label tops within 1px of each other with badge showing
      if (isPhone) {
        // Ensure captures badge is visible
        const badgeLocator = page.locator('#tab-captures .rounded-full');
        await expect(badgeLocator).toBeVisible();

        // Check the 5 bottom-bar items: Priority, Timeline, Inbox, Ask, More
        const bottomBarTabs = ['tab-priority', 'tab-timeline', 'tab-captures', 'tab-ask', 'tab-more'];
        const labelTops = await page.evaluate((tabIds) => {
          return tabIds.map((id) => {
            const btn = document.getElementById(id);
            if (!btn) return null;
            // The label is the span text child
            const label = btn.querySelector('span:not(.rounded-full)');
            return label ? label.getBoundingClientRect().top : null;
          });
        }, bottomBarTabs);

        // Every tab must exist
        expect(labelTops.every((t) => t !== null)).toBe(true);

        const validTops = labelTops as number[];
        const minTop = Math.min(...validTops);
        const maxTop = Math.max(...validTops);
        const diff = maxTop - minTop;
        expect(diff).toBeLessThanOrEqual(1);
      }
    });
  }
});
