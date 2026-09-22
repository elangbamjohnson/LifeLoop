import { test, expect } from '@playwright/test';
import postgres from 'postgres';
import { assertTestDatabaseLiveGuard } from '../src/db/testDatabaseGuard';
import crypto from 'crypto';

test.describe('Phase 7.5A-2 Email Verification', () => {

  // Helper to fetch the latest mock email sent to a specific address
  async function getLatestMockEmail(request: any, baseURL: string, toEmail: string) {
    const res = await request.get(`${baseURL}/api/v1/test/mock-emails`);
    expect(res.ok()).toBeTruthy();
    const emails = await res.json();
    return emails.reverse().find((e: any) => e.to === toEmail);
  }

  // Helper to clear mock emails
  async function clearMockEmails(request: any, baseURL: string) {
    await request.delete(`${baseURL}/api/v1/test/mock-emails`);
  }

  // Helper to extract token from verifyUrl
  function extractToken(verifyUrl: string) {
    const url = new URL(verifyUrl);
    return url.searchParams.get('token');
  }

  test.beforeEach(async ({ request, baseURL }) => {
    await clearMockEmails(request, baseURL as string);
  });

  test('Test 1 - Happy path: register -> retrieve email -> verify -> success', async ({ page, request, baseURL }) => {
    const timestamp = Date.now();
    const testEmail = `happy_${timestamp}@lifeloop.test`;
    const testPassword = 'Password123!Secure';

    // Register via UI
    await page.goto('/auth');
    await page.getByText('Need an account? Register').click();
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.getByRole('button', { name: 'Create Account' }).click();

    // Verify transition to pending screen
    await expect(page.getByText('Check your email')).toBeVisible();
    await expect(page.getByText(testEmail)).toBeVisible();

    // Retrieve captured email
    const emailData = await getLatestMockEmail(request, baseURL as string, testEmail);
    expect(emailData).toBeDefined();

    // Verify it's a frontend URL, not the backend API URL directly
    expect(emailData.verifyUrl).toContain('/verify-email?token=');
    expect(emailData.verifyUrl).not.toContain('/api/v1/auth/');

    // Open verification link
    const token = extractToken(emailData.verifyUrl);
    await page.goto(`/verify-email?token=${token}`);

    // Verify success state
    await expect(page.getByText('Email Verified')).toBeVisible();
    await expect(page.getByText('Email verified — Your LifeLoop account is now active')).toBeVisible();

    // Click continue to app and verify we are logged in (dashboard)
    await page.getByRole('button', { name: 'Continue to LifeLoop' }).click();
    await expect(page).toHaveURL('/');
    // Check for dashboard elements
    await expect(page.getByText('LifeLoop')).toBeVisible();
  });

  test('Test 2 - Unverified login: blocked -> resend -> verify', async ({ page, request, baseURL }) => {
    const timestamp = Date.now();
    const testEmail = `unverified_${timestamp}@lifeloop.test`;
    const testPassword = 'Password123!Secure';

    // Create pending account via API to keep test fast
    const regRes = await request.post(`${baseURL}/api/v1/auth/register`, {
      data: { email: testEmail, password: testPassword }
    });
    expect(regRes.status()).toBe(201);
    await clearMockEmails(request, baseURL as string); // clear initial email

    // Attempt login via UI
    await page.goto('/auth');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.getByRole('button', { name: 'Sign In' }).click();

    // Verify blocked and transitioned to pending screen with guidance
    await expect(page.getByText('Check your email')).toBeVisible();
    await expect(page.getByText(testEmail)).toBeVisible();

    // Click resend
    await page.getByRole('button', { name: 'Resend verification email' }).click();
    await expect(page.getByText('Verification email sent')).toBeVisible();

    // Capture new email
    const emailData = await getLatestMockEmail(request, baseURL as string, testEmail);
    expect(emailData).toBeDefined();

    // Use real link
    const token = extractToken(emailData.verifyUrl);
    await page.goto(`/verify-email?token=${token}`);

    // Verify success and continue
    await expect(page.getByText('Email Verified')).toBeVisible();
    await page.getByRole('button', { name: 'Continue to LifeLoop' }).click();
    await expect(page).toHaveURL('/');
  });

  test('Test 3 - Expired token: use test-only DB access to expire', async ({ page, request, baseURL }) => {
    const timestamp = Date.now();
    const testEmail = `expired_${timestamp}@lifeloop.test`;
    
    // Register via API
    await request.post(`${baseURL}/api/v1/auth/register`, {
      data: { email: testEmail, password: 'Password123!' }
    });

    const emailData = await getLatestMockEmail(request, baseURL as string, testEmail);
    const verifyUrl = emailData.verifyUrl;
    const token = extractToken(verifyUrl);

    // Make the token expired directly in DB
    const schemaName = process.env.TEST_SCHEMA || 'lifeloop_test_e2e';
    const connStr = process.env.TEST_DATABASE_URL!.replace("-pooler", "");
    const finalConnStr = connStr.includes("?") 
      ? `${connStr}&options=-c%20search_path%3D${schemaName}`
      : `${connStr}?options=-c%20search_path%3D${schemaName}`;
      
    const sql = postgres(finalConnStr, { max: 1 });
    try {
      await assertTestDatabaseLiveGuard(sql, schemaName);
      const tokenHash = crypto.createHash('sha256').update(token!).digest('hex');
      await sql`UPDATE email_verification_tokens SET expires_at = NOW() - INTERVAL '1 day' WHERE token_hash = ${tokenHash}`;
    } finally {
      await sql.end();
    }

    // Open URL and see Expired state
    await page.goto(`/verify-email?token=${token}`);
    await expect(page.getByText('Verification Failed')).toBeVisible();
    await expect(page.getByText('expired')).toBeVisible();

    // Click "Send a new verification email"
    await page.getByRole('button', { name: 'Send a new verification email' }).click();
    await expect(page).toHaveURL(/\/auth/); // Goes back to auth
    // Wait, the button says "Back to login" or "Send a new verification email", and navigates to "/auth".
    // Then we login to get the pending screen and send a new email.
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', 'Password123!');
    await page.getByRole('button', { name: 'Sign In' }).click();
    
    await expect(page.getByText('Check your email')).toBeVisible();
    await page.getByRole('button', { name: 'Resend verification email' }).click();

    // Get new email
    const newEmailData = await getLatestMockEmail(request, baseURL as string, testEmail);
    const newToken = extractToken(newEmailData.verifyUrl);
    
    // Use new token -> succeeds
    await page.goto(`/verify-email?token=${newToken}`);
    await expect(page.getByText('Email Verified')).toBeVisible();
  });

  test('Test 4 - Invalid/reused token states', async ({ page, request, baseURL }) => {
    // Random token
    await page.goto('/verify-email?token=invalid123abc');
    await expect(page.getByText('Verification Failed')).toBeVisible();
    await expect(page.getByText('Invalid or expired token')).toBeVisible();

    // Reused token
    const testEmail = `reused_${Date.now()}@lifeloop.test`;
    await request.post(`${baseURL}/api/v1/auth/register`, {
      data: { email: testEmail, password: 'Password123!' }
    });
    const emailData = await getLatestMockEmail(request, baseURL as string, testEmail);
    const token = extractToken(emailData.verifyUrl);
    
    // First use
    await page.goto(`/verify-email?token=${token}`);
    await expect(page.getByText('Email Verified')).toBeVisible();
    
    // Make it explicitly out of the grace window in the DB to test the "already used" rejection
    const schemaName = process.env.TEST_SCHEMA || 'lifeloop_test_e2e';
    const connStr = process.env.TEST_DATABASE_URL!.replace("-pooler", "");
    const finalConnStr = connStr.includes("?") 
      ? `${connStr}&options=-c%20search_path%3D${schemaName}`
      : `${connStr}?options=-c%20search_path%3D${schemaName}`;
      
    const sql = postgres(finalConnStr, { max: 1 });
    try {
      const tokenHash = crypto.createHash('sha256').update(token!).digest('hex');
      // Set used_at to 6 minutes ago (grace window is 5 minutes)
      await sql`UPDATE email_verification_tokens SET used_at = NOW() - INTERVAL '6 minutes' WHERE token_hash = ${tokenHash}`;
    } finally {
      await sql.end();
    }
    
    // Second use (outside grace window)
    await page.goto(`/verify-email?token=${token}`);
    await expect(page.getByText('Verification Failed')).toBeVisible();
    await expect(page.getByText('Invalid or expired token')).toBeVisible();
  });

  test('Test 5 - Change email', async ({ page, request, baseURL }) => {
    const timestamp = Date.now();
    const wrongEmail = `wrong_${timestamp}@lifeloop.test`;
    const rightEmail = `right_${timestamp}@lifeloop.test`;

    // Register with wrong email
    await page.goto('/auth');
    await page.getByText('Need an account? Register').click();
    await page.fill('input[type="email"]', wrongEmail);
    await page.fill('input[type="password"]', 'Password123!');
    await page.getByRole('button', { name: 'Create Account' }).click();

    // Go to change email
    await expect(page.getByText('Check your email')).toBeVisible();
    await page.getByRole('button', { name: 'Change email' }).click();
    await expect(page.getByText('Change Email')).toBeVisible();
    
    // Enter new email
    await page.fill('input[type="email"]', rightEmail);
    await page.getByRole('button', { name: 'Update email' }).click();

    // Verify back to pending screen with new email
    await expect(page.getByText('Check your email')).toBeVisible();
    await expect(page.getByText(rightEmail)).toBeVisible();

    // Retrieve new email
    const newEmailData = await getLatestMockEmail(request, baseURL as string, rightEmail);
    expect(newEmailData).toBeDefined();
    
    const token = extractToken(newEmailData.verifyUrl);
    await page.goto(`/verify-email?token=${token}`);
    await expect(page.getByText('Email Verified')).toBeVisible();
  });

  test('Test 6 - Resend protection & rate limiting', async ({ page, request, baseURL }) => {
    const timestamp = Date.now();
    const testEmail = `rate_${timestamp}@lifeloop.test`;

    // Register via API
    await request.post(`${baseURL}/api/v1/auth/register`, {
      data: { email: testEmail, password: 'Password123!' }
    });

    // Login to get to pending
    await page.goto('/auth');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', 'Password123!');
    await page.getByRole('button', { name: 'Sign In' }).click();
    
    await expect(page.getByText('Check your email')).toBeVisible();

    // Spam the resend endpoint directly to hit the server-side rate limit
    // (UI disables the button, so we use API to test the server protection as requested: 
    // "server-side rate limit from Phase 1 is what actually stops abuse (assert on the eventual rate-limited response)")
    let lastStatus = 200;
    let rateLimited = false;
    
    for (let i = 0; i < 6; i++) {
      const res = await request.post(`${baseURL}/api/v1/auth/resend-verification`, {
        data: { email: testEmail }
      });
      lastStatus = res.status();
      if (lastStatus === 429) {
        rateLimited = true;
        break;
      }
    }
    
    // We should hit 429 Too Many Requests
    expect(rateLimited).toBe(true);
    expect(lastStatus).toBe(429);
  });
});
