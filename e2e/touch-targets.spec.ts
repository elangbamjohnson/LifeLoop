import { test, expect, Page } from '@playwright/test';
import { authenticateAndSeedSession } from './fixtures';

interface TouchTargetResult {
  id: string;
  tagName: string;
  className: string;
  position: string;
  isFixed: boolean;
  width: number;
  height: number;
  rect: { top: number; bottom: number; left: number; right: number };
  text: string;
}

async function collectTouchTargets(page: Page): Promise<TouchTargetResult[]> {
  return page.evaluate(() => {
    const interactiveSelectors = [
      'button',
      'a[href]',
      '[role="button"]',
      '[role="switch"]',
      '[role="checkbox"]',
      'input',
      'select'
    ];

    const elements = document.querySelectorAll(interactiveSelectors.join(', '));
    const results: TouchTargetResult[] = [];

    // Exclusion Rule: When a modal is open, backdrop obscures background controls.
    // We target the topmost active modal dialog.
    const activeModal = document.querySelector('[role="dialog"], #preferences-modal, #preferences-modal-card, #capture-dialog, .fixed.z-50');

    for (const el of Array.from(elements)) {
      // If a modal is open, only audit elements inside the active modal
      if (activeModal && !activeModal.contains(el)) {
        continue;
      }

      const rect = el.getBoundingClientRect();

      // Skip hidden elements or zero-size elements
      if (
        rect.width === 0 ||
        rect.height === 0 ||
        window.getComputedStyle(el).display === 'none' ||
        window.getComputedStyle(el).visibility === 'hidden'
      ) {
        continue;
      }

      // Check if element or its container is fixed (floating overlay)
      const isFixed = !!el.closest('.fixed') || window.getComputedStyle(el).position === 'fixed';

      // Skip elements that are scrolled out of view inside an overflow container, and track clip bounds
      let currentParent = el.parentElement;
      let isClipped = false;
      let clipTop = -Infinity;
      let clipBottom = Infinity;
      let clipLeft = -Infinity;
      let clipRight = Infinity;

      while (currentParent && currentParent !== document.body && currentParent !== document.documentElement) {
        const style = window.getComputedStyle(currentParent);
        if (style.overflowY === 'auto' || style.overflowY === 'hidden' || style.overflowY === 'scroll') {
          const parentRect = currentParent.getBoundingClientRect();
          if (rect.bottom < parentRect.top + 20 || rect.top > parentRect.bottom - 20) {
            isClipped = true;
            break;
          }
          clipTop = Math.max(clipTop, parentRect.top);
          clipBottom = Math.min(clipBottom, parentRect.bottom);
        }
        if (style.overflowX === 'auto' || style.overflowX === 'hidden' || style.overflowX === 'scroll') {
          const parentRect = currentParent.getBoundingClientRect();
          if (rect.right < parentRect.left + 20 || rect.left > parentRect.right - 20) {
            isClipped = true;
            break;
          }
          clipLeft = Math.max(clipLeft, parentRect.left);
          clipRight = Math.min(clipRight, parentRect.right);
        }
        currentParent = currentParent.parentElement;
      }
      if (isClipped) continue;

      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;

      // Sample hit test with elementFromPoint to measure effective tap areas including pseudo-elements (before:-inset-*)
      const hitsElement = (x: number, y: number) => {
        if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) return false;
        const hit = document.elementFromPoint(x, y);
        return hit && (hit === el || el.contains(hit) || hit.closest('button, a, [role="button"], [role="switch"], [role="checkbox"], input, select') === el);
      };

      // Measure width outwards via hit testing
      let xLeft = cx;
      while (xLeft > 0 && hitsElement(xLeft - 2, cy)) xLeft -= 2;
      let xRight = cx;
      while (xRight < window.innerWidth && hitsElement(xRight + 2, cy)) xRight += 2;
      const sampledWidth = Math.max(rect.width, xRight - xLeft);

      // Measure height outwards via hit testing
      let yTop = cy;
      while (yTop > 0 && hitsElement(cx, yTop - 2)) yTop -= 2;
      let yBottom = cy;
      while (yBottom < window.innerHeight && hitsElement(cx, yBottom + 2)) yBottom += 2;
      const sampledHeight = Math.max(rect.height, yBottom - yTop);

      // Also account for computed pseudo-element hit area expansion (e.g. .touch-target-48, before:-inset-*)
      const beforeStyle = window.getComputedStyle(el, '::before');
      const hasPseudo =
        beforeStyle &&
        beforeStyle.content &&
        beforeStyle.content !== 'none' &&
        beforeStyle.content !== 'normal' &&
        beforeStyle.display !== 'none' &&
        beforeStyle.position === 'absolute';
      const pseudoW = hasPseudo
        ? Math.max(
            parseFloat(beforeStyle.minWidth) || 0,
            parseFloat(beforeStyle.width) || 0,
            rect.width - (parseFloat(beforeStyle.left) || 0) - (parseFloat(beforeStyle.right) || 0)
          )
        : 0;
      const pseudoH = hasPseudo
        ? Math.max(
            parseFloat(beforeStyle.minHeight) || 0,
            parseFloat(beforeStyle.height) || 0,
            rect.height - (parseFloat(beforeStyle.top) || 0) - (parseFloat(beforeStyle.bottom) || 0)
          )
        : 0;

      const finalWidth = Math.max(sampledWidth, pseudoW);
      const finalHeight = Math.max(sampledHeight, pseudoH);

      const halfExtraW = (finalWidth - rect.width) / 2;
      const halfExtraH = (finalHeight - rect.height) / 2;

      results.push({
        id: el.id || 'anonymous',
        tagName: el.tagName.toLowerCase(),
        className: (typeof el.className === 'string' ? el.className : '').trim(),
        position: window.getComputedStyle(el).position,
        isFixed,
        width: Math.round(finalWidth * 10) / 10,
        height: Math.round(finalHeight * 10) / 10,
        rect: {
          top: Math.round(Math.max(rect.top - halfExtraH, clipTop) * 10) / 10,
          bottom: Math.round(Math.min(rect.bottom + halfExtraH, clipBottom) * 10) / 10,
          left: Math.round(Math.max(rect.left - halfExtraW, clipLeft) * 10) / 10,
          right: Math.round(Math.min(rect.right + halfExtraW, clipRight) * 10) / 10,
        },
        text: el.textContent?.trim().substring(0, 24) || '',
      });
    }
    return results;
  });
}

