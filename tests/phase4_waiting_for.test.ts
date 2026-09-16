import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { db } from '../src/db';
import { users, captures, items, reminders } from '../src/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { capturesRouter } from '../src/server/api/v1/captures';
import { itemsRouter } from '../src/server/api/v1/items';
import { remindersRouter } from '../src/server/api/v1/reminders';
import { createTestApp } from './setup';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';

const app = createTestApp('/api/v1/captures', capturesRouter);

const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret_for_development_only";

describe('Phase 4: Waiting For Lifecycle & Verification', () => {
  const userAId = uuidv4();
  const userBId = uuidv4();
  let authCookieA: string;
  let authCookieB: string;

  let manualWaitingItemId: string;
  let aiWaitingItemId: string;

  beforeAll(async () => {
    await db.insert(users).values([
      { id: userAId, email: `waiting_a_${userAId}@example.com`, passwordHash: 'hashA' },
      { id: userBId, email: `waiting_b_${userBId}@example.com`, passwordHash: 'hashB' },
    ]);
    authCookieA = `session=${jwt.sign({ userId: userAId }, JWT_SECRET)}`;
    authCookieB = `session=${jwt.sign({ userId: userBId }, JWT_SECRET)}`;
  });

  afterAll(async () => {
    await db.delete(reminders).where(inArray(reminders.userId, [userAId, userBId]));
    await db.delete(items).where(inArray(items.userId, [userAId, userBId]));
    await db.delete(captures).where(inArray(captures.userId, [userAId, userBId]));
    await db.delete(users).where(inArray(users.id, [userAId, userBId]));
  });

  // 1. AI Detection
  it('should extract WaitingFor candidate from "waiting on someone" capture', async () => {
    const res = await request(app)
      .post('/api/v1/captures')
      .set('Cookie', authCookieA)
      .send({ type: 'text', rawPayload: 'waiting on Bob for the refund' });
    
    expect(res.status).toBe(201);
    const captureId = res.body.capture.id;

    await new Promise(resolve => setTimeout(resolve, 1500)); // AI mock delay

    const createdItems = await db.select().from(items).where(eq(items.captureId, captureId));
    expect(createdItems.length).toBe(1);
    
    const item = createdItems[0];
    expect(item.itemType).toBe('waiting_for');
    expect((item.metadata as any).waitingFor).toContain('Bob');
    expect((item.metadata as any).isWaitingFor).toBe(true);
    aiWaitingItemId = item.id;
  });

  // 2. User Confirmation
  it('should allow user confirmation and status transition of AI candidate to active', async () => {
    const res = await request(app)
      .patch(`/api/v1/items/${aiWaitingItemId}`)
      .set('Cookie', authCookieA)
      .send({
        status: 'active',
        title: 'Refund from Bob (Confirmed)',
      });

    expect(res.status).toBe(200);
    expect(res.body.item.status).toBe('active');
    expect(res.body.item.title).toBe('Refund from Bob (Confirmed)');
  });

  // 3. Manual Creation
  it('should manually create a WaitingFor item via POST /api/v1/items', async () => {
    const expectedReplyDate = new Date(Date.now() + 7 * 86400000).toISOString();
    const res = await request(app)
      .post('/api/v1/items')
      .set('Cookie', authCookieA)
      .send({
        title: 'Waiting for Landlord Security Deposit',
        itemType: 'waiting_for',
        status: 'active',
        dueDate: expectedReplyDate,
        metadata: {
          waitingFor: 'Landlord Mr. Smith',
          organization: 'Apex Properties',
          contactChannel: 'email',
          notes: 'Sent final walkthrough checklist',
        },
      });

    expect(res.status).toBe(201);
    expect(res.body.item.itemType).toBe('waiting_for');
    expect(res.body.item.title).toBe('Waiting for Landlord Security Deposit');
    expect(res.body.item.metadata.waitingFor).toBe('Landlord Mr. Smith');
    manualWaitingItemId = res.body.item.id;
  });

  // 4. Editing Metadata & Expected Deadline
  it('should allow editing WaitingFor item details and deadline', async () => {
    const newDueDate = new Date(Date.now() + 14 * 86400000).toISOString();
    const res = await request(app)
      .patch(`/api/v1/items/${manualWaitingItemId}`)
      .set('Cookie', authCookieA)
      .send({
        title: 'Waiting for Landlord Security Deposit (Extended)',
        dueDate: newDueDate,
        metadata: {
          waitingFor: 'Landlord Mr. Smith',
          organization: 'Apex Properties',
          notes: 'Agreed to 7-day extension for bank check delivery',
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.item.title).toContain('Extended');
    expect(new Date(res.body.item.dueDate).toISOString()).toBe(newDueDate);
    expect(res.body.item.metadata.notes).toContain('extension');
  });

  // 5. Completion / Received State
  it('should mark WaitingFor item as completed when response/item is received', async () => {
    const res = await request(app)
      .post(`/api/v1/items/${manualWaitingItemId}/complete`)
      .set('Cookie', authCookieA)
      .send({ completed: true });

    expect(res.status).toBe(200);
    expect(res.body.item.status).toBe('completed');
    expect(res.body.item.completedAt).toBeTruthy();
  });

  // 6. Cancellation / Archive
  it('should allow archiving/cancelling a WaitingFor item', async () => {
    const res = await request(app)
      .patch(`/api/v1/items/${manualWaitingItemId}`)
      .set('Cookie', authCookieA)
      .send({ status: 'archived' });

    expect(res.status).toBe(200);
    expect(res.body.item.status).toBe('archived');
  });

  // 7. Overdue Calculation
  it('should display overdue WaitingFor items in timeline needsAttention/waitingFor', async () => {
    // Insert an overdue waiting_for item (expected reply 4 days ago)
    const [overdueWaiting] = await db.insert(items).values({
      userId: userAId,
      title: 'Overdue Vendor Quote from Acme',
      itemType: 'waiting_for',
      status: 'active',
      dueDate: new Date(Date.now() - 4 * 86400000),
      metadata: { waitingFor: 'Acme Corp', isWaitingFor: true },
    }).returning();

    const res = await request(app)
      .get('/api/v1/items/timeline')
      .set('Cookie', authCookieA);

    expect(res.status).toBe(200);
    const waitingForSection = res.body.timeline.waitingFor;
    const needsAttention = res.body.timeline.needsAttention;
    
    // Must be in timeline
    const foundInTimeline = waitingForSection.some((i: any) => i.id === overdueWaiting.id) ||
                            needsAttention.some((i: any) => i.id === overdueWaiting.id);
    expect(foundInTimeline).toBe(true);

    await db.delete(items).where(eq(items.id, overdueWaiting.id));
  });

  // 8. Follow-Up Reminders
  it('should attach follow-up reminders to a WaitingFor item', async () => {
    const res = await request(app)
      .post('/api/v1/reminders')
      .set('Cookie', authCookieA)
      .send({
        itemId: manualWaitingItemId,
        title: 'Follow up with Landlord if no response',
        scheduledAt: new Date(Date.now() + 3 * 86400000).toISOString(),
        channel: 'web',
      });

    expect(res.status).toBe(201);
    expect(res.body.reminder.title).toContain('Follow up');
    expect(res.body.reminder.itemId).toBe(manualWaitingItemId);

    // Verify reminder is fetched via item reminders route
    const listRes = await request(app)
      .get(`/api/v1/items/${manualWaitingItemId}/reminders`)
      .set('Cookie', authCookieA);

    expect(listRes.status).toBe(200);
    expect(listRes.body.reminders.length).toBeGreaterThan(0);
  });

  // 9. Cross-User Isolation
  it('should strictly isolate WaitingFor items between users', async () => {
    // User B attempts to access User A's waiting item
    const getRes = await request(app)
      .get(`/api/v1/items/${manualWaitingItemId}`)
      .set('Cookie', authCookieB);
    expect(getRes.status).toBe(403);

    // User B attempts to patch User A's waiting item
    const patchRes = await request(app)
      .patch(`/api/v1/items/${manualWaitingItemId}`)
      .set('Cookie', authCookieB)
      .send({ title: 'Hacked by User B' });
    expect(patchRes.status).toBe(404);
  });
});
