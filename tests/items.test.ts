import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import { itemsRouter } from '../src/server/api/v1/items';
import { db } from '../src/db';
import { users, items } from '../src/db/schema';
import { eq } from 'drizzle-orm';

import { v4 as uuidv4 } from 'uuid';

import { createTestApp } from './setup';

const app = createTestApp('/api/v1/items', itemsRouter);

const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret_for_development_only";

describe('Items API - Phase 2', () => {
  let testUserId: string;
  let authCookie: string;
  let otherUserId: string;
  let otherAuthCookie: string;
  let itemIdToEdit: string;

  beforeAll(async () => {
    testUserId = uuidv4();
    otherUserId = uuidv4();

    // Setup test users
    await db.insert(users).values([
      {
        id: testUserId,
        email: `test_items_${testUserId}@test.com`,
        passwordHash: 'dummy'
      },
      {
        id: otherUserId,
        email: `test_other_${otherUserId}@test.com`,
        passwordHash: 'dummy'
      }
    ]);

    authCookie = `session=${jwt.sign({ userId: testUserId }, JWT_SECRET)}`;
    otherAuthCookie = `session=${jwt.sign({ userId: otherUserId }, JWT_SECRET)}`;
    
    // Seed an item via API for testUserId
    const createRes = await request(app)
      .post('/api/v1/items')
      .set('Cookie', authCookie)
      .send({
        title: "Garbage AI Extraction",
        itemType: "task",
        status: "pending_review",
        confidenceScore: 0.2,
        metadata: {}
      });
    
    expect(createRes.status, JSON.stringify(createRes.body)).toBe(201);
    expect(createRes.body.item.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    itemIdToEdit = createRes.body.item.id;
  });

  afterAll(async () => {
    await db.delete(items).where(eq(items.userId, testUserId));
    await db.delete(users).where(eq(users.id, testUserId));
    await db.delete(users).where(eq(users.id, otherUserId));
  });

  it('should list items', async () => {
    const res = await request(app).get('/api/v1/items').set('Cookie', authCookie);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
  });

  it('should allow user to update an item status (Approve)', async () => {
    const res = await request(app)
      .patch(`/api/v1/items/${itemIdToEdit}`)
      .set('Cookie', authCookie)
      .send({ status: 'active', title: 'Manually corrected title' });
    
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.item.status).toBe('active');
    expect(res.body.item.title).toBe('Manually corrected title');
  });

  it('GET /api/v1/items/:id - unrelated user cannot view private item (no information leakage)', async () => {
    const res = await request(app)
      .get(`/api/v1/items/${itemIdToEdit}`)
      .set('Cookie', otherAuthCookie);
    
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(res.body.item).toBeUndefined();
  });

  it('PATCH /api/v1/items/:id - unrelated user cannot update item', async () => {
    const res = await request(app)
      .patch(`/api/v1/items/${itemIdToEdit}`)
      .set('Cookie', otherAuthCookie)
      .send({ title: 'Hacked Title by Unrelated User' });
    
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(res.body.item).toBeUndefined();

    // Verify item in db was not modified
    const [dbItem] = await db.select().from(items).where(eq(items.id, itemIdToEdit));
    expect(dbItem.title).not.toBe('Hacked Title by Unrelated User');
  });

  it('DELETE /api/v1/items/:id - unrelated user cannot delete item', async () => {
    const res = await request(app)
      .delete(`/api/v1/items/${itemIdToEdit}`)
      .set('Cookie', otherAuthCookie);
    
    expect(res.status, JSON.stringify(res.body)).toBe(404);

    // Verify item in db still exists and is unchanged
    const [dbItem] = await db.select().from(items).where(eq(items.id, itemIdToEdit));
    expect(dbItem).toBeDefined();
    expect(dbItem.title).not.toBe('Hacked Title');
  });

  it('POST /api/v1/items/:id/snooze - unrelated user cannot snooze item', async () => {
    const res = await request(app)
      .post(`/api/v1/items/${itemIdToEdit}/snooze`)
      .set('Cookie', otherAuthCookie)
      .send({ snoozeDays: 3 });
    
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(res.body.item).toBeUndefined();

    // Verify item is unchanged
    const [dbItem] = await db.select().from(items).where(eq(items.id, itemIdToEdit));
    expect(dbItem.snoozedUntil).toBeNull();
  });

  it('POST /api/v1/items/:id/complete - unrelated user cannot complete item', async () => {
    const res = await request(app)
      .post(`/api/v1/items/${itemIdToEdit}/complete`)
      .set('Cookie', otherAuthCookie)
      .send({ completed: true });
    
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(res.body.item).toBeUndefined();

    // Verify item is unchanged
    const [dbItem] = await db.select().from(items).where(eq(items.id, itemIdToEdit));
    expect(dbItem.status).toBe('active');
  });

  it('PATCH /api/v1/items/:id (archive) - unrelated user cannot archive item', async () => {
    const res = await request(app)
      .patch(`/api/v1/items/${itemIdToEdit}`)
      .set('Cookie', otherAuthCookie)
      .send({ status: 'archived' });

    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(res.body.item).toBeUndefined();

    // Verify item is unchanged
    const [dbItem] = await db.select().from(items).where(eq(items.id, itemIdToEdit));
    expect(dbItem.status).toBe('active');
  });

  describe('Non-existent Item Operations', () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    
    it('PATCH /api/v1/items/:id - non-existent item returns 404', async () => {
      const res = await request(app)
        .patch(`/api/v1/items/${fakeId}`)
        .set('Cookie', authCookie)
        .send({ status: 'active' });
      expect(res.status, JSON.stringify(res.body)).toBe(404);
    });

    it('DELETE /api/v1/items/:id - non-existent item returns 404', async () => {
      const res = await request(app)
        .delete(`/api/v1/items/${fakeId}`)
        .set('Cookie', authCookie);
      expect(res.status, JSON.stringify(res.body)).toBe(404);
    });

    it('POST /api/v1/items/:id/snooze - non-existent item returns 404', async () => {
      const res = await request(app)
        .post(`/api/v1/items/${fakeId}/snooze`)
        .set('Cookie', authCookie)
        .send({ snoozeDays: 3 });
      expect(res.status, JSON.stringify(res.body)).toBe(404);
    });

    it('POST /api/v1/items/:id/complete - non-existent item returns 404', async () => {
      const res = await request(app)
        .post(`/api/v1/items/${fakeId}/complete`)
        .set('Cookie', authCookie)
        .send({ completed: true });
      expect(res.status, JSON.stringify(res.body)).toBe(404);
    });
  });

  describe('Malformed ID Operations', () => {
    const malformedId = 'not-a-uuid';

    it('PATCH /api/v1/items/:id - malformed id returns 400', async () => {
      const res = await request(app)
        .patch(`/api/v1/items/${malformedId}`)
        .set('Cookie', authCookie)
        .send({ status: 'active' });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
    });

    it('DELETE /api/v1/items/:id - malformed id returns 400', async () => {
      const res = await request(app)
        .delete(`/api/v1/items/${malformedId}`)
        .set('Cookie', authCookie);
      expect(res.status, JSON.stringify(res.body)).toBe(400);
    });
  });
});
