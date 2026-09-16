import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { db } from '../src/db';
import { users } from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { capturesRouter } from '../src/server/api/v1/captures';
import { createTestApp } from './setup';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';

const app = createTestApp('/api/v1/captures', capturesRouter);
const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret_for_development_only";

describe('Phase 1: Captures Edge Cases', () => {
  const testUserId = uuidv4();
  const testEmail = `test_${testUserId}@example.com`;
  let authCookie: string;

  beforeAll(async () => {
    await db.insert(users).values({
      id: testUserId,
      email: testEmail,
      passwordHash: 'dummy_hash',
    });
    const token = jwt.sign({ userId: testUserId }, JWT_SECRET);
    authCookie = `session=${token}`;
  });

  afterAll(async () => {
    await db.delete(users).where(eq(users.id, testUserId));
  });

  it('should reject text payloads exceeding the 10,000 character limit', async () => {
    const hugePayload = 'A'.repeat(10001);
    const res = await request(app)
      .post('/api/v1/captures')
      .set('Cookie', authCookie)
      .send({ type: 'text', rawPayload: hugePayload });
      
    expect(res.status).toBe(400);
    const errText = typeof res.body.error === 'string' ? res.body.error : (res.body.error?.message || JSON.stringify(res.body));
    expect(errText).toContain('10,000 characters');
  });

});
