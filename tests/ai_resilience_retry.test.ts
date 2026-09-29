import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { db } from "../src/db";
import { users, captures, items, reminders } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { aiProvider, enrichExistingItems } from "../src/server/services/AIProvider";
import { captureRetryService } from "../src/server/services/CaptureRetryService";
import { itemsRouter } from "../src/server/api/v1/items";
import { createTestApp } from "./setup";

const app = createTestApp("/api/v1/items", itemsRouter);
const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret_for_development_only";

describe("AI Resilience: Immediate Fallback & Background Retry (Option C)", () => {
  const testUserId = uuidv4();
  const testEmail = `resilience_${testUserId}@example.com`;

  beforeAll(async () => {
    await db.insert(users).values({
      id: testUserId,
      email: testEmail,
      passwordHash: "dummy_hash",
      settings: {
        autoReminders: true,
        timezone: "America/New_York",
      },
    });
  });

  afterAll(async () => {
    await db.delete(reminders).where(eq(reminders.userId, testUserId));
    const userCaptures = await db.select().from(captures).where(eq(captures.userId, testUserId));
    for (const c of userCaptures) {
      await db.delete(items).where(eq(items.captureId, c.id));
    }
    await db.delete(captures).where(eq(captures.userId, testUserId));
    await db.delete(users).where(eq(users.id, testUserId));
  });

  it("should extract items and set isFallbackItem flag when fallback is invoked", async () => {
    const [capture] = await db.insert(captures).values({
      userId: testUserId,
      source: "web",
      type: "text",
      rawPayload: "Dentist appointment next Monday at 2pm",
      processingStatus: "pending",
    }).returning();

    const result = await aiProvider.processCapture(
      capture.id,
      testUserId,
      capture.rawPayload,
      capture.type,
      "America/New_York",
      { isFallback: true }
    );

    expect(result.fallback).toBe(true);
    expect(result.itemCount).toBeGreaterThan(0);

    const savedItems = await db.select().from(items).where(eq(items.captureId, capture.id));
    expect(savedItems.length).toBeGreaterThan(0);
    const meta = savedItems[0].metadata as any;
    expect(meta.isFallbackItem).toBe(true);
  });

  it("should successfully enrich unmodified fallback items and mark capture completed on retry", async () => {
    const [capture] = await db.insert(captures).values({
      userId: testUserId,
      source: "web",
      type: "text",
      rawPayload: "Dentist Oct 5 at 4pm",
      processingStatus: "fallback_pending_retry",
      retryCount: 0,
      nextRetryAt: new Date(Date.now() - 1000), // ready for retry now
    }).returning();

    // Initial fallback extraction
    await aiProvider.processCapture(
      capture.id,
      testUserId,
      capture.rawPayload,
      capture.type,
      "America/New_York",
      { isFallback: true }
    );

    const itemsBefore = await db.select().from(items).where(eq(items.captureId, capture.id));
    expect(itemsBefore.length).toBe(1);
    const initialItemId = itemsBefore[0].id;

    // Run retry sweep
    const processed = await captureRetryService.runRetrySweep();
    expect(processed).toBeGreaterThan(0);

    // Verify capture is now completed
    const [updatedCapture] = await db.select().from(captures).where(eq(captures.id, capture.id)).limit(1);
    expect(updatedCapture.processingStatus).toBe("completed");
    expect(updatedCapture.nextRetryAt).toBeNull();
    expect((updatedCapture.metadata as any)?.aiEnriched).toBe(true);

    // Verify item was updated in place (retaining original ID)
    const itemsAfter = await db.select().from(items).where(eq(items.captureId, capture.id));
    expect(itemsAfter.length).toBe(1);
    expect(itemsAfter[0].id).toBe(initialItemId);
    expect(itemsAfter[0].title).toBe("Dentist Appointment");
    expect(itemsAfter[0].itemType).toBe("appointment");
    expect((itemsAfter[0].metadata as any)?.enriched).toBe(true);
  });

  it("should preserve user-edited items during retry (Option C safeguard)", async () => {
    const [capture] = await db.insert(captures).values({
      userId: testUserId,
      source: "web",
      type: "text",
      rawPayload: "Dentist checkup next week",
      processingStatus: "fallback_pending_retry",
      retryCount: 0,
      nextRetryAt: new Date(Date.now() - 1000),
    }).returning();

    // Initial fallback
    await aiProvider.processCapture(
      capture.id,
      testUserId,
      capture.rawPayload,
      capture.type,
      "America/New_York",
      { isFallback: true }
    );

    const [fallbackItem] = await db.select().from(items).where(eq(items.captureId, capture.id)).limit(1);

    // Simulate user editing the item
    const customUserTitle = "My Custom Dentist Note (User Edited)";
    await db.update(items).set({
      title: customUserTitle,
      metadata: { userEdited: true, customNote: "Don't change this" },
      updatedAt: new Date(),
    }).where(eq(items.id, fallbackItem.id));

    // Run retry
    await captureRetryService.retryCapture(capture);

    // Verify user title was NOT overwritten
    const [itemAfterRetry] = await db.select().from(items).where(eq(items.id, fallbackItem.id)).limit(1);
    expect(itemAfterRetry.title).toBe(customUserTitle);
    expect((itemAfterRetry.metadata as any)?.customNote).toBe("Don't change this");
  });

  it("should mark capture completed with aiEnrichmentFailed=true when max retries are exhausted", async () => {
    const [capture] = await db.insert(captures).values({
      userId: testUserId,
      source: "web",
      type: "text",
      rawPayload: "TEST_RETRY_FAIL Dentist note",
      processingStatus: "fallback_pending_retry",
      retryCount: 2, // 2 prior attempts, next failure hits max 3
      nextRetryAt: new Date(Date.now() - 1000),
    }).returning();

    // Initial fallback item
    await aiProvider.processCapture(
      capture.id,
      testUserId,
      capture.rawPayload,
      capture.type,
      "America/New_York",
      { isFallback: true }
    );

    await captureRetryService.retryCapture(capture);

    const [updatedCapture] = await db.select().from(captures).where(eq(captures.id, capture.id)).limit(1);
    // As per Option C: Never left as failed or pending forever
    expect(updatedCapture.processingStatus).toBe("completed");
    expect(updatedCapture.retryCount).toBe(3);
    expect(updatedCapture.nextRetryAt).toBeNull();
    expect((updatedCapture.metadata as any)?.aiEnrichmentFailed).toBe(true);

    // Items from fallback still exist and are usable
    const userItems = await db.select().from(items).where(eq(items.captureId, capture.id));
    expect(userItems.length).toBeGreaterThan(0);
  });

  it("should successfully re-enrich capture when retry is re-triggered after prior exhaustion", async () => {
    // 1. Capture that previously exhausted retries
    const [capture] = await db.insert(captures).values({
      userId: testUserId,
      source: "web",
      type: "text",
      rawPayload: "Dentist appointment tomorrow at 10am",
      processingStatus: "completed",
      retryCount: 3,
      metadata: { aiEnrichmentFailed: true },
    }).returning();

    // Initial fallback item created during offline / invalid key
    await aiProvider.processCapture(
      capture.id,
      testUserId,
      capture.rawPayload,
      capture.type,
      "America/New_York",
      { isFallback: true }
    );

    const [initialItem] = await db.select().from(items).where(eq(items.captureId, capture.id)).limit(1);
    expect(initialItem.status).toBe("pending_review");

    // 2. User resets and triggers retry (same logic as POST /api/v1/captures/:id/retry)
    await db.update(captures).set({
      processingStatus: "fallback_pending_retry",
      retryCount: 0,
      metadata: { ...(capture.metadata as any || {}), aiEnrichmentFailed: false },
    }).where(eq(captures.id, capture.id));

    const [updatedCapture] = await db.select().from(captures).where(eq(captures.id, capture.id)).limit(1);
    const success = await captureRetryService.retryCapture(updatedCapture);
    expect(success).toBe(true);

    // 3. Item is now enriched, status is active, and capture is completed without aiEnrichmentFailed
    const [enrichedItem] = await db.select().from(items).where(eq(items.captureId, capture.id)).limit(1);
    expect(enrichedItem.status).toBe("active");
    expect(enrichedItem.confidenceScore).toBeGreaterThanOrEqual(0.8);

    const [finalCapture] = await db.select().from(captures).where(eq(captures.id, capture.id)).limit(1);
    expect(finalCapture.processingStatus).toBe("completed");
    expect((finalCapture.metadata as any)?.aiEnriched).toBe(true);
    expect((finalCapture.metadata as any)?.aiEnrichmentFailed).toBe(false);
  });

  it("should NOT create auto-reminders for fallback items in pending_review, but creates/reschedules on enrichment", async () => {
    const [capture] = await db.insert(captures).values({
      userId: testUserId,
      source: "web",
      type: "text",
      rawPayload: "Dentist Oct 15 at 10am",
      processingStatus: "fallback_pending_retry",
      retryCount: 0,
      nextRetryAt: new Date(Date.now() - 1000),
    }).returning();

    // Fallback extraction
    await aiProvider.processCapture(
      capture.id,
      testUserId,
      capture.rawPayload,
      capture.type,
      "America/New_York",
      { isFallback: true }
    );

    const [fallbackItem] = await db.select().from(items).where(eq(items.captureId, capture.id)).limit(1);
    expect(fallbackItem.status).toBe("pending_review");

    // Gate verification: ZERO reminders created for pending_review fallback item
    const remindersBefore = await db.select().from(reminders).where(eq(reminders.itemId, fallbackItem.id));
    expect(remindersBefore.length).toBe(0);

    // Now trigger background retry which enriches the item with confirmed date and active status
    await captureRetryService.retryCapture(capture);

    const remindersAfter = await db.select().from(reminders).where(eq(reminders.itemId, fallbackItem.id));
    expect(remindersAfter.length).toBeGreaterThan(0);
  });

  it("should detect fast user edit via PATCH within 2 seconds using explicit userEdited flag", async () => {
    const [capture] = await db.insert(captures).values({
      userId: testUserId,
      source: "web",
      type: "text",
      rawPayload: "Oil change appointment",
      processingStatus: "fallback_pending_retry",
      retryCount: 0,
      nextRetryAt: new Date(Date.now() - 1000),
    }).returning();

    // Fallback extraction
    await aiProvider.processCapture(
      capture.id,
      testUserId,
      capture.rawPayload,
      capture.type,
      "America/New_York",
      { isFallback: true }
    );

    const [fallbackItem] = await db.select().from(items).where(eq(items.captureId, capture.id)).limit(1);

    // Fast-but-real user edit via PATCH endpoint within < 2 seconds of creation
    const token = jwt.sign({ userId: testUserId }, JWT_SECRET);

    const res = await request(app)
      .patch(`/api/v1/items/${fallbackItem.id}`)
      .set("Cookie", `session=${token}`)
      .send({ title: "Quickly Edited Oil Change (Under 2s)" });

    expect(res.status).toBe(200);
    expect(res.body.item.metadata?.userEdited).toBe(true);

    // Verify time difference between creation and edit is strictly less than 2000ms
    // Under the old heuristic (timeDiff >= 2000), this edit would have been overwritten!
    const [editedDbItem] = await db.select().from(items).where(eq(items.id, fallbackItem.id)).limit(1);
    const timeDiff = Math.abs(editedDbItem.updatedAt.getTime() - editedDbItem.createdAt.getTime());
    expect(timeDiff).toBeLessThan(2000);

    // Trigger retry
    await captureRetryService.retryCapture(capture);

    // Verify user's edited title was preserved
    const [afterRetry] = await db.select().from(items).where(eq(items.id, fallbackItem.id)).limit(1);
    expect(afterRetry.title).toBe("Quickly Edited Oil Change (Under 2s)");
    expect((afterRetry.metadata as any)?.userEdited).toBe(true);
  });

  it("should maintain stable ordering and pairing when AI retry returns 3 items reordered", async () => {
    const [capture] = await db.insert(captures).values({
      userId: testUserId,
      source: "web",
      type: "text",
      rawPayload: "1. Pay electric bill\n2. Dentist appointment\n3. Buy groceries",
      processingStatus: "fallback_pending_retry",
      retryCount: 0,
    }).returning();

    // Create 3 fallback items in explicit order
    const [item1] = await db.insert(items).values({
      userId: testUserId,
      captureId: capture.id,
      title: "Pay electric bill",
      itemType: "payment",
      status: "pending_review",
      createdAt: new Date(Date.now() - 3000),
    }).returning();

    const [item2] = await db.insert(items).values({
      userId: testUserId,
      captureId: capture.id,
      title: "Dentist appointment",
      itemType: "appointment",
      status: "pending_review",
      createdAt: new Date(Date.now() - 2000),
    }).returning();

    const [item3] = await db.insert(items).values({
      userId: testUserId,
      captureId: capture.id,
      title: "Buy groceries",
      itemType: "task",
      status: "pending_review",
      createdAt: new Date(Date.now() - 1000),
    }).returning();

    // User edits item 1
    const token = jwt.sign({ userId: testUserId }, JWT_SECRET);
    await request(app)
      .patch(`/api/v1/items/${item1.id}`)
      .set("Cookie", `session=${token}`)
      .send({ title: "Electric bill paid $50" });

    // AI returns 3 items in REORDERED sequence: [3: groceries, 1: electric bill, 2: dentist]
    const reorderedAIItems = [
      {
        title: "Buy fresh groceries at market",
        itemType: "task",
        confidenceScore: 0.95,
        dueDate: new Date("2026-10-01T10:00:00Z"),
        metadata: { groceryList: true },
      },
      {
        title: "Electric utility bill",
        itemType: "payment",
        confidenceScore: 0.95,
        dueDate: new Date("2026-10-05T10:00:00Z"),
        metadata: { utility: true },
      },
      {
        title: "Dentist Checkup at 2pm",
        itemType: "appointment",
        confidenceScore: 0.95,
        dueDate: new Date("2026-10-10T14:00:00Z"),
        metadata: { doctor: true },
      },
    ];

    // Call enrichExistingItems directly with reordered items
    await enrichExistingItems(testUserId, capture.id, reorderedAIItems, capture.rawPayload, true, "America/New_York");

    // Verify all 3 items are correctly paired:
    // Item 1 (electric bill): preserved user edit "Electric bill paid $50"
    const [fetchedItem1] = await db.select().from(items).where(eq(items.id, item1.id)).limit(1);
    expect(fetchedItem1.title).toBe("Electric bill paid $50");

    // Item 2 (dentist): correctly paired with Dentist Checkup at 2pm despite AI placing it 3rd!
    const [fetchedItem2] = await db.select().from(items).where(eq(items.id, item2.id)).limit(1);
    expect(fetchedItem2.title).toBe("Dentist Checkup at 2pm");
    expect(fetchedItem2.itemType).toBe("appointment");
    expect(fetchedItem2.status).toBe("active");

    // Item 3 (groceries): correctly paired with Buy fresh groceries at market despite AI placing it 1st!
    const [fetchedItem3] = await db.select().from(items).where(eq(items.id, item3.id)).limit(1);
    expect(fetchedItem3.title).toBe("Buy fresh groceries at market");
    expect(fetchedItem3.itemType).toBe("task");
    expect(fetchedItem3.status).toBe("active");
  });

  it("A fallback item enriched into a high-confidence item WITH hasExplicitTime: true creates an exact_time reminder at that due instant, not day-offset ladder", async () => {
    const [capture] = await db.insert(captures).values({
      userId: testUserId,
      source: "web",
      type: "text",
      rawPayload: "Team standup at 3:30 pm today",
      processingStatus: "fallback_pending_retry",
      retryCount: 0,
      nextRetryAt: new Date(Date.now() - 1000),
    }).returning();

    // 1. Initial fallback extraction: item created in pending_review with isFallback: true
    await aiProvider.processCapture(
      capture.id,
      testUserId,
      capture.rawPayload,
      capture.type,
      "America/New_York",
      { isFallback: true }
    );

    const [fallbackItem] = await db.select().from(items).where(eq(items.captureId, capture.id)).limit(1);
    expect(fallbackItem.status).toBe("pending_review");
    expect((fallbackItem.metadata as any)?.isFallbackItem).toBe(true);

    // Initial check: zero reminders exist for fallback item
    const remindersInitial = await db.select().from(reminders).where(eq(reminders.itemId, fallbackItem.id));
    expect(remindersInitial.length).toBe(0);

    // 2. High-confidence AI result WITH hasExplicitTime: true and exact clock time
    const exactLocalWallClock = "2026-10-15T15:30:00";
    const enrichedAIItems = [
      {
        title: "Team standup meeting",
        itemType: "appointment",
        confidenceScore: 0.95,
        dueDate: exactLocalWallClock,
        hasExplicitTime: true,
        metadata: {
          hasExplicitTime: true,
          meeting: true,
        },
      },
    ];

    // Enable auto-reminders for user
    const [user] = await db.select().from(users).where(eq(users.id, testUserId)).limit(1);
    await db.update(users).set({
      settings: {
        ...((user.settings as any) || {}),
        autoReminders: true,
        timezone: "America/New_York",
      }
    }).where(eq(users.id, testUserId));

    // Enrich existing fallback item
    await enrichExistingItems(
      testUserId,
      capture.id,
      enrichedAIItems,
      capture.rawPayload,
      true,
      "America/New_York"
    );

    // 3. Verify item updated
    const [enrichedItem] = await db.select().from(items).where(eq(items.id, fallbackItem.id)).limit(1);
    expect(enrichedItem.status).toBe("active");
    expect((enrichedItem.metadata as any)?.hasExplicitTime).toBe(true);
    expect(enrichedItem.dueDate).not.toBeNull();

    // 4. Verify reminder: MUST be a single exact_time reminder scheduled at the exact due instant!
    // NOT the old 4-item day-offset ladder [-30, -7, -1, 0] at 9am.
    const createdReminders = await db.select().from(reminders).where(eq(reminders.itemId, fallbackItem.id));
    expect(createdReminders.length).toBe(1);
    expect(createdReminders[0].triggerType).toBe("exact_time");
    expect(createdReminders[0].relativeOffsetDays).toBe(0);
    // Scheduled at exact dueDate instant
    expect(new Date(createdReminders[0].scheduledAt).getTime()).toBe(new Date(enrichedItem.dueDate!).getTime());
  });
});