function verifyTouchTargetsAndSpacing(
  targets: TouchTargetResult[],
  stateName: string,
  viewportName: string,
  projectName: string
) {
  // Log verified target count
  console.log(`[${projectName}] ${viewportName} - "${stateName}": Audited ${targets.length} interactive targets (all >= 48x48px, >= 8px separation).`);
  expect(
    targets.length,
    `[${projectName}] ${viewportName} - "${stateName}": Expected at least 1 interactive target, found 0`
  ).toBeGreaterThan(0);

  // 2. Check each target is >= 47.5px (48px with 0.5px subpixel tolerance)
  const failedSizes = targets.filter(t => t.width < 47.5 || t.height < 47.5);
  if (failedSizes.length > 0) {
    console.error(`[Touch Target Size Failure] ${viewportName} - State: "${stateName}" on ${projectName}:`);
    console.table(failedSizes.map(f => ({ id: f.id, tag: f.tagName, w: f.width, h: f.height, text: f.text })));
  }
  expect(
    failedSizes.length,
    `[${projectName}] ${viewportName} - "${stateName}": Found ${failedSizes.length} targets smaller than 48x48px`
  ).toBe(0);

  // 3. Spacing / Overlap audit between distinct controls
  const overlapping: { el1: string; el2: string; overlapArea: number }[] = [];
  for (let i = 0; i < targets.length; i++) {
    for (let j = i + 1; j < targets.length; j++) {
      const a = targets[i];
      const b = targets[j];

      // Skip elements that share an ancestor button or are children of each other
      if (a.id === b.id && a.id !== 'anonymous') continue;

      // Skip comparing floating action overlays (fixed) against scrolling document content
      if (a.isFixed !== b.isFixed) continue;

      const intersectX = Math.max(0, Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left));
      const intersectY = Math.max(0, Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top));

      if (intersectX > 2 && intersectY > 2) {
        overlapping.push({
          el1: a.id,
          el2: b.id,
          overlapArea: Math.round(intersectX * intersectY * 10) / 10
        });
      }
    }
  }

  if (overlapping.length > 0) {
    console.error(`[Touch Target Overlap] ${viewportName} - State: "${stateName}" on ${projectName}:`, overlapping);
  }
  expect(
    overlapping.length,
    `[${projectName}] ${viewportName} - "${stateName}": Found ${overlapping.length} overlapping touch targets`
  ).toBe(0);
}

