import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { db } from '../src/db';
import { users } from '../src/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { authRouter } from '../src/server/api/v1/auth';
import { askRouter } from '../src/server/api/v1/ask';
import { createTestApp } from './setup';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import express from 'express';
import cookieParser from 'cookie-parser';

const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret_for_development_only";

function createCombinedApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/ask', askRouter);
  return app;
}

const app = createCombinedApp();

describe('Admin Access & Privileges (Vitest Integration)', () => {
  const regularUserId = uuidv4();
  const adminUserId = uuidv4();
  const tamperUserId = uuidv4();

  const regularEmail = `regular_${regularUserId}@example.com`;
  const adminEmail = `admin_${adminUserId}@example.com`;
  const tamperEmail = `tamper_${tamperUserId}@example.com`;
  const password = 'Password123!';

  let regularCookie: string;
  let adminCookie: string;

  beforeAll(async () => {
    await db.insert(users).values([
      { id: regularUserId, email: regularEmail, passwordHash: 'hashRegular', isAdmin: false },
      { id: adminUserId, email: adminEmail, passwordHash: 'hashAdmin', isAdmin: true },
    ]);

    regularCookie = `session=${jwt.sign({ userId: regularUserId }, JWT_SECRET)}`;
    adminCookie = `session=${jwt.sign({ userId: adminUserId }, JWT_SECRET)}`;
  });

  afterAll(async () => {
    await db.delete(users).where(inArray(users.email, [regularEmail, adminEmail, tamperEmail]));
  });

  describe('Gating POST /api/v1/ask', () => {
    it('should return 401 Unauthorized for unauthenticated requests', async () => {
      const res = await request(app)
        .post('/api/v1/ask')
        .send({ question: 'What are my priorities?' });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Unauthorized' });
    });

    it('should return 403 Forbidden for authenticated non-admin users', async () => {
      const res = await request(app)
        .post('/api/v1/ask')
        .set('Cookie', regularCookie)
        .send({ question: 'What are my priorities?' });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'Forbidden' });
    });

    it('should return 200 for authenticated admin users', async () => {
      const res = await request(app)
        .post('/api/v1/ask')
        .set('Cookie', adminCookie)
        .send({ question: 'What are my priorities?' });

      expect(res.status).toBe(200);
      expect(res.body).toBeDefined();
      expect(res.body.answer).toBeDefined();
    });
  });

  describe('Registration & Profile Security', () => {
    it('should ignore isAdmin in registration body and create user as non-admin', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: tamperEmail,
          password,
          isAdmin: true,
          is_admin: true,
        });

      expect(res.status).toBe(201);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.isAdmin).toBe(false);

      // Verify in DB directly
      const [dbUser] = await db.select().from(users).where(eq(users.email, tamperEmail)).limit(1);
      expect(dbUser).toBeDefined();
      expect(dbUser.isAdmin).toBe(false);
    });

    it('should return user.isAdmin in /auth/me for both admin and non-admin', async () => {
      const resRegular = await request(app)
        .get('/api/v1/auth/me')
        .set('Cookie', regularCookie);

      expect(resRegular.status).toBe(200);
      expect(resRegular.body.user.isAdmin).toBe(false);

      const resAdmin = await request(app)
        .get('/api/v1/auth/me')
        .set('Cookie', adminCookie);

      expect(resAdmin.status).toBe(200);
      expect(resAdmin.body.user.isAdmin).toBe(true);
    });

    it('should return user.isAdmin in /auth/login', async () => {
      await db.update(users).set({ accountStatus: 'active' }).where(eq(users.email, tamperEmail));
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: tamperEmail, password });

      expect(res.status).toBe(200);
      expect(res.body.user.isAdmin).toBe(false);
    });
  });

  describe('Dynamic DB Revocation (Loading is_admin from DB on each request)', () => {
    it('should revoke access immediately on active session when is_admin is toggled to false in DB', async () => {
      // 1. Initially admin can access Ask
      const res1 = await request(app)
        .post('/api/v1/ask')
        .set('Cookie', adminCookie)
        .send({ question: 'Can I access this?' });
      expect(res1.status).toBe(200);

      // 2. Revoke admin privilege in DB
      await db.update(users).set({ isAdmin: false }).where(eq(users.id, adminUserId));

      // 3. Same active session without re-login immediately receives 403 Forbidden
      const res2 = await request(app)
        .post('/api/v1/ask')
        .set('Cookie', adminCookie)
        .send({ question: 'Can I access this?' });
      expect(res2.status).toBe(403);
      expect(res2.body).toEqual({ error: 'Forbidden' });

      // 4. Restore admin privilege for teardown consistency
      await db.update(users).set({ isAdmin: true }).where(eq(users.id, adminUserId));
    });
  });
});
