import { test, expect, Page } from '@playwright/test';
import { authenticateAndSeedSession } from './fixtures';

const testWidths = [
  { name: 'iPhone SE (Portrait)', width: 320, height: 568 },
  { name: 'Small Android (Portrait)', width: 360, height: 640 },
  { name: 'iPhone 11 (Portrait)', width: 375, height: 812 },
  { name: 'iPhone 12/15 (Portrait)', width: 390, height: 844 },
  { name: 'Pixel 7 (Portrait)', width: 412, height: 915 },
  { name: 'Tablet Small (Portrait)', width: 600, height: 960 },
  { name: 'iPad Mini (Portrait)', width: 768, height: 1024 },
  { name: 'iPad Pro 11 (Portrait)', width: 834, height: 1194 },
  { name: 'iPhone 15 Pro Max (Landscape)', width: 852, height: 393 },
  { name: 'iPad (Landscape)', width: 1024, height: 768 },
];

interface OverflowOffender {
  tagName: string;
  className: string;
  id: string;
  right: number;
  left: number;
  width: number;
}

interface AuditReport {
  stateName: string;
  scrollWidth: number;
  innerWidth: number;
  offenders: OverflowOffender[];
  passed: boolean;
}

async function auditHorizontalOverflow(
  page: Page,
  stateName: string,
  viewportName: string,
  expectedWidth: number
): Promise<AuditReport> {
  const metrics = await page.evaluate(() => {
    return {
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      clientWidth: document.documentElement.clientWidth,
    };
  });

  const offenders: OverflowOffender[] = await page.evaluate(() => {
    const result: OverflowOffender[] = [];
    const clientWidth = document.documentElement.clientWidth;
    const elements = document.querySelectorAll('*');

    for (const el of Array.from(elements)) {
      const rect = el.getBoundingClientRect();
      if (
        rect.width === 0 ||
        rect.height === 0 ||
        window.getComputedStyle(el).display === 'none' ||
        window.getComputedStyle(el).visibility === 'hidden'
      ) {
        continue;
      }
      if (rect.right > clientWidth + 0.5 || rect.left < -0.5) {
        result.push({
          tagName: el.tagName.toLowerCase(),
          className: (typeof el.className === 'string' ? el.className : '').trim(),
          id: el.id || '',
          right: Math.round(rect.right * 10) / 10,
          left: Math.round(rect.left * 10) / 10,
          width: Math.round(rect.width * 10) / 10,
        });
      }
    }
    return result;
  });

  let pseudoOffenders: string[] = [];
  if (metrics.scrollWidth > metrics.innerWidth && offenders.length === 0) {
    pseudoOffenders = await page.evaluate(() => {
      const style = document.createElement('style');
      style.id = '__test_pseudo_remover';
      style.innerHTML = '*::before, *::after { display: none !important; }';
      document.head.appendChild(style);
      const newScrollWidth = document.documentElement.scrollWidth;
      style.remove();
      if (newScrollWidth <= window.innerWidth) {
        return ['::before / ::after pseudo-elements (expanded hit areas) causing overflow'];
      }
      return ['Offscreen transform/translate or absolute positioned elements without bounding box overflow'];
    });
  }

  const passed = metrics.scrollWidth <= metrics.innerWidth;

  if (!passed || offenders.length > 0) {
    console.log(`\n🚨 [HORIZONTAL OVERFLOW] ${viewportName} (${expectedWidth}px) - State: "${stateName}"`);
    console.log(`   scrollWidth: ${metrics.scrollWidth}px | innerWidth: ${metrics.innerWidth}px | clientWidth: ${metrics.clientWidth}px`);
    if (offenders.length > 0) {
      console.log(`   Offending Elements (${offenders.length}):`);
      for (const o of offenders) {
        console.log(`     - <${o.tagName}${o.id ? ` id="${o.id}"` : ''} class="${o.className}"> rect.right=${o.right}px (viewport width=${metrics.innerWidth}px)`);
      }
    }
    if (pseudoOffenders.length > 0) {
      console.log(`   Pseudo findings:`, pseudoOffenders.join(', '));
    }
  }

  return {
    stateName,
    scrollWidth: metrics.scrollWidth,
    innerWidth: metrics.innerWidth,
    offenders,
    passed,
  };
}