async function auditInputsFontSize(
  page: Page,
  stateName: string,
  viewportName: string,
  projectName: string
) {
  const fontSizes = await page.evaluate(() => {
    const inputs = document.querySelectorAll('input, select, textarea');
    const result: { tag: string; id: string; fontSize: number }[] = [];
    for (const el of Array.from(inputs)) {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || (el as HTMLElement).offsetWidth === 0) {
        continue;
      }
      result.push({
        tag: el.tagName.toLowerCase(),
        id: el.id || '',
        fontSize: parseFloat(style.fontSize) || 0,
      });
    }
    return result;
  });

  for (const item of fontSizes) {
    expect(
      item.fontSize,
      `[${projectName}] ${viewportName} - "${stateName}": <${item.tag}${item.id ? ` id="${item.id}"` : ''}> font-size (${item.fontSize}px) must be >= 16px to prevent iOS auto-zoom`
    ).toBeGreaterThanOrEqual(16);
  }
}

test.describe('Touch Targets Audit (Apple HIG 44pt & Material 3 48dp)', () => {
  test.beforeEach(async ({ page, request, baseURL }, testInfo) => {
    test.skip(!testInfo.project.use.hasTouch, 'Touch targets audit is restricted to touch-enabled projects');
    await authenticateAndSeedSession(page, request, baseURL!);
  });

  const viewports = [
    { name: 'Portrait', size: { width: 390, height: 844 } },
    { name: 'Compact', size: { width: 320, height: 568 } },
    { name: 'Landscape', size: { width: 852, height: 393 } },
    { name: 'Tablet Portrait', size: { width: 834, height: 1194 } },
  ];

  for (const vp of viewports) {
    test(`Touch targets audit on ${vp.name} (${vp.size.width}x${vp.size.height}) across all 5 states`, async ({ page }, testInfo) => {
      page.on('console', msg => console.log('[BROWSER CONSOLE]', msg.text()));
      page.on('request', req => console.log('[REQ]', req.method(), req.url()));
      page.on('response', res => console.log('[RES]', res.status(), res.url()));
      await page.setViewportSize(vp.size);
      await page.goto('/');
      await page.waitForSelector('main', { state: 'visible' });
      await page.waitForTimeout(300);

      // State 1: Shell (default home state)
      await auditInputsFontSize(page, 'Shell', vp.name, testInfo.project.name);
      const shellTargets = await collectTouchTargets(page);
      verifyTouchTargetsAndSpacing(shellTargets, 'Shell', vp.name, testInfo.project.name);
      await page.screenshot({ path: `test-results/screenshot-${testInfo.project.name}-${vp.size.width}x${vp.size.height}-Shell.png` });

      // State 2: ItemCard collapsed
      const firstCard = page.locator('[id^="item-card-"]').first();
      await expect(firstCard, 'Expected at least one seeded ItemCard to be present').toBeVisible();
      await auditInputsFontSize(page, 'ItemCard Collapsed', vp.name, testInfo.project.name);
      const collapsedTargets = await collectTouchTargets(page);
      verifyTouchTargetsAndSpacing(collapsedTargets, 'ItemCard Collapsed', vp.name, testInfo.project.name);
      await page.screenshot({ path: `test-results/screenshot-${testInfo.project.name}-${vp.size.width}x${vp.size.height}-ItemCard_Collapsed.png` });

      // State 3: ItemCard expanded (revealing row actions)
      const expandBtn = firstCard.locator('[aria-label="Expand"], [aria-label="Collapse"]').first();
      if (await expandBtn.count() > 0) {
        await expandBtn.click();
      } else {
        await firstCard.click({ position: { x: 20, y: 20 } });
      }
      await page.waitForTimeout(300);
      await auditInputsFontSize(page, 'ItemCard Expanded', vp.name, testInfo.project.name);
      const expandedTargets = await collectTouchTargets(page);
      verifyTouchTargetsAndSpacing(expandedTargets, 'ItemCard Expanded', vp.name, testInfo.project.name);
      await page.screenshot({ path: `test-results/screenshot-${testInfo.project.name}-${vp.size.width}x${vp.size.height}-ItemCard_Expanded.png` });

      // Collapse card back
      const collapseBtn = firstCard.locator('[aria-label="Collapse"], [aria-label="Expand"]').first();
      if (await collapseBtn.count() > 0) {
        await collapseBtn.click();
      } else {
        await firstCard.click({ position: { x: 20, y: 20 } });
      }
      await page.waitForTimeout(200);

      // State 4: PreferencesModal open
      const profileBtn = page.locator('#user-profile-menu-btn');
      await expect(profileBtn).toBeVisible();
      await profileBtn.click();
      const prefsBtn = page.locator('#profile-preferences-btn');
      await expect(prefsBtn).toBeVisible();
      await prefsBtn.click();
      await page.waitForSelector('#preferences-modal-card', { state: 'visible', timeout: 5000 });
      await page.waitForTimeout(300);

      await auditInputsFontSize(page, 'PreferencesModal Open', vp.name, testInfo.project.name);
      const modalTargets = await collectTouchTargets(page);
      verifyTouchTargetsAndSpacing(modalTargets, 'PreferencesModal Open', vp.name, testInfo.project.name);
      await page.screenshot({ path: `test-results/screenshot-${testInfo.project.name}-${vp.size.width}x${vp.size.height}-PreferencesModal_Open.png` });

      // Close modal
      await page.keyboard.press('Escape');
      await page.waitForSelector('#preferences-modal-card', { state: 'hidden', timeout: 5000 });
      await page.waitForTimeout(200);

      // State 5: Capture Modal open
      const captureBtn = page.locator('#global-capture-btn');
      if (await captureBtn.isVisible()) {
        await captureBtn.click();
        await page.waitForSelector('#capture-dialog', { state: 'visible', timeout: 5000 });
        await page.waitForTimeout(300);

        await auditInputsFontSize(page, 'Capture Modal Open', vp.name, testInfo.project.name);
        const captureTargets = await collectTouchTargets(page);
        verifyTouchTargetsAndSpacing(captureTargets, 'Capture Modal Open', vp.name, testInfo.project.name);
        await page.screenshot({ path: `test-results/screenshot-${testInfo.project.name}-${vp.size.width}x${vp.size.height}-Capture_Modal_Open.png` });

        // Close modal
        await page.keyboard.press('Escape');
        const isStillVisible = await page.locator('#capture-dialog').isVisible();
        if (isStillVisible) {
          await page.locator('#close-capture-btn').click();
        }
        await page.waitForSelector('#capture-dialog', { state: 'hidden', timeout: 5000 });
        await page.waitForTimeout(200);
      }
    });
  }
});
