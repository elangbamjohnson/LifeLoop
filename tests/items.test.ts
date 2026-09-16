import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import { itemsRouter } from '../src/server/api/v1/items';
import { db } from '../src/db';
import { users, items } from '../src/db/schema';
import { eq } from 'drizzle-orm';

import { createTestApp } from './setup';

const app = createTestApp('/api/v1/items', itemsRouter);

const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret_for_development_only";

describe('Items API - Phase 2', () => {
  let testUserId: string;
  let authCookie: string;
  let itemIdToEdit: string;

  beforeAll(async () => {
    // Setup test users
    const [user1] = await db.insert(users).values({
      email: `test_items_${Date.now()}@test.com`,
      passwordHash: 'dummy'
    }).returning();
    testUserId = user1.id;
    const token1 = jwt.sign({ userId: user1.id }, JWT_SECRET);
    authCookie = `session=${token1}`;
    
    // Seed an item directly
    const [seeded] = await db.insert(items).values({
      userId: testUserId,
      title: "Garbage AI Extraction",
      itemType: "task",
      status: "pending_review",
      confidenceScore: 0.2,
      metadata: {}
    }).returning();
    
    itemIdToEdit = seeded.id;
  });

  afterAll(async () => {
    await db.delete(items).where(eq(items.userId, testUserId));
    await db.delete(users).where(eq(users.id, testUserId));
  });

  it('should list items', async () => {
    const res = await request(app).get('/api/v1/items').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
  });

  it('should allow user to update an item status (Approve)', async () => {
    const res = await request(app)
      .patch(`/api/v1/items/${itemIdToEdit}`)
      .set('Cookie', authCookie)
      .send({ status: 'active', title: 'Manually corrected title' });
    
    expect(res.status).toBe(200);
    expect(res.body.item.status).toBe('active');
    expect(res.body.item.title).toBe('Manually corrected title');
  });

});
