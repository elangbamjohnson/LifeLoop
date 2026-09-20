import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { authenticateAndSeedSession } from './fixtures';

const testViewports = [
  { name: 'Phone Portrait', width: 390, height: 844, isPhone: true },
  { name: 'Tablet Portrait', width: 834, height: 1194, isPhone: false },
  { name: 'Desktop/Landscape', width: 1024, height: 768, isPhone: false },
];

test.describe('Admin vs Non-Admin Navigation Matrix', () => {
  for (const vp of testViewports) {
    test.describe(`${vp.name} (${vp.width}x${vp.height})`, () => {
      test(`Non-Admin: Displays exactly 4 tabs directly without More button, meets touch targets, and passes Axe scan`, async ({
        page,
        request,
        baseURL,
      }) => {
        await authenticateAndSeedSession(page, request, baseURL!, { isAdmin: false });
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto('/');
        await page.waitForSelector('main', { state: 'visible' });

        // 1. Verify 4 visible destinations
        const visibleTabs = ['tab-priority', 'tab-timeline', 'tab-captures', 'tab-family'];
        for (const id of visibleTabs) {
          const tab = page.locator(`#${id}`);
          await expect(tab).toBeVisible();
          const box = await tab.boundingBox();
          expect(box, `Tab #${id} must have bounding box`).not.toBeNull();
          expect(box!.width, `Tab #${id} width >= 48px`).toBeGreaterThanOrEqual(47.5);
          expect(box!.height, `Tab #${id} height >= 48px`).toBeGreaterThanOrEqual(47.5);
        }

        // 2. Verify admin-only tabs and More button are NOT present
        await expect(page.locator('#tab-ask')).toBeHidden();
        await expect(page.locator('#tab-graph')).toBeHidden();
        await expect(page.locator('#tab-more')).toBeHidden();
        await expect(page.locator('#more-sheet-wrapper')).toBeHidden();

        // 3. Roving tabindex navigation across the 4 destinations
        const firstTab = page.locator('#tab-priority');
        await firstTab.focus();
        await expect(firstTab).toBeFocused();

        // ArrowRight -> Timeline
        await page.keyboard.press('ArrowRight');
        await expect(page.locator('#tab-timeline')).toBeFocused();

        // ArrowRight -> Captures/Inbox
        await page.keyboard.press('ArrowRight');
        await expect(page.locator('#tab-captures')).toBeFocused();

        // ArrowRight -> Family
        await page.keyboard.press('ArrowRight');
        await expect(page.locator('#tab-family')).toBeFocused();

        // ArrowRight -> wraps back to Priority
        await page.keyboard.press('ArrowRight');
        await expect(page.locator('#tab-priority')).toBeFocused();

        // ArrowLeft -> wraps to Family
        await page.keyboard.press('ArrowLeft');
        await expect(page.locator('#tab-family')).toBeFocused();

        // 4. Accessibility Scan (Axe) of non-admin navigation
        const axeResults = await new AxeBuilder({ page }).include('header.app-chrome').analyze();
        const seriousOrCritical = axeResults.violations.filter(
          (v) => v.impact === 'serious' || v.impact === 'critical'
        );
        expect(
          seriousOrCritical,
          `Non-admin navigation has serious/critical axe violations: ${JSON.stringify(
            seriousOrCritical.map((v) => ({ id: v.id, impact: v.impact, description: v.description }))
          )}`
        ).toEqual([]);
      });

      test(`Admin: Displays 6 destinations (with More button on phone, inline on tablet/desktop), meets touch targets`, async ({
        page,
        request,
        baseURL,
      }) => {
        await authenticateAndSeedSession(page, request, baseURL!, { isAdmin: true });
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto('/');
        await page.waitForSelector('main', { state: 'visible' });

        if (vp.isPhone) {
          // Phone: 4 tabs + More button in bottom bar
          const phoneBottomTabs = ['tab-priority', 'tab-timeline', 'tab-captures', 'tab-ask', 'tab-more'];
          for (const id of phoneBottomTabs) {
            const tab = page.locator(`#${id}`);
            await expect(tab).toBeVisible();
            const box = await tab.boundingBox();
            expect(box).not.toBeNull();
            expect(box!.width).toBeGreaterThanOrEqual(47.5);
            expect(box!.height).toBeGreaterThanOrEqual(47.5);
          }

          // Open More sheet to access Graph and Family
          const moreBtn = page.locator('#tab-more');
          await moreBtn.click();
          await page.waitForSelector('#more-sheet-wrapper.sheet-open', { state: 'visible' });

          const sheetTabs = ['tab-graph', 'tab-family'];
          for (const id of sheetTabs) {
            const tab = page.locator(`#${id}`);
            await expect(tab).toBeVisible();
            const box = await tab.boundingBox();
            expect(box).not.toBeNull();
            expect(box!.width).toBeGreaterThanOrEqual(47.5);
            expect(box!.height).toBeGreaterThanOrEqual(47.5);
          }

          // Close sheet
          await page.keyboard.press('Escape');
          await expect(page.locator('#more-sheet-wrapper')).toBeHidden();
        } else {
          // Tablet/Desktop: all 6 destinations visible inline in rail/sidebar
          const allTabs = ['tab-priority', 'tab-timeline', 'tab-captures', 'tab-ask', 'tab-graph', 'tab-family'];
          for (const id of allTabs) {
            const tab = page.locator(`#${id}`);
            await expect(tab).toBeVisible();
            const box = await tab.boundingBox();
            expect(box).not.toBeNull();
            expect(box!.width).toBeGreaterThanOrEqual(47.5);
            expect(box!.height).toBeGreaterThanOrEqual(47.5);
          }

          // More button is hidden on tablet/desktop
          await expect(page.locator('#tab-more')).toBeHidden();

          // Roving tabindex across all 6 destinations
          const firstTab = page.locator('#tab-priority');
          await firstTab.focus();
          await expect(firstTab).toBeFocused();

          await page.keyboard.press('ArrowDown');
          await expect(page.locator('#tab-timeline')).toBeFocused();

          await page.keyboard.press('ArrowDown');
          await expect(page.locator('#tab-captures')).toBeFocused();

          await page.keyboard.press('ArrowDown');
          await expect(page.locator('#tab-ask')).toBeFocused();

          await page.keyboard.press('ArrowDown');
          await expect(page.locator('#tab-graph')).toBeFocused();

          await page.keyboard.press('ArrowDown');
          await expect(page.locator('#tab-family')).toBeFocused();

          // Wraps back to Priority
          await page.keyboard.press('ArrowDown');
          await expect(page.locator('#tab-priority')).toBeFocused();
        }
      });
    });
  }

  test('Fallback: Non-admin fails closed to priority and never displays Ask/Graph panels', async ({
    page,
    request,
    baseURL,
  }) => {
    await authenticateAndSeedSession(page, request, baseURL!, { isAdmin: false });
    await page.goto('/');
    await page.waitForSelector('main', { state: 'visible' });

    // Ensure priority tab is selected by default
    await expect(page.locator('#tab-priority')).toHaveAttribute('aria-selected', 'true');

    // Verify Ask & Graph tabpanels are never rendered for non-admin
    await expect(page.locator('#panel-ask')).not.toBeAttached();
    await expect(page.locator('#panel-graph')).not.toBeAttached();
  });
});
