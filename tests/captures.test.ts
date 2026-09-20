import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import { capturesRouter } from '../src/server/api/v1/captures';
import { db } from '../src/db';
import { users, captures } from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { inArray } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';

import { createTestApp } from './setup';

const app = createTestApp('/api/v1/captures', capturesRouter);

const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret_for_development_only";

describe('Capture API - Phase 1', () => {
  let testUserId: string;
  let otherUserId: string;
  let authCookie: string;
  let otherAuthCookie: string;

  beforeAll(async () => {
    testUserId = uuidv4();
    otherUserId = uuidv4();

    // Setup test users
    await db.insert(users).values([
      {
        id: testUserId,
        email: `cap_user1_${testUserId}@test.com`,
        passwordHash: 'dummy',
      },
      {
        id: otherUserId,
        email: `cap_user2_${otherUserId}@test.com`,
        passwordHash: 'dummy',
      },
    ]);

    const token1 = jwt.sign({ userId: testUserId }, JWT_SECRET);
    authCookie = `session=${token1}`;

    const token2 = jwt.sign({ userId: otherUserId }, JWT_SECRET);
    otherAuthCookie = `session=${token2}`;
  });

  afterAll(async () => {
    await db.delete(captures).where(inArray(captures.userId, [testUserId, otherUserId]));
    await db.delete(users).where(inArray(users.id, [testUserId, otherUserId]));
  });

  it('should reject unauthenticated requests', async () => {
    const res = await request(app).get('/api/v1/captures');
    expect(res.status).toBe(401);
  });

  it('should create a text capture successfully (persistence & upload)', async () => {
    const res = await request(app)
      .post('/api/v1/captures')
      .set('Cookie', authCookie)
      .send({ type: 'text', rawPayload: 'Hello World' });
    
    expect(res.status).toBe(201);
    expect(res.body.capture.type).toBe('text');
    expect(res.body.capture.rawPayload).toBe('Hello World');
    expect(res.body.capture.processingStatus).toBe('pending');
  });

  it('should upload a mock image file', async () => {
    const res = await request(app)
      .post('/api/v1/captures')
      .set('Cookie', authCookie)
      .field('type', 'image')
      .field('source', 'web')
      .attach('file', Buffer.from('fake image data'), 'test.png');
    
    expect(res.status).toBe(201);
    expect(res.body.capture.type).toBe('image');
    expect(res.body.capture.originalFilename).toBe('test.png');
    expect(res.body.capture.rawPayload).toContain('/uploads/');
  });

  it('should enforce data ownership', async () => {
    // User 1 creates a capture
    const res1 = await request(app)
      .post('/api/v1/captures')
      .set('Cookie', authCookie)
      .send({ type: 'text', rawPayload: 'User 1 Secret' });
    
    expect(res1.status).toBe(201);
    const captureId = res1.body.capture.id;

    // User 2 tries to delete it
    const delRes = await request(app)
      .delete(`/api/v1/captures/${captureId}`)
      .set('Cookie', otherAuthCookie);
    
    expect(delRes.status).toBe(404); // Should not find it or be authorized
  });

  it('should allow deletion of own capture', async () => {
    const res = await request(app)
      .post('/api/v1/captures')
      .set('Cookie', authCookie)
      .send({ type: 'text', rawPayload: 'To be deleted' });
    
    expect(res.status).toBe(201);
    const captureId = res.body.capture.id;

    const delRes = await request(app)
      .delete(`/api/v1/captures/${captureId}`)
      .set('Cookie', authCookie);
    
    expect(delRes.status).toBe(200);
  });

  it('should reject requests with missing payload', async () => {
    const res = await request(app)
      .post('/api/v1/captures')
      .set('Cookie', authCookie)
      .send({ type: 'text' }); // Missing rawPayload
    
    expect(res.status).toBe(400);
  });

});
