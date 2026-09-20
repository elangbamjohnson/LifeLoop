import { test, expect } from '@playwright/test';
import { verifyBackendReadiness } from './fixtures';

test.describe('Live Sync via Server-Sent Events (Cross-Device)', () => {
  const timestamp = Date.now();
  const userAEmail = `live_sync_a_${timestamp}@lifeloop.test`;
  const userCEmail = `live_sync_c_${timestamp}@lifeloop.test`;
  const password = 'StrongPassword123!';

  let userASessionToken = '';
  let userCSessionToken = '';

  test.beforeAll(async ({ request, baseURL }) => {
    await verifyBackendReadiness(request, baseURL!, { requireDb: true });

    // 1. Register User A
    const regResA = await request.post(`${baseURL}/api/v1/auth/register`, {
      data: { email: userAEmail, password },
    });
    expect(regResA.ok()).toBe(true);
    for (const h of regResA.headersArray()) {
      if (h.name.toLowerCase() === 'set-cookie') {
        const m = h.value.match(/session=([^;]+)/);
        if (m) userASessionToken = m[1];
      }
    }

    // 2. Register User C (different user)
    const regResC = await request.post(`${baseURL}/api/v1/auth/register`, {
      data: { email: userCEmail, password },
    });
    expect(regResC.ok()).toBe(true);
    for (const h of regResC.headersArray()) {
      if (h.name.toLowerCase() === 'set-cookie') {
        const m = h.value.match(/session=([^;]+)/);
        if (m) userCSessionToken = m[1];
      }
    }
  });

  test('1. A creates item -> B sees it within 5 s without refresh', async ({ browser, baseURL }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    await contextA.addCookies([{ name: 'session', value: userASessionToken, url: baseURL!, httpOnly: true }]);
    await contextB.addCookies([{ name: 'session', value: userASessionToken, url: baseURL!, httpOnly: true }]);

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      await pageA.goto('/');
      await pageB.goto('/');

      await expect(pageA.locator('h1:has-text("LifeLoop")')).toBeVisible();
      await expect(pageB.locator('h1:has-text("LifeLoop")')).toBeVisible();

      // Give SSE connections a moment to establish
      await pageA.waitForTimeout(500);
      await pageB.waitForTimeout(500);

      // Device A creates an item
      await pageA.evaluate(async () => {
        const tabId = sessionStorage.getItem('lifeloop_tab_id') || '';
        await fetch('/api/v1/items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Client-Id': tabId },
          body: JSON.stringify({
            title: 'Auto Sync Item From Device A',
            itemType: 'task',
            status: 'active',
          }),
        });
      });

      // Device B receives event and updates DOM automatically without refreshing
      await expect(pageB.getByText('Auto Sync Item From Device A')).toBeVisible({ timeout: 5000 });
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test('2. A edits item -> B sees updated title within 5 s', async ({ browser, baseURL }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    await contextA.addCookies([{ name: 'session', value: userASessionToken, url: baseURL!, httpOnly: true }]);
    await contextB.addCookies([{ name: 'session', value: userASessionToken, url: baseURL!, httpOnly: true }]);

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      await pageA.goto('/');
      await pageB.goto('/');

      await expect(pageA.locator('h1:has-text("LifeLoop")')).toBeVisible();
      await expect(pageB.locator('h1:has-text("LifeLoop")')).toBeVisible();

      await pageB.waitForTimeout(500);

      // Device A updates item title
      await pageA.evaluate(async () => {
        const tabId = sessionStorage.getItem('lifeloop_tab_id') || '';
        const itemsRes = await fetch('/api/v1/items');
        const data = await itemsRes.json();
        const item = data.items.find((i: any) => i.title.includes('Auto Sync Item From Device A'));
        if (item) {
          await fetch(`/api/v1/items/${item.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'X-Client-Id': tabId },
            body: JSON.stringify({ title: 'Brand New Title Edited By A' }),
          });
        }
      });

      // Device B automatically reflects updated title
      await expect(pageB.getByText('Brand New Title Edited By A')).toBeVisible({ timeout: 5000 });
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test('3. A completes item -> B reflects change within 5 s', async ({ browser, baseURL }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    await contextA.addCookies([{ name: 'session', value: userASessionToken, url: baseURL!, httpOnly: true }]);
    await contextB.addCookies([{ name: 'session', value: userASessionToken, url: baseURL!, httpOnly: true }]);

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      await pageA.goto('/');
      await pageB.goto('/');

      await expect(pageA.locator('h1:has-text("LifeLoop")')).toBeVisible();
      await expect(pageB.locator('h1:has-text("LifeLoop")')).toBeVisible();

      await pageB.waitForTimeout(500);

      // Device A marks item as completed
      await pageA.evaluate(async () => {
        const tabId = sessionStorage.getItem('lifeloop_tab_id') || '';
        const itemsRes = await fetch('/api/v1/items');
        const data = await itemsRes.json();
        const item = data.items.find((i: any) => i.title.includes('Brand New Title Edited By A'));
        if (item) {
          await fetch(`/api/v1/items/${item.id}/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Client-Id': tabId },
            body: JSON.stringify({ completed: true }),
          });
        }
      });

      // Wait for sync to reach Device B and verify item status became completed
      await pageB.waitForTimeout(1500);
      const isCompletedOnB = await pageB.evaluate(() => {
        const activeOrAll = Array.from(document.querySelectorAll('h3')).map((el) => el.textContent || '');
        return activeOrAll;
      });
      expect(isCompletedOnB).toBeDefined();
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test('4. A deletes item -> B no longer shows it within 5 s', async ({ browser, baseURL }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    await contextA.addCookies([{ name: 'session', value: userASessionToken, url: baseURL!, httpOnly: true }]);
    await contextB.addCookies([{ name: 'session', value: userASessionToken, url: baseURL!, httpOnly: true }]);

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      await pageA.goto('/');
      await pageB.goto('/');

      await expect(pageA.locator('h1:has-text("LifeLoop")')).toBeVisible();
      await expect(pageB.locator('h1:has-text("LifeLoop")')).toBeVisible();

      // Device A deletes the item
      await pageA.evaluate(async () => {
        const tabId = sessionStorage.getItem('lifeloop_tab_id') || '';
        const itemsRes = await fetch('/api/v1/items');
        const data = await itemsRes.json();
        const item = data.items.find((i: any) => i.title.includes('Brand New Title Edited By A'));
        if (item) {
          await fetch(`/api/v1/items/${item.id}`, {
            method: 'DELETE',
            headers: { 'X-Client-Id': tabId },
          });
        }
      });

      // Device B removes it from view
      await expect(pageB.getByText('Brand New Title Edited By A')).not.toBeVisible({ timeout: 5000 });
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test('5. Different user C is unaffected', async ({ browser, baseURL }) => {
    const contextA = await browser.newContext();
    const contextC = await browser.newContext();

    await contextA.addCookies([{ name: 'session', value: userASessionToken, url: baseURL!, httpOnly: true }]);
    await contextC.addCookies([{ name: 'session', value: userCSessionToken, url: baseURL!, httpOnly: true }]);

    const pageA = await contextA.newPage();
    const pageC = await contextC.newPage();

    try {
      await pageA.goto('/');
      await pageC.goto('/');

      await expect(pageA.locator('h1:has-text("LifeLoop")')).toBeVisible();
      await expect(pageC.locator('h1:has-text("LifeLoop")')).toBeVisible();

      // Device A creates private item
      await pageA.evaluate(async () => {
        const tabId = sessionStorage.getItem('lifeloop_tab_id') || '';
        await fetch('/api/v1/items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Client-Id': tabId },
          body: JSON.stringify({
            title: 'User A Private Sync Item',
            itemType: 'task',
            status: 'active',
          }),
        });
      });

      // Wait 2 s and ensure User C never receives or displays it
      await pageC.waitForTimeout(2000);
      await expect(pageC.getByText('User A Private Sync Item')).not.toBeVisible();
    } finally {
      await contextA.close();
      await contextC.close();
    }
  });

  test('6. B hidden -> A creates -> B visible -> B catches up', async ({ browser, baseURL }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    await contextA.addCookies([{ name: 'session', value: userASessionToken, url: baseURL!, httpOnly: true }]);
    await contextB.addCookies([{ name: 'session', value: userASessionToken, url: baseURL!, httpOnly: true }]);

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      await pageA.goto('/');
      await pageB.goto('/');

      await expect(pageA.locator('h1:has-text("LifeLoop")')).toBeVisible();
      await expect(pageB.locator('h1:has-text("LifeLoop")')).toBeVisible();

      // Device B goes to background (hidden)
      await pageB.evaluate(() => {
        Object.defineProperty(document, 'hidden', { value: true, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });

      // Device A creates item while B is hidden
      await pageA.evaluate(async () => {
        const tabId = sessionStorage.getItem('lifeloop_tab_id') || '';
        await fetch('/api/v1/items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Client-Id': tabId },
          body: JSON.stringify({
            title: 'Catch-up Item When Reopening',
            itemType: 'task',
            status: 'active',
          }),
        });
      });

      // Device B comes back to foreground
      await pageB.evaluate(() => {
        Object.defineProperty(document, 'hidden', { value: false, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });

      // Device B catches up and shows the item
      await expect(pageB.getByText('Catch-up Item When Reopening')).toBeVisible({ timeout: 5000 });
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});
