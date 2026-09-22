// ordered scenario, tests share state
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { db } from '../src/db';
import { users, items } from '../src/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { authRouter } from '../src/server/api/v1/auth';
import { itemsRouter } from '../src/server/api/v1/items';
import { createTestApp } from './setup';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';

const app = createTestApp('/api/v1/auth', authRouter);

const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret_for_development_only";

describe('Phase 0: Authentication, Session Management & Authorization (P0/P1)', () => {
  const testUserAEmail = `autha_${uuidv4()}@example.com`;
  const testUserBEmail = `authb_${uuidv4()}@example.com`;
  const validPassword = 'SecurePassword123!';
  let userAId: string;
  let userBId: string;
  let userACookie: string;
  let userBCookie: string;
  let userAPrivateItemId: string;

  afterAll(async () => {
    // Deterministic cleanup
    if (userAPrivateItemId) {
      await db.delete(items).where(eq(items.id, userAPrivateItemId));
    }
    await db.delete(users).where(inArray(users.email, [testUserAEmail, testUserBEmail]));
  });

  // 1. Registration
  it('should successfully register a new user with valid email and password (HTTP-only cookie)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: testUserAEmail, password: validPassword });

    expect(res.status).toBe(201);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe(testUserAEmail.toLowerCase());
    expect(res.body.user.passwordHash).toBeUndefined(); // No secret leakage
    
    // Phase 7.5A-2: Registration now issues a session cookie immediately so the 
    // client can authenticate against /auth/me to poll for verification status.
    const cookies = Array.isArray(res.headers['set-cookie']) ? res.headers['set-cookie'] : [res.headers['set-cookie'] as string];
    expect(cookies).toBeDefined();
    expect(cookies.find((c: string) => c && c.startsWith('session='))).toBeDefined();
    
    userAId = res.body.user.id;

    // Activate user and login to get session cookie
    await db.update(users).set({ accountStatus: 'active' }).where(eq(users.id, userAId));
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: testUserAEmail, password: validPassword });

    // Verify session cookie
    const loginCookies = Array.isArray(loginRes.headers['set-cookie']) ? loginRes.headers['set-cookie'] : [loginRes.headers['set-cookie'] as string];
    expect(loginCookies).toBeDefined();
    const sessionCookie = loginCookies.find((c: string) => c && c.startsWith('session='));
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toContain('HttpOnly');

    // Extract cookie for authenticated requests
    userACookie = sessionCookie!.split(';')[0];
  });

  it('should reject registration when email is already in use', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: testUserAEmail, password: validPassword });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('already in use');
  });

  it('should reject registration with invalid email format or password under 8 characters', async () => {
    const resBadEmail = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'not-an-email', password: validPassword });
    expect(resBadEmail.status).toBe(400);
    expect(resBadEmail.body.error).toContain('Invalid email');

    const resShortPass = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: `valid_${uuidv4()}@example.com`, password: 'short' });
    expect(resShortPass.status).toBe(400);
    expect(resShortPass.body.error).toContain('at least 8 characters');
  });

  // 2. Login verification
  it('should successfully log in with correct email and password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: testUserAEmail, password: validPassword });

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(userAId);
    expect(res.body.user.email).toBe(testUserAEmail.toLowerCase());
    expect(res.body.user.passwordHash).toBeUndefined();

    const cookies = Array.isArray(res.headers['set-cookie']) ? res.headers['set-cookie'] : [res.headers['set-cookie'] as string];
    expect(cookies).toBeDefined();
    const sessionCookie = cookies.find((c: string) => c.startsWith('session='));
    expect(sessionCookie).toContain('HttpOnly');
  });

  it('should reject login with incorrect password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: testUserAEmail, password: 'WrongPassword999!' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid credentials');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('should reject login for nonexistent user without silently creating account', async () => {
    const nonexistentEmail = `ghost_${uuidv4()}@example.com`;
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: nonexistentEmail, password: validPassword });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid credentials');

    // Verify user was NOT created in DB
    const [found] = await db.select().from(users).where(eq(users.email, nonexistentEmail)).limit(1);
    expect(found).toBeUndefined();
  });

  it('should reject login with missing credentials', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: testUserAEmail }); // missing password

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Email and password required');
  });

  // 3. Session Validation
  it('should validate session and return current user via GET /api/v1/auth/me', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', userACookie);

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(userAId);
    expect(res.body.user.email).toBe(testUserAEmail.toLowerCase());
  });

  it('should reject request when session cookie has invalid/forged signature', async () => {
    const forgedToken = jwt.sign({ userId: userAId }, 'tampered_wrong_secret_key');
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', `session=${forgedToken}`);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid session');
  });

  it('should reject request when session token has expired', async () => {
    const expiredToken = jwt.sign({ userId: userAId }, JWT_SECRET, { expiresIn: -10 }); // Expired 10s ago
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', `session=${expiredToken}`);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Session expired');
  });

  // 4. Logout
  it('should log out user by clearing session cookie', async () => {
    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', userACookie);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify clear-cookie header expires the session
    const cookies = Array.isArray(res.headers['set-cookie']) ? res.headers['set-cookie'] : [res.headers['set-cookie'] as string];
    expect(cookies).toBeDefined();
    const sessionClear = cookies.find((c: string) => c.startsWith('session='));
    expect(sessionClear).toBeDefined();
    // Expiration date in past or empty value
    expect(sessionClear).toMatch(/session=;|Expires=|Max-Age=0/);
  });

  // 5. Genuine IDOR / Cross-User Access Prevention
  it('should prevent IDOR: User B cannot access User A private item', async () => {
    // Register User B
    const regB = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: testUserBEmail, password: validPassword });
    userBId = regB.body.user.id;
    await db.update(users).set({ accountStatus: 'active' }).where(eq(users.id, userBId));
    const loginB = await request(app).post('/api/v1/auth/login').send({ email: testUserBEmail, password: validPassword });
    const setCookiesB = Array.isArray(loginB.headers['set-cookie']) ? loginB.headers['set-cookie'] : [loginB.headers['set-cookie'] as string];
    const cookieB = setCookiesB.find((c: string) => c && c.startsWith('session='))!.split(';')[0];

    // User A creates a private item
    const itemRes = await request(app)
      .post('/api/v1/items')
      .set('Cookie', userACookie)
      .send({
        title: 'User A Private Financial Ledger',
        itemType: 'document',
        metadata: { secret: 'user_a_private_data' },
      });
    expect(itemRes.status).toBe(201);
    userAPrivateItemId = itemRes.body.item.id;

    // User A can access their own item
    const ownerFetch = await request(app)
      .get(`/api/v1/items/${userAPrivateItemId}`)
      .set('Cookie', userACookie);
    expect(ownerFetch.status).toBe(200);
    expect(ownerFetch.body.item.title).toBe('User A Private Financial Ledger');

    // User B attempts to access User A's private item -> MUST BE 404 Not Found (no visibility)
    const idorFetch = await request(app)
      .get(`/api/v1/items/${userAPrivateItemId}`)
      .set('Cookie', cookieB);
    expect(idorFetch.status).toBe(404);
    expect(idorFetch.body.error).toContain('Item not found');

    // User B attempts to update User A's private item -> MUST BE 404/403
    const idorPatch = await request(app)
      .patch(`/api/v1/items/${userAPrivateItemId}`)
      .set('Cookie', cookieB)
      .send({ title: 'Hacked by User B' });
    expect(idorPatch.status).toBe(404);

    // User B attempts to delete User A's private item -> MUST BE 404/403
    const idorDelete = await request(app)
      .delete(`/api/v1/items/${userAPrivateItemId}`)
      .set('Cookie', cookieB);
    expect(idorDelete.status).toBe(404);
  });
});