test.describe('Horizontal Scrolling & Overflow Audit', () => {
  test.beforeEach(async ({ page, request, baseURL }) => {
    await authenticateAndSeedSession(page, request, baseURL!);
  });

  for (const viewport of testWidths) {
    test(`No horizontal overflow on ${viewport.name} (${viewport.width}x${viewport.height}) across UI states`, async ({ page }, testInfo) => {
      // Drop redundant 320-1024 width matrix from the tablet project; keep it in mobile-webkit and mobile-chromium
      if (testInfo.project.name === 'tablet' && viewport.width !== 834 && viewport.width !== 1024) {
        test.skip(true, 'Redundant phone width matrix dropped from tablet project; only tablet viewports evaluated');
      }

      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/');
      await page.waitForSelector('main', { state: 'visible' });

      const stateReports: AuditReport[] = [];

      // State 1: Default / Home Screen
      const rep1 = await auditHorizontalOverflow(page, 'Default Home Screen', viewport.name, viewport.width);
      stateReports.push(rep1);

      // State 2: PreferencesModal Open
      const settingsBtn = page.locator('#reminder-preferences-btn');
      if (await settingsBtn.isVisible()) {
        await settingsBtn.click();
        await page.waitForSelector('#preferences-modal-card', { state: 'visible', timeout: 5000 });
        await page.waitForTimeout(250);

        const rep2 = await auditHorizontalOverflow(page, 'PreferencesModal Open', viewport.name, viewport.width);
        stateReports.push(rep2);

        // Close modal
        await page.keyboard.press('Escape');
        await page.waitForSelector('#preferences-modal-card', { state: 'hidden', timeout: 5000 });
        await page.waitForTimeout(200);
      }

      // State 3: ItemCard Expanded
      const itemCard = page.locator('[id^="item-card-"]').first();
      if (await itemCard.isVisible()) {
        await itemCard.click();
        await page.waitForTimeout(300);

        const rep3 = await auditHorizontalOverflow(page, 'ItemCard Expanded', viewport.name, viewport.width);
        stateReports.push(rep3);

        // Re-click to collapse
        await itemCard.click();
        await page.waitForTimeout(200);
      }

      // State 4: Long unbroken string in title
      const originalTitle = await page.evaluate(() => {
        const titleEl = document.querySelector('h4');
        if (titleEl) {
          const prev = titleEl.textContent;
          titleEl.textContent = 'Supercalifragilisticexpialidocious_Pneumonoultramicroscopicsilicovolcanoconiosis_UnbrokenTestString1234567890';
          return prev;
        }
        return null;
      });
      if (originalTitle !== null) {
        await page.waitForTimeout(200);
        const repTitle = await auditHorizontalOverflow(page, 'Long Unbroken String in Title', viewport.name, viewport.width);
        stateReports.push(repTitle);

        // Restore original title
        await page.evaluate((prev) => {
          const titleEl = document.querySelector('h4');
          if (titleEl && prev) titleEl.textContent = prev;
        }, originalTitle);
        await page.waitForTimeout(150);
      }

      // State 5: Search input focused / on-screen keyboard open & font-size check on ALL form controls
      const formControls = await page.evaluate(() => {
        const els = document.querySelectorAll('input, select, textarea');
        return Array.from(els).map(el => {
          const style = window.getComputedStyle(el);
          return {
            tag: el.tagName.toLowerCase(),
            id: el.id,
            visible: style.display !== 'none' && style.visibility !== 'hidden' && (el as HTMLElement).offsetWidth > 0,
            fontSize: parseFloat(style.fontSize) || 0,
          };
        }).filter(i => i.visible);
      });

      for (const ctrl of formControls) {
        expect(ctrl.fontSize, `<${ctrl.tag}${ctrl.id ? ` id="${ctrl.id}"` : ''}> font size (${ctrl.fontSize}px) must be >= 16px to prevent iOS auto-zoom`).toBeGreaterThanOrEqual(16);
      }

      const searchInput = page.locator('#search-input');
      if (await searchInput.isVisible()) {
        await searchInput.focus();
        const keyboardHeight = 280;
        const reducedHeight = Math.max(250, viewport.height - keyboardHeight);
        await page.setViewportSize({ width: viewport.width, height: reducedHeight });
        await page.waitForTimeout(300);

        const rep5 = await auditHorizontalOverflow(page, 'Search Input Focused (Keyboard Open)', viewport.name, viewport.width);
        stateReports.push(rep5);

        // Restore viewport height & blur
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await searchInput.blur();
        await page.waitForTimeout(150);
      }

      // State 6: Viewport height reduced to ~450px (simulating short landscape or split-screen)
      await page.setViewportSize({ width: viewport.width, height: 450 });
      await page.waitForTimeout(200);
      const rep6 = await auditHorizontalOverflow(page, 'Reduced Viewport Height (~450px)', viewport.name, viewport.width);
      stateReports.push(rep6);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.waitForTimeout(150);

      // Assert all states passed
      const failures = stateReports.filter(r => !r.passed);
      if (failures.length > 0) {
        const failureDetails = failures
          .map(f => `[${f.stateName}: scrollWidth=${f.scrollWidth} > innerWidth=${f.innerWidth}, offenders=${f.offenders.map(o => `<${o.tagName}${o.id ? ` id="${o.id}"` : ''} class="${o.className}"> width=${o.width} right=${o.right}`).join(', ')}]`)
          .join('; ');
        expect(
          failures.length,
          `Horizontal overflow detected on ${viewport.name} (${viewport.width}px) in states: ${failureDetails}`
        ).toBe(0);
      }
    });
  }

  test('Search input keeps value and focus across breakpoint changes (390 -> 834 -> 1024)', async ({ page }) => {
    // Start at compact mobile (390x844)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.waitForSelector('#search-input', { state: 'visible' });

    // Focus and type text
    await page.fill('#search-input', 'battery refund');
    await expect(page.locator('#search-input')).toHaveValue('battery refund');
    await expect(page.locator('#search-input')).toBeFocused();

    // Resize to tablet rail (834x1194)
    await page.setViewportSize({ width: 834, height: 1194 });
    await page.waitForTimeout(300);
    await expect(page.locator('#search-input')).toBeVisible();
    await expect(page.locator('#search-input')).toHaveValue('battery refund');
    await expect(page.locator('#search-input')).toBeFocused();

    // Resize to desktop / tablet landscape sidebar (1024x768)
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForTimeout(300);
    await expect(page.locator('#search-input')).toBeVisible();
    await expect(page.locator('#search-input')).toHaveValue('battery refund');
    await expect(page.locator('#search-input')).toBeFocused();
  });

  test('Rail navigation is reachable and scrollable at short heights (834x500 and 700x510)', async ({ page }) => {
    const testCases = [
      { width: 834, height: 500, name: '834x500' },
      { width: 700, height: 510, name: '700x510' },
    ];

    for (const tc of testCases) {
      await page.setViewportSize({ width: tc.width, height: tc.height });
      await page.goto('/');
      await page.waitForSelector('header', { state: 'visible' });

      // Verify header is 80px rail
      const railHeader = page.locator('header.w-\\[80px\\]');
      await expect(railHeader).toBeVisible();

      // Brand LifeLoop is visible
      await expect(railHeader.locator('h1:has-text("LifeLoop")')).toBeVisible();

      // Verify each rail tab is present and reachable
      const tabIds = ['priority', 'timeline', 'captures', 'ask', 'graph', 'family'];
      for (const id of tabIds) {
        const tab = railHeader.locator(`#tab-${id}`);
        await expect(tab).toBeAttached();
        await tab.scrollIntoViewIfNeeded();
        await expect(tab).toBeVisible();
      }

      // Settings and Profile buttons are reachable
      const prefsBtn = railHeader.locator('#reminder-preferences-btn');
      await prefsBtn.scrollIntoViewIfNeeded();
      await expect(prefsBtn).toBeVisible();
    }
  });
});
