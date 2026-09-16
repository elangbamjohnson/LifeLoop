import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { db } from '../src/db';
import { users, captures, items } from '../src/db/schema';
import { eq, desc } from 'drizzle-orm';
import { capturesRouter } from '../src/server/api/v1/captures';
import { createTestApp } from './setup';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';

const app = createTestApp('/api/v1/captures', capturesRouter);
const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret_for_development_only";

describe('Phase 2: AI Classification & Error Handling', () => {
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
    // Delete cascading items first, then captures, then user
    const userItems = await db.select().from(items).where(eq(items.userId, testUserId));
    for (const item of userItems) {
      await db.delete(items).where(eq(items.id, item.id));
    }
    await db.delete(captures).where(eq(captures.userId, testUserId));
    await db.delete(users).where(eq(users.id, testUserId));
  });

  const uploadAndVerifyCaptureStatus = async (rawPayload: string, expectedStatus: string) => {
    const res = await request(app)
      .post('/api/v1/captures')
      .set('Cookie', authCookie)
      .send({ type: 'text', rawPayload });
    
    expect(res.status).toBe(201);
    const captureId = res.body.capture?.id;

    // AI Provider is async, poll for it to finish processing
    let updatedCapture: any;
    for (let i = 0; i < 20; i++) {
      await new Promise(resolve => setTimeout(resolve, 300));
      [updatedCapture] = await db.select().from(captures).where(eq(captures.id, captureId)).limit(1);
      if (updatedCapture && updatedCapture.processingStatus !== 'pending' && updatedCapture.processingStatus !== 'processing') {
        break;
      }
    }
    expect(updatedCapture.processingStatus).toBe(expectedStatus);

    return captureId;
  };

  it('should handle simulated LLM provider errors by marking capture as failed', async () => {
    await uploadAndVerifyCaptureStatus("This is a TEST_PROVIDER_ERROR", "failed");
  });

  it('should handle malformed JSON from LLM by marking capture as failed', async () => {
    await uploadAndVerifyCaptureStatus("This is a TEST_MALFORMED_JSON", "failed");
  });

  it('should handle empty/null response from LLM gracefully', async () => {
    const captureId = await uploadAndVerifyCaptureStatus("This is a TEST_NULL_RESPONSE", "completed");
    
    // An empty response should complete the capture but create NO items
    const createdItems = await db.select().from(items).where(eq(items.captureId, captureId));
    expect(createdItems.length).toBe(0);
  });
});
