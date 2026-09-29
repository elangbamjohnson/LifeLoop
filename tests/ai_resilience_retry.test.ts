import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../src/db";
import { users, captures, items } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { aiProvider } from "../src/server/services/AIProvider";
import { captureRetryService } from "../src/server/services/CaptureRetryService";

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
});

