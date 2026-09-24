import { test, expect } from '@playwright/test';
import { verifyBackendReadiness, verifyUserEmail } from './fixtures';

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
    await verifyUserEmail(userAEmail);
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
    await verifyUserEmail(userCEmail);
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

      const uniqueTitle = `Auto Sync Item 1 ${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

      // Device A creates an item with fixed X-Client-Id header
      const createResult = await pageA.evaluate(async (title) => {
        const res = await fetch('/api/v1/items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Client-Id': 'device-a-tab' },
          body: JSON.stringify({
            title,
            itemType: 'task',
            status: 'active',
          }),
        });
        const data = await res.json();
        return { status: res.status, id: data.item?.id };
      }, uniqueTitle);

      expect(createResult.status).toBe(201);
      expect(createResult.id).toBeDefined();

      // Device B receives event and updates DOM automatically without refreshing
      await expect(pageB.getByText(uniqueTitle)).toBeVisible({ timeout: 5000 });
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test('2. A edits item -> B sees updated title within 5 s', async ({ browser, baseURL, request }) => {
    const initialTitle = `Auto Sync Item 2 Initial ${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const newTitle = `Auto Sync Item 2 Edited ${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    // Self-contained: Create own item via POST /api/v1/items with unique title
    const itemCreateRes = await request.post(`${baseURL}/api/v1/items`, {
      headers: { Cookie: `session=${userASessionToken}` },
      data: {
        title: initialTitle,
        itemType: 'task',
        status: 'active',
      },
    });
    expect(itemCreateRes.status()).toBe(201);
    const createdItem = (await itemCreateRes.json()).item;
    expect(createdItem?.id).toBeDefined();
    const itemId = createdItem.id;

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

      // Assert Device B sees the initial item
      await expect(pageB.getByText(initialTitle)).toBeVisible({ timeout: 5000 });

      // Device A edits the item via the API with a fixed X-Client-Id header
      const editRes = await request.patch(`${baseURL}/api/v1/items/${itemId}`, {
        headers: {
          Cookie: `session=${userASessionToken}`,
          'X-Client-Id': 'device-a-tab',
        },
        data: { title: newTitle },
      });
      expect(editRes.status()).toBe(200);
      const editData = await editRes.json();
      expect(editData.item?.title).toBe(newTitle);

      // Device B automatically reflects updated title within 5s
      await expect(pageB.getByText(newTitle)).toBeVisible({ timeout: 5000 });
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test('3. A completes item -> B reflects change within 5 s', async ({ browser, baseURL, request }) => {
    const itemTitle = `Auto Sync Item 3 Complete ${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    // Self-contained: Create own item via POST /api/v1/items with unique title
    const itemCreateRes = await request.post(`${baseURL}/api/v1/items`, {
      headers: { Cookie: `session=${userASessionToken}` },
      data: {
        title: itemTitle,
        itemType: 'task',
        status: 'active',
      },
    });
    expect(itemCreateRes.status()).toBe(201);
    const createdItem = (await itemCreateRes.json()).item;
    expect(createdItem?.id).toBeDefined();
    const itemId = createdItem.id;

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

      // Assert initial item is visible on Device B
      await expect(pageB.getByText(itemTitle)).toBeVisible({ timeout: 5000 });

      // Device A marks item as completed via the API with fixed X-Client-Id header
      const completeRes = await request.post(`${baseURL}/api/v1/items/${itemId}/complete`, {
        headers: {
          Cookie: `session=${userASessionToken}`,
          'X-Client-Id': 'device-a-tab',
        },
        data: { completed: true },
      });
      expect(completeRes.status()).toBe(200);

      // Device B reflects completion by removing it from the active priority list within 5s
      await expect(pageB.getByText(itemTitle)).not.toBeVisible({ timeout: 5000 });
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test('4. A deletes item -> B no longer shows it within 5 s', async ({ browser, baseURL, request }) => {
    const itemTitle = `Auto Sync Item 4 Delete ${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    // Self-contained: Create own item via POST /api/v1/items with unique title
    const itemCreateRes = await request.post(`${baseURL}/api/v1/items`, {
      headers: { Cookie: `session=${userASessionToken}` },
      data: {
        title: itemTitle,
        itemType: 'task',
        status: 'active',
      },
    });
    expect(itemCreateRes.status()).toBe(201);
    const createdItem = (await itemCreateRes.json()).item;
    expect(createdItem?.id).toBeDefined();
    const itemId = createdItem.id;

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

      // Assert item appears on Device B
      await expect(pageB.getByText(itemTitle)).toBeVisible({ timeout: 5000 });

      // Device A deletes the item via the API with fixed X-Client-Id header
      const delRes = await request.delete(`${baseURL}/api/v1/items/${itemId}`, {
        headers: {
          Cookie: `session=${userASessionToken}`,
          'X-Client-Id': 'device-a-tab',
        },
      });
      expect(delRes.status()).toBe(200);

      // Device B removes it from view within 5s
      await expect(pageB.getByText(itemTitle)).not.toBeVisible({ timeout: 5000 });
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test('5. Different user C is unaffected', async ({ browser, baseURL, request }) => {
    const itemTitle = `User A Private Sync Item ${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

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

      // Device A creates private item via API with fixed X-Client-Id header
      const createRes = await request.post(`${baseURL}/api/v1/items`, {
        headers: {
          Cookie: `session=${userASessionToken}`,
          'X-Client-Id': 'device-a-tab',
        },
        data: {
          title: itemTitle,
          itemType: 'task',
          status: 'active',
        },
      });
      expect(createRes.status()).toBe(201);
      const createdItem = (await createRes.json()).item;
      expect(createdItem?.id).toBeDefined();

      // Wait 2 s and ensure User C never receives or displays it
      await pageC.waitForTimeout(2000);
      await expect(pageC.getByText(itemTitle)).not.toBeVisible();
    } finally {
      await contextA.close();
      await contextC.close();
    }
  });

  test('6. B hidden -> A creates -> B visible -> B catches up', async ({ browser, baseURL, request }) => {
    const itemTitle = `Catch-up Item When Reopening ${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

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

      // Device A creates item while B is hidden via API with fixed X-Client-Id header
      const createRes = await request.post(`${baseURL}/api/v1/items`, {
        headers: {
          Cookie: `session=${userASessionToken}`,
          'X-Client-Id': 'device-a-tab',
        },
        data: {
          title: itemTitle,
          itemType: 'task',
          status: 'active',
        },
      });
      expect(createRes.status()).toBe(201);
      const createdItem = (await createRes.json()).item;
      expect(createdItem?.id).toBeDefined();

      // Device B comes back to foreground
      await pageB.evaluate(() => {
        Object.defineProperty(document, 'hidden', { value: false, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });

      // Device B catches up and shows the item within 5s
      await expect(pageB.getByText(itemTitle)).toBeVisible({ timeout: 5000 });
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test('7. UI-driven edit: edit through app dialog -> B updates within 5 s and A shows new title', async ({
    browser,
    baseURL,
    request,
  }) => {
    const initialTitle = `UI Edit Item Initial ${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const newTitle = `UI Edit Item Updated ${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    // Self-contained: Create own item via POST /api/v1/items with unique title
    const itemCreateRes = await request.post(`${baseURL}/api/v1/items`, {
      headers: { Cookie: `session=${userASessionToken}` },
      data: {
        title: initialTitle,
        itemType: 'task',
        status: 'active',
      },
    });
    expect(itemCreateRes.status()).toBe(201);
    const createdItem = (await itemCreateRes.json()).item;
    expect(createdItem?.id).toBeDefined();
    const itemId = createdItem.id;

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

      // Assert both devices see initial title
      await expect(pageA.getByText(initialTitle)).toBeVisible({ timeout: 5000 });
      await expect(pageB.getByText(initialTitle)).toBeVisible({ timeout: 5000 });

      // On Device A: click the edit button on the item card to open edit modal
      const editBtn = pageA.locator(`#edit-item-${itemId}`);
      await editBtn.click();

      // Assert edit modal opens
      await expect(pageA.locator('#item-edit-modal-card')).toBeVisible();

      // Edit title in dialog
      await pageA.fill('#edit-title-input', newTitle);

      // Save changes
      await pageA.click('#save-item-btn');

      // Assert modal closes and Device A shows new title
      await expect(pageA.locator('#item-edit-modal-card')).not.toBeVisible();
      await expect(pageA.getByText(newTitle)).toBeVisible({ timeout: 5000 });

      // Device B automatically reflects updated title within 5s
      await expect(pageB.getByText(newTitle)).toBeVisible({ timeout: 5000 });
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});
