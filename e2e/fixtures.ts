import { test as base, expect, Page, APIRequestContext } from '@playwright/test';

export interface SetupCheckOptions {
  requireDb?: boolean;
  requireGeminiKey?: boolean;
}

/**
 * Validates backend server and database availability with actionable error messages.
 */
export async function verifyBackendReadiness(
  request: APIRequestContext,
  baseURL: string,
  options: SetupCheckOptions = { requireDb: true }
) {
  let res;
  try {
    res = await request.get(`${baseURL}/api/v1/health`);
  } catch (err: any) {
    throw new Error(
      `\n❌ [PLAYWRIGHT SETUP FAILURE: BACKEND UNREACHABLE]\n` +
      `Could not connect to the backend server at: ${baseURL}\n` +
      `Underlying error: ${err.message}\n\n` +
      `Fix: Ensure the backend dev server is running on the configured port, or ensure\n` +
      `playwright.config.ts has webServer configured properly (e.g., 'npm run dev').\n`
    );
  }

  if (!res.ok()) {
    throw new Error(
      `\n❌ [PLAYWRIGHT SETUP FAILURE: HEALTH CHECK FAILED]\n` +
      `Backend responded with HTTP status ${res.status()} at ${baseURL}/api/v1/health.\n`
    );
  }

  const health = await res.json();
  if (options.requireDb && health.database && health.database !== 'ok') {
    throw new Error(
      `\n❌ [PLAYWRIGHT SETUP FAILURE: DATABASE UNREACHABLE]\n` +
      `Backend is up, but the database connection failed: ${health.databaseError || 'Unknown DB error'}\n` +
      `Fix: Check DATABASE_URL in your .env file and ensure PostgreSQL/Neon is accessible.\n`
    );
  }

  if (options.requireGeminiKey && !health.hasGeminiKey) {
    throw new Error(
      `\n❌ [PLAYWRIGHT SETUP FAILURE: GEMINI_API_KEY MISSING]\n` +
      `This test requires GEMINI_API_KEY in the environment, but it was not found.\n` +
      `Fix: Add GEMINI_API_KEY to your .env file.\n`
    );
  }

  return health;
}

/**
 * Registers a fresh test user, sets the session cookie, and seeds test items.
 */
export async function authenticateAndSeedSession(page: Page, request: APIRequestContext, baseURL: string) {
  await verifyBackendReadiness(request, baseURL, { requireDb: true });

  const timestamp = Date.now();
  const testEmail = `e2e_seeded_${timestamp}_${Math.random().toString(36).substring(2, 7)}@lifeloop.test`;
  const testPassword = 'Password123!Secure';

  // 1. Register test user
  let regRes;
  try {
    regRes = await request.post(`${baseURL}/api/v1/auth/register`, {
      data: {
        email: testEmail,
        password: testPassword,
      },
    });
  } catch (err: any) {
    throw new Error(
      `\n❌ [PLAYWRIGHT SETUP FAILURE: AUTH REGISTRATION FAILED]\n` +
      `Could not reach /api/v1/auth/register: ${err.message}\n`
    );
  }

  if (!regRes.ok()) {
    const errorBody = await regRes.text();
    throw new Error(
      `\n❌ [PLAYWRIGHT SETUP FAILURE: AUTH REGISTRATION REJECTED]\n` +
      `Status ${regRes.status()}: ${errorBody}\n` +
      `Fix: Verify database schema migrations and user table availability.\n`
    );
  }

  // 2. Extract session cookie and apply to browser context
  let sessionToken = '';
  const headersArr = regRes.headersArray();
  for (const h of headersArr) {
    if (h.name.toLowerCase() === 'set-cookie') {
      const m = h.value.match(/session=([^;]+)/);
      if (m) {
        sessionToken = m[1];
        break;
      }
    }
  }
  if (!sessionToken) {
    const raw = regRes.headers()['set-cookie'] || '';
    const m = raw.match(/session=([^;]+)/);
    if (m) sessionToken = m[1];
  }

  if (sessionToken) {
    await page.context().addCookies([
      {
        name: 'session',
        value: sessionToken,
        url: baseURL,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
  }

  // 3. Seed an ItemCard so the dashboard has active cards to expand and inspect
  try {
    const itemRes = await request.post(`${baseURL}/api/v1/items`, {
      headers: {
        Cookie: sessionToken ? `session=${sessionToken}` : '',
      },
      data: {
        title: 'Geico Car Insurance Renewal',
        itemType: 'renewal',
        dueDate: new Date(Date.now() + 14 * 86400000).toISOString(),
        confidenceScore: 0.95,
        metadata: {
          amount: 185.50,
          currency: 'USD',
          vendor: 'Geico',
          policyNumber: 'GK-982341',
          description: 'Comprehensive and collision coverage renewal',
        },
      },
    });
    console.log(`[authenticateAndSeedSession] Item seed returned status ${itemRes.status()}: ${await itemRes.text()}`);
    if (!itemRes.ok()) {
      throw new Error(`[authenticateAndSeedSession] Failed to seed item: ${itemRes.status()}`);
    }
    const checkRes = await request.get(`${baseURL}/api/v1/items`, {
      headers: { Cookie: `session=${sessionToken}` },
    });
    console.log('[authenticateAndSeedSession checkRes]', await checkRes.text());
  } catch (err) {
    console.warn('Warning: Could not seed item:', err);
  }

  return { email: testEmail, password: testPassword };
}
