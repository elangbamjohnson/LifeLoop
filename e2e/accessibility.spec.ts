import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { authenticateAndSeedSession } from './fixtures';

const viewports = [
  { name: 'Portrait', width: 390, height: 844 },
  { name: 'Tablet', width: 834, height: 1194 },
  { name: 'Landscape', width: 852, height: 393 },
];

const themes = ['light', 'dark'] as const;

async function setTheme(page: any, theme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: theme });
  await page.evaluate((t: string) => {
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(t);
    localStorage.setItem('lifeloop-theme', t);
  }, theme);
}

test.describe('Accessibility Scans (@axe-core/playwright)', () => {
  test.beforeEach(async ({ page, request, baseURL }) => {
    await authenticateAndSeedSession(page, request, baseURL!);
  });

  for (const vp of viewports) {
    for (const theme of themes) {
      test(`Axe scan across 6 states on ${vp.name} (${vp.width}x${vp.height}) in ${theme} mode`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto('/');
        await page.waitForSelector('main', { state: 'visible' });
        await setTheme(page, theme);
        await page.waitForTimeout(200);

        // State 1: Shell
        const shellResults = await new AxeBuilder({ page }).analyze();
        const shellSerious = shellResults.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
        console.log(`[AXE] ${vp.name} (${theme}) Shell violations - serious/critical: ${shellSerious.length}, moderate: ${shellResults.violations.filter(v => v.impact === 'moderate').length}, minor: ${shellResults.violations.filter(v => v.impact === 'minor').length}`);
        expect(shellSerious, `Shell has serious/critical violations: ${JSON.stringify(shellSerious.map(v => ({ id: v.id, impact: v.impact, description: v.description })))}`).toEqual([]);

        // State 2: Card Expanded
        const firstCard = page.locator('[id^="item-card-"]').first();
        await expect(firstCard).toBeVisible();
        const expandBtn = firstCard.locator('[aria-label="Expand"], [aria-label="Collapse"]').first();
        if (await expandBtn.count() > 0) {
          await expandBtn.click();
        } else {
          await firstCard.click({ position: { x: 20, y: 20 } });
        }
        await page.waitForTimeout(200);

        const cardResults = await new AxeBuilder({ page }).analyze();
        const cardSerious = cardResults.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
        console.log(`[AXE] ${vp.name} (${theme}) Card Expanded violations - serious/critical: ${cardSerious.length}, moderate: ${cardResults.violations.filter(v => v.impact === 'moderate').length}, minor: ${cardResults.violations.filter(v => v.impact === 'minor').length}`);
        expect(cardSerious, `Card Expanded has serious/critical violations: ${JSON.stringify(cardSerious.map(v => ({ id: v.id, impact: v.impact, description: v.description })))}`).toEqual([]);

        // Collapse card back
        if (await expandBtn.count() > 0) {
          await expandBtn.click();
        } else {
          await firstCard.click({ position: { x: 20, y: 20 } });
        }
        await page.waitForTimeout(100);

        // State 3: PreferencesModal
        const prefsBtn = page.locator('#reminder-preferences-btn');
        await prefsBtn.click();
        await page.waitForSelector('#preferences-modal-card', { state: 'visible' });
        await page.waitForTimeout(200);

        const prefsResults = await new AxeBuilder({ page }).analyze();
        const prefsSerious = prefsResults.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
        console.log(`[AXE] ${vp.name} (${theme}) PreferencesModal violations - serious/critical: ${prefsSerious.length}, moderate: ${prefsResults.violations.filter(v => v.impact === 'moderate').length}, minor: ${prefsResults.violations.filter(v => v.impact === 'minor').length}`);
        expect(prefsSerious, `PreferencesModal has serious/critical violations: ${JSON.stringify(prefsSerious.map(v => ({ id: v.id, impact: v.impact, description: v.description })))}`).toEqual([]);

        // Close PreferencesModal
        await page.keyboard.press('Escape');
        await page.waitForSelector('#preferences-modal-card', { state: 'hidden' });
        await page.waitForTimeout(100);

        // State 4: CaptureDialog
        const captureBtn = page.locator('#global-capture-btn');
        if (await captureBtn.isVisible()) {
          await captureBtn.click();
          await page.waitForSelector('#capture-dialog', { state: 'visible' });
          await page.waitForTimeout(200);

          const captureResults = await new AxeBuilder({ page }).analyze();
          const captureSerious = captureResults.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
          console.log(`[AXE] ${vp.name} (${theme}) CaptureDialog violations - serious/critical: ${captureSerious.length}, moderate: ${captureResults.violations.filter(v => v.impact === 'moderate').length}, minor: ${captureResults.violations.filter(v => v.impact === 'minor').length}`);
          expect(captureSerious, `CaptureDialog has serious/critical violations: ${JSON.stringify(captureSerious.map(v => ({ id: v.id, impact: v.impact, description: v.description })))}`).toEqual([]);

          // Close CaptureDialog
          await page.keyboard.press('Escape');
          await page.waitForSelector('#capture-dialog', { state: 'hidden' });
          await page.waitForTimeout(100);
        }

        // State 5: More sheet (only in phone layout under 600px where More button exists)
        const moreBtn = page.locator('#tab-more');
        if (await moreBtn.isVisible()) {
          await moreBtn.click();
          await page.waitForSelector('#more-sheet-wrapper.sheet-open', { state: 'visible' });
          await page.waitForTimeout(200);

          const moreResults = await new AxeBuilder({ page }).analyze();
          const moreSerious = moreResults.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
          console.log(`[AXE] ${vp.name} (${theme}) More sheet violations - serious/critical: ${moreSerious.length}, moderate: ${moreResults.violations.filter(v => v.impact === 'moderate').length}, minor: ${moreResults.violations.filter(v => v.impact === 'minor').length}`);
          expect(moreSerious, `More sheet has serious/critical violations: ${JSON.stringify(moreSerious.map(v => ({ id: v.id, impact: v.impact, description: v.description })))}`).toEqual([]);

          // Close More sheet
          await page.keyboard.press('Escape');
          await page.waitForTimeout(100);
        }

        // State 6: ConfirmDialog
        const deleteBtn = page.locator('[id^="delete-item-"]').first();
        if (await deleteBtn.isVisible()) {
          await deleteBtn.click();
          await page.waitForSelector('#confirm-dialog', { state: 'visible' });
          await page.waitForTimeout(200);

          const confirmResults = await new AxeBuilder({ page }).analyze();
          const confirmSerious = confirmResults.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
          console.log(`[AXE] ${vp.name} (${theme}) ConfirmDialog violations - serious/critical: ${confirmSerious.length}, moderate: ${confirmResults.violations.filter(v => v.impact === 'moderate').length}, minor: ${confirmResults.violations.filter(v => v.impact === 'minor').length}`);
          expect(confirmSerious, `ConfirmDialog has serious/critical violations: ${JSON.stringify(confirmSerious.map(v => ({ id: v.id, impact: v.impact, description: v.description })))}`).toEqual([]);

          // Cancel ConfirmDialog
          await page.keyboard.press('Escape');
          await page.waitForSelector('#confirm-dialog', { state: 'hidden' });
          await page.waitForTimeout(100);
        }
      });
    }
  }

  test('Root font-size 200% at 390x844: no horizontal overflow and all nav labels visible', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.waitForSelector('main', { state: 'visible' });

    // Set root font size to 200%
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    await page.waitForTimeout(300);

    // Verify no horizontal overflow
    const overflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    expect(overflow).toBe(false);

    // Verify all mobile bottom bar nav labels are visible
    const navItems = ['tab-priority', 'tab-timeline', 'tab-captures', 'tab-ask', 'tab-more'];
    for (const id of navItems) {
      const tab = page.locator(`#${id}`);
      await expect(tab).toBeVisible();
      const label = tab.locator('span');
      await expect(label).toBeVisible();
      const box = await label.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeGreaterThan(0);
      expect(box!.height).toBeGreaterThan(0);
    }
  });

  test('Prefers-reduced-motion: animations/transitions disabled and scroll-behavior auto', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.waitForSelector('main', { state: 'visible' });

    // Verify nav transition duration is effectively 0
    const navTransition = await page.locator('.chrome-tab-item').first().evaluate((el) => {
      return window.getComputedStyle(el).transitionDuration;
    });
    expect(parseFloat(navTransition) <= 0.01).toBe(true);

    // Verify scroll-behavior is auto
    const scrollBehavior = await page.evaluate(() => {
      return window.getComputedStyle(document.documentElement).scrollBehavior;
    });
    expect(scrollBehavior).toBe('auto');
  });

  test('Visible focus ring on every nav item', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.waitForSelector('main', { state: 'visible' });

    const navItems = ['tab-priority', 'tab-timeline', 'tab-captures', 'tab-ask', 'tab-more'];
    for (const id of navItems) {
      const tab = page.locator(`#${id}`);
      await tab.focus();
      const isFocused = await tab.evaluate((el) => document.activeElement === el);
      expect(isFocused).toBe(true);
      const outline = await tab.evaluate((el) => window.getComputedStyle(el).outlineStyle);
      expect(outline).not.toBe('none');
    }
  });

  test('Focus returns to the trigger on close for More sheet, PreferencesModal, CaptureDialog, ConfirmDialog', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.waitForSelector('main', { state: 'visible' });

    // 1. More sheet: focus returns to #tab-more
    const moreBtn = page.locator('#tab-more');
    await moreBtn.focus();
    await moreBtn.press('Enter');
    await page.waitForSelector('#more-sheet-wrapper.sheet-open', { state: 'visible' });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    const moreFocused = await moreBtn.evaluate((el) => document.activeElement === el);
    expect(moreFocused).toBe(true);

    // 2. PreferencesModal: focus returns to #reminder-preferences-btn
    const prefsBtn = page.locator('#reminder-preferences-btn');
    await prefsBtn.focus();
    await prefsBtn.press('Enter');
    await page.waitForSelector('#preferences-modal-card', { state: 'visible' });
    await page.keyboard.press('Escape');
    await page.waitForSelector('#preferences-modal-card', { state: 'hidden' });
    await page.waitForTimeout(100);
    const prefsFocused = await prefsBtn.evaluate((el) => document.activeElement === el);
    expect(prefsFocused).toBe(true);

    // 3. CaptureDialog: focus returns to #global-capture-btn
    const captureBtn = page.locator('#global-capture-btn');
    await captureBtn.focus();
    await captureBtn.press('Enter');
    await page.waitForSelector('#capture-dialog', { state: 'visible' });
    await page.keyboard.press('Escape');
    await page.waitForSelector('#capture-dialog', { state: 'hidden' });
    await page.waitForTimeout(100);
    const captureFocused = await captureBtn.evaluate((el) => document.activeElement === el);
    expect(captureFocused).toBe(true);

    // 4. ConfirmDialog: focus returns to delete trigger button
    const firstCard = page.locator('[id^="item-card-"]').first();
    const expandBtn = firstCard.locator('[aria-label="Expand"], [aria-label="Collapse"]').first();
    if (await expandBtn.count() > 0) {
      await expandBtn.click();
      await page.waitForTimeout(200);
    }
    const deleteBtn = page.locator('[id^="delete-item-"]').first();
    await deleteBtn.focus();
    await deleteBtn.press('Enter');
    await page.waitForSelector('#confirm-dialog', { state: 'visible' });
    await page.keyboard.press('Escape');
    await page.waitForSelector('#confirm-dialog', { state: 'hidden' });
    await page.waitForTimeout(100);
    const deleteFocused = await deleteBtn.evaluate((el) => document.activeElement === el);
    expect(deleteFocused).toBe(true);
  });
});
