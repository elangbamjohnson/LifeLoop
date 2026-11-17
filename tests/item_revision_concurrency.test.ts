import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { itemsRouter } from "../src/server/api/v1/items";
import { db } from "../src/db";
import { users, items, reminders, captures } from "../src/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { eventBus } from "../src/server/services/EventBus";
import { enrichExistingItems } from "../src/server/services/AIProvider";
import { createTestApp } from "./setup";

const app = createTestApp("/api/v1/items", itemsRouter);
const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret_for_development_only";

describe("Item Revision & Concurrency Preconditions (Phase 2)", () => {
  let userId: string;
  let authCookie: string;
  let otherUserId: string;
  let otherAuthCookie: string;

  beforeAll(async () => {
    userId = uuidv4();
    otherUserId = uuidv4();

    await db.insert(users).values([
      { id: userId, email: `rev_user_${userId}@test.com`, passwordHash: "dummy" },
      { id: otherUserId, email: `rev_other_${otherUserId}@test.com`, passwordHash: "dummy" },
    ]);

    authCookie = `session=${jwt.sign({ userId }, JWT_SECRET)}`;
    otherAuthCookie = `session=${jwt.sign({ userId: otherUserId }, JWT_SECRET)}`;
  });

  afterAll(async () => {
    await db.delete(reminders).where(eq(reminders.userId, userId));
    await db.delete(items).where(eq(items.userId, userId));
    await db.delete(items).where(eq(items.userId, otherUserId));
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(users).where(eq(users.id, otherUserId));
  });

  it("1. Matching revision succeeds and advances the revision", async () => {
    // Create an item with revision 1
    const createRes = await request(app)
      .post("/api/v1/items")
      .set("Cookie", authCookie)
      .send({
        title: "Initial Title",
        itemType: "task",
        status: "active",
      });

    expect(createRes.status).toBe(201);
    const item = createRes.body.item;
    expect(item.revision).toBe(1);

    // Update with matching expectedRevision = 1
    const updateRes = await request(app)
      .patch(`/api/v1/items/${item.id}`)
      .set("Cookie", authCookie)
      .send({
        title: "First Title Update",
        expectedRevision: 1,
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.item.title).toBe("First Title Update");
    expect(updateRes.body.item.revision).toBe(2);

    // Verify in database
    const [dbItem] = await db.select().from(items).where(eq(items.id, item.id));
    expect(dbItem.title).toBe("First Title Update");
    expect(dbItem.revision).toBe(2);
  });

  it("2. Stale revision fails with HTTP 409 without changing data", async () => {
    // Create item (rev 1) and advance to rev 2
    const createRes = await request(app)
      .post("/api/v1/items")
      .set("Cookie", authCookie)
      .send({ title: "Stale Test Base", itemType: "task" });
    const itemId = createRes.body.item.id;

    await request(app)
      .patch(`/api/v1/items/${itemId}`)
      .set("Cookie", authCookie)
      .send({ title: "Advanced Title", expectedRevision: 1 });

    // Try updating with stale expectedRevision = 1
    const staleRes = await request(app)
      .patch(`/api/v1/items/${itemId}`)
      .set("Cookie", authCookie)
      .send({
        title: "Should Not Apply",
        expectedRevision: 1,
      });

    expect(staleRes.status).toBe(409);
    expect(staleRes.body.code).toBe("REVISION_CONFLICT");
    expect(staleRes.body.currentRevision).toBe(2);

    // Verify database row was NOT modified
    const [dbItem] = await db.select().from(items).where(eq(items.id, itemId));
    expect(dbItem.title).toBe("Advanced Title");
    expect(dbItem.revision).toBe(2);
  });

  it("3. Two competing guarded updates cannot both succeed from the same starting revision", async () => {
    const createRes = await request(app)
      .post("/api/v1/items")
      .set("Cookie", authCookie)
      .send({ title: "Race Item", itemType: "task" });
    const itemId = createRes.body.item.id;
    expect(createRes.body.item.revision).toBe(1);

    // Fire two competing requests with the same expectedRevision = 1
    const [resA, resB] = await Promise.all([
      request(app)
        .patch(`/api/v1/items/${itemId}`)
        .set("Cookie", authCookie)
        .send({ title: "Competitor A", expectedRevision: 1 }),
      request(app)
        .patch(`/api/v1/items/${itemId}`)
        .set("Cookie", authCookie)
        .send({ title: "Competitor B", expectedRevision: 1 }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    // Exactly one 200 and one 409
    expect(statuses).toEqual([200, 409]);

    const conflictRes = resA.status === 409 ? resA : resB;
    const successRes = resA.status === 200 ? resA : resB;

    expect(conflictRes.body.code).toBe("REVISION_CONFLICT");
    expect(conflictRes.body.currentRevision).toBe(2);
    expect(successRes.body.item.revision).toBe(2);

    // Database title matches the winning competitor
    const [dbItem] = await db.select().from(items).where(eq(items.id, itemId));
    expect([ "Competitor A", "Competitor B" ]).toContain(dbItem.title);
    expect(dbItem.revision).toBe(2);
  });

  it("4. Title-only edits preserve unrelated metadata and fields", async () => {
    const dueDate = new Date("2026-12-01T10:00:00.000Z");
    const createRes = await request(app)
      .post("/api/v1/items")
      .set("Cookie", authCookie)
      .send({
        title: "Rich Item",
        itemType: "bill",
        status: "active",
        dueDate: dueDate.toISOString(),
        metadata: {
          amount: 450.75,
          currency: "USD",
          customField: "unrelated-value",
          nested: { flag: true, items: [1, 2, 3] },
          hasExplicitTime: true,
        },
      });

    const itemId = createRes.body.item.id;
    expect(createRes.body.item.revision).toBe(1);

    // Perform title-only edit
    const updateRes = await request(app)
      .patch(`/api/v1/items/${itemId}`)
      .set("Cookie", authCookie)
      .send({
        title: "Renamed Rich Item",
        expectedRevision: 1,
      });

    expect(updateRes.status).toBe(200);
    const updated = updateRes.body.item;
    expect(updated.title).toBe("Renamed Rich Item");
    expect(updated.revision).toBe(2);
    expect(updated.itemType).toBe("bill");
    expect(updated.status).toBe("active");
    expect(new Date(updated.dueDate).toISOString()).toBe(dueDate.toISOString());

    // Verify metadata preservation
    expect(updated.metadata.amount).toBe(450.75);
    expect(updated.metadata.currency).toBe("USD");
    expect(updated.metadata.customField).toBe("unrelated-value");
    expect(updated.metadata.nested).toEqual({ flag: true, items: [1, 2, 3] });
    expect(updated.metadata.hasExplicitTime).toBe(true);
    expect(updated.metadata.userEdited).toBe(true);
  });

  it("5. Unauthorized/non-owner requests cannot modify the item (non-disclosing 404)", async () => {
    const createRes = await request(app)
      .post("/api/v1/items")
      .set("Cookie", authCookie)
      .send({ title: "Private Item", itemType: "task" });
    const itemId = createRes.body.item.id;

    // Other user attempts to update with matching or non-matching revision
    const otherRes = await request(app)
      .patch(`/api/v1/items/${itemId}`)
      .set("Cookie", otherAuthCookie)
      .send({ title: "Hacked", expectedRevision: 1 });

    expect(otherRes.status).toBe(404);
    expect(otherRes.body.error).toBe("Item not found or could not be updated");

    // Unauthenticated attempt
    const anonRes = await request(app)
      .patch(`/api/v1/items/${itemId}`)
      .send({ title: "No Auth", expectedRevision: 1 });

    expect(anonRes.status).toBe(401);

    // Database item unchanged
    const [dbItem] = await db.select().from(items).where(eq(items.id, itemId));
    expect(dbItem.title).toBe("Private Item");
    expect(dbItem.revision).toBe(1);
  });

  it("6. Missing or malformed revisions follow agreed contract", async () => {
    const createRes = await request(app)
      .post("/api/v1/items")
      .set("Cookie", authCookie)
      .send({ title: "Validation Item", itemType: "task" });
    const itemId = createRes.body.item.id;

    // (a) Legacy unversioned request succeeds and increments revision
    const legacyRes = await request(app)
      .patch(`/api/v1/items/${itemId}`)
      .set("Cookie", authCookie)
      .send({ title: "Legacy Updated Title" });

    expect(legacyRes.status).toBe(200);
    expect(legacyRes.body.item.revision).toBe(2);

    // (b) Malformed revisions rejected with 400
    const invalidValues = [0, -1, "abc", "1.5", 1.5, null, {}, []];
    for (const val of invalidValues) {
      const badRes = await request(app)
        .patch(`/api/v1/items/${itemId}`)
        .set("Cookie", authCookie)
        .send({ title: "Bad", expectedRevision: val });

      expect(badRes.status, `Testing val: ${JSON.stringify(val)}`).toBe(400);
      expect(badRes.body.code).toBe("INVALID_REVISION");
    }

    // (c) Also accepts string numeric revision "2"
    const strRes = await request(app)
      .patch(`/api/v1/items/${itemId}`)
      .set("Cookie", authCookie)
      .send({ title: "String Rev Title", expectedRevision: "2" });

    expect(strRes.status).toBe(200);
    expect(strRes.body.item.revision).toBe(3);
  });

  it("7. Rejected updates cause no reminder or event side effects", async () => {
    const createRes = await request(app)
      .post("/api/v1/items")
      .set("Cookie", authCookie)
      .send({ title: "Reminder Side Effect Test", itemType: "task" });
    const itemId = createRes.body.item.id;

    // Seed a reminder directly for this item
    const [seededReminder] = await db
      .insert(reminders)
      .values({
        userId,
        itemId,
        title: "Test Reminder",
        scheduledAt: new Date(Date.now() + 86400000),
        status: "scheduled",
      })
      .returning();

    const publishSpy = vi.spyOn(eventBus, "publish");

    // Attempt stale update
    const staleRes = await request(app)
      .patch(`/api/v1/items/${itemId}`)
      .set("Cookie", authCookie)
      .send({ title: "Should Fail", expectedRevision: 999 });

    expect(staleRes.status).toBe(409);

    // Event bus was not published for this item
    const itemEvents = publishSpy.mock.calls.filter((call) => {
      const event = call[1] as any;
      return event?.id === itemId;
    });
    expect(itemEvents.length).toBe(0);

    // Reminder in database is completely untouched
    const [dbReminder] = await db.select().from(reminders).where(eq(reminders.id, seededReminder.id));
    expect(dbReminder.title).toBe("Test Reminder");
    expect(dbReminder.status).toBe("scheduled");

    publishSpy.mockRestore();
  });

  it("8. Existing web behavior remains compatible and exposes revision in timeline", async () => {
    const res = await request(app)
      .get("/api/v1/items/timeline")
      .set("Cookie", authCookie);

    expect(res.status).toBe(200);
    expect(res.body.timeline).toBeDefined();

    // Flatten all items from timeline
    const allTimelineItems = [
      ...res.body.timeline.needsAttention,
      ...res.body.timeline.today,
      ...res.body.timeline.tomorrow,
      ...res.body.timeline.thisWeek,
      ...res.body.timeline.upcoming,
      ...res.body.timeline.waitingFor,
      ...res.body.timeline.past,
    ];

    expect(allTimelineItems.length).toBeGreaterThan(0);
    for (const item of allTimelineItems) {
      expect(typeof item.revision).toBe("number");
      expect(item.revision).toBeGreaterThanOrEqual(1);
    }
  });

  it("9. Combined dueDate and status: 'completed' cancels pending reminders", async () => {
    const createRes = await request(app)
      .post("/api/v1/items")
      .set("Cookie", authCookie)
      .send({
        title: "Item with Reminders",
        itemType: "task",
        status: "active",
        dueDate: "2026-11-20T09:00:00.000Z",
      });
    const itemId = createRes.body.item.id;

    // Seed a scheduled reminder for this item
    const [reminder] = await db
      .insert(reminders)
      .values({
        userId,
        itemId,
        title: "Test Reminder for Completion",
        scheduledAt: new Date("2026-11-20T09:00:00.000Z"),
        status: "scheduled",
      })
      .returning();

    // Send combined PATCH: new dueDate AND status: "completed"
    const patchRes = await request(app)
      .patch(`/api/v1/items/${itemId}`)
      .set("Cookie", authCookie)
      .send({
        dueDate: "2026-12-01T09:00:00.000Z",
        status: "completed",
        expectedRevision: 1,
      });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.item.status).toBe("completed");

    // Assert that the reminder was CANCELLED (not rescheduled)
    const [dbReminder] = await db.select().from(reminders).where(eq(reminders.id, reminder.id));
    expect(dbReminder.status).toBe("cancelled");
  });

  it("10. Stale-revision (409) and non-owner (404) requests with X-Timezone do NOT persist user settings", async () => {
    // Create a fresh user with empty settings
    const noTzUserId = uuidv4();
    await db.insert(users).values({
      id: noTzUserId,
      email: `notz_${noTzUserId}@test.com`,
      passwordHash: "dummy",
      settings: {},
    });
    const noTzAuthCookie = `session=${jwt.sign({ userId: noTzUserId }, JWT_SECRET)}`;

    // Create an item for this user
    const createRes = await request(app)
      .post("/api/v1/items")
      .set("Cookie", noTzAuthCookie)
      .send({ title: "No TZ Item", itemType: "task" });
    const itemId = createRes.body.item.id;

    // Advance revision to 2
    await request(app)
      .patch(`/api/v1/items/${itemId}`)
      .set("Cookie", noTzAuthCookie)
      .send({ title: "Updated Once", expectedRevision: 1 });

    // (a) Stale revision request (expectedRevision = 1) with X-Timezone header
    const staleRes = await request(app)
      .patch(`/api/v1/items/${itemId}`)
      .set("Cookie", noTzAuthCookie)
      .set("X-Timezone", "Asia/Tokyo")
      .send({ title: "Should Fail", expectedRevision: 1 });

    expect(staleRes.status).toBe(409);

    // Verify user settings still have no timezone
    const [userAfterStale] = await db.select().from(users).where(eq(users.id, noTzUserId));
    expect((userAfterStale.settings as any)?.timezone).toBeUndefined();

    // (b) Non-owner request with X-Timezone header
    const nonOwnerRes = await request(app)
      .patch(`/api/v1/items/${itemId}`)
      .set("Cookie", otherAuthCookie)
      .set("X-Timezone", "Asia/Tokyo")
      .send({ title: "Hacker Title", expectedRevision: 2 });

    expect(nonOwnerRes.status).toBe(404);

    // Verify other user settings still have no timezone
    const [otherUserAfter404] = await db.select().from(users).where(eq(users.id, otherUserId));
    expect((otherUserAfter404.settings as any)?.timezone).toBeUndefined();

    // Cleanup
    await db.delete(items).where(eq(items.userId, noTzUserId));
    await db.delete(users).where(eq(users.id, noTzUserId));
  });

  it("11. AI enrichment write fails atomically if user edited item concurrently (no overwrite, no side effects)", async () => {
    // 1. Create capture and a fallback item (simulating initial capture processing)
    const [capture] = await db
      .insert(captures)
      .values({
        userId,
        source: "web",
        type: "text",
        rawPayload: "Dental appointment on Friday",
        processingStatus: "completed",
      })
      .returning();

    const [fallbackItem] = await db
      .insert(items)
      .values({
        userId,
        captureId: capture.id,
        title: "Dental appointment on Friday",
        itemType: "task",
        status: "pending_review",
        revision: 1,
        metadata: { userEdited: false },
      })
      .returning();

    // 2. Define the AI parsed item that enrichment will attempt to apply
    const aiParsedItems = [
      {
        title: "AI Overwrite Dentist",
        itemType: "appointment",
        confidenceScore: 0.95,
        dueDate: "2026-11-20T10:00:00",
        hasExplicitTime: true,
        metadata: { doctor: "Dr. AI" },
      },
    ];

    // 3. Controlled deterministic interleaving:
    // Enrichment reads the fallback item while revision is 1 and userEdited is false.
    // It pauses before its database update via onBeforeItemUpdate hook.
    // While paused, a user PATCH completes to advance revision to 2 with userEdited: true.
    // Then enrichment resumes and attempts its atomic write condition.
    let hookRan = false;
    await enrichExistingItems(
      userId,
      capture.id,
      aiParsedItems,
      capture.rawPayload,
      true,
      "UTC",
      {
        onBeforeItemUpdate: async (readSnapshot) => {
          hookRan = true;
          // Verify snapshot was read BEFORE user patch
          expect(readSnapshot.revision).toBe(1);
          expect((readSnapshot.metadata as any)?.userEdited).toBe(false);

          // User edits the item via PATCH while enrichment is paused before DB write
          const userEditRes = await request(app)
            .patch(`/api/v1/items/${fallbackItem.id}`)
            .set("Cookie", authCookie)
            .send({
              title: "My Dentist Dr. Smith - Root Canal",
              expectedRevision: 1,
            });

          expect(userEditRes.status).toBe(200);
          expect(userEditRes.body.item.revision).toBe(2);
          expect(userEditRes.body.item.metadata.userEdited).toBe(true);
        },
      }
    );

    expect(hookRan).toBe(true);

    // Assert: User's title, revision, and metadata were NOT overwritten by AI!
    const [finalItem] = await db.select().from(items).where(eq(items.id, fallbackItem.id));
    expect(finalItem.title).toBe("My Dentist Dr. Smith - Root Canal");
    expect(finalItem.revision).toBe(2);
    expect(finalItem.itemType).toBe("task");
    expect((finalItem.metadata as any)?.userEdited).toBe(true);
    expect((finalItem.metadata as any)?.doctor).toBeUndefined();

    // Assert: No AI reminders created for the skipped item
    const createdReminders = await db.select().from(reminders).where(eq(reminders.itemId, fallbackItem.id));
    expect(createdReminders.length).toBe(0);

    // Cleanup
    await db.delete(items).where(eq(items.id, fallbackItem.id));
    await db.delete(captures).where(eq(captures.id, capture.id));
  });

  it("12. Calendar-added operations use row locking, preserve concurrent metadata, and advance revision", async () => {
    const createRes = await request(app)
      .post("/api/v1/items")
      .set("Cookie", authCookie)
      .send({
        title: "Calendar Sync Item",
        itemType: "task",
        dueDate: "2026-12-15T09:00:00.000Z",
        metadata: {
          customProperty: "keep_this_safe",
          tags: ["urgent", "personal"],
        },
      });
    const itemId = createRes.body.item.id;
    expect(createRes.body.item.revision).toBe(1);

    // POST /:id/calendar-added
    const addRes = await request(app)
      .post(`/api/v1/items/${itemId}/calendar-added`)
      .set("Cookie", authCookie);

    expect(addRes.status).toBe(200);
    expect(addRes.body.item.revision).toBe(2);
    expect(addRes.body.item.metadata.customProperty).toBe("keep_this_safe");
    expect(addRes.body.item.metadata.tags).toEqual(["urgent", "personal"]);
    expect(addRes.body.item.metadata.calendarAdded).toBeDefined();

    // DELETE /:id/calendar-added
    const deleteRes = await request(app)
      .delete(`/api/v1/items/${itemId}/calendar-added`)
      .set("Cookie", authCookie);

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.item.revision).toBe(3);
    expect(deleteRes.body.item.metadata.customProperty).toBe("keep_this_safe");
    expect(deleteRes.body.item.metadata.tags).toEqual(["urgent", "personal"]);
    expect(deleteRes.body.item.metadata.calendarAdded).toBeUndefined();
  });

  it("13. Competing writers: interleaved metadata update with calendar-added and removal operations preserves unrelated metadata and advances revisions", async () => {
    // Helper to safely await promises with bounded timeout and timer cleanup
    function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
      let timer: NodeJS.Timeout | null = null;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      });
      return Promise.race([promise, timeoutPromise]).finally(() => {
        if (timer) clearTimeout(timer);
      });
    }

    // Helper to observe PostgreSQL lock-wait tied to the blocking backend PID
    async function waitForBlockedBackend(blockingPid: number, timeoutMs = 4000): Promise<number> {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const rows = await db.execute<{ pid: number }>(
          sql`SELECT pid FROM pg_stat_activity WHERE ${blockingPid} = ANY(pg_blocking_pids(pid))`
        );
        if (rows.length > 0) {
          return rows[0].pid;
        }
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error(`Timed out after ${timeoutMs}ms waiting for backend to be blocked by PID ${blockingPid}`);
    }

    // 1. Create item with initial metadata
    const createRes = await request(app)
      .post("/api/v1/items")
      .set("Cookie", authCookie)
      .send({
        title: "Competing Calendar Item",
        itemType: "task",
        dueDate: "2026-12-20T14:00:00.000Z",
        metadata: {
          project: "Apollo",
          priority: "high",
        },
      });
    const itemId = createRes.body.item.id;
    expect(createRes.body.item.revision).toBe(1);

    // Part A: Interleave metadata update with POST /:id/calendar-added
    let releaseTxA: (() => void) | null = null;
    const txACanCommitPromise = new Promise<void>((r) => { releaseTxA = r; });
    let notifyTxALocked: ((pid: number) => void) | null = null;
    const txALockedPromise = new Promise<number>((r) => { notifyTxALocked = r; });

    let calendarAddPromise: Promise<request.Response> | null = null;
    let txAPromise: Promise<any> | null = null;

    try {
      // Writer A starts transaction and acquires row lock
      txAPromise = db.transaction(async (tx) => {
        const pidRows = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
        const txAPid = pidRows[0].pid;

        const [lockedItem] = await tx
          .select()
          .from(items)
          .where(eq(items.id, itemId))
          .for("update");

        notifyTxALocked!(txAPid); // Signal that Writer A holds row lock with its backend PID

        await txACanCommitPromise; // Hold lock until concurrent request is confirmed blocked

        await tx
          .update(items)
          .set({
            metadata: { ...(lockedItem.metadata as Record<string, any>), noteFromTxA: "survives_txA" },
            revision: sql`${items.revision} + 1`,
            updatedAt: sql`now()`,
          })
          .where(and(eq(items.id, itemId), eq(items.revision, lockedItem.revision)));
      });

      // Awaiting initial lock notification is installed inside try/finally with bounded timeout
      const lockedPidA = await withTimeout(txALockedPromise, 4000, "Timeout waiting for TxA lock");

      // Explicitly start competing calendar-added request using .end() while Writer A holds row lock
      calendarAddPromise = new Promise<request.Response>((resolve, reject) => {
        request(app)
          .post(`/api/v1/items/${itemId}/calendar-added`)
          .set("Cookie", authCookie)
          .end((err, res) => {
            if (err) reject(err);
            else resolve(res);
          });
      });

      // Observable synchronization: establish that the calendar operation has reached
      // the contested database operation and is blocked on TxA's backend PID
      const blockedPidA = await waitForBlockedBackend(lockedPidA, 4000);
      expect(blockedPidA).toBeGreaterThan(0);
      expect(blockedPidA).not.toBe(lockedPidA);

      // Release Writer A barrier so it can write and commit
      releaseTxA!();

      // Await Writer A commit and calendarAdd completion with bounded failure handling
      await withTimeout(txAPromise, 4000, "Timeout waiting for TxA transaction commit");
      const addRes = await withTimeout(calendarAddPromise, 4000, "Timeout waiting for calendarAdd response");
      expect(addRes.status).toBe(200);

      // Verify DB state after Part A: revision is 3, noteFromTxA and calendarAdded both exist!
      const [itemAfterAdd] = await db.select().from(items).where(eq(items.id, itemId));
      expect(itemAfterAdd.revision).toBe(3);
      expect((itemAfterAdd.metadata as any).project).toBe("Apollo");
      expect((itemAfterAdd.metadata as any).priority).toBe("high");
      expect((itemAfterAdd.metadata as any).noteFromTxA).toBe("survives_txA");
      expect((itemAfterAdd.metadata as any).calendarAdded).toBeDefined();
    } finally {
      // 1. Ensure barrier is released on EVERY exit path (including initial lock-notification timeout)
      if (releaseTxA) releaseTxA();

      // 2. Settle all started transaction and HTTP operations before test teardown
      const ops: Promise<any>[] = [];
      if (txAPromise) ops.push(withTimeout(txAPromise, 4000, "Timeout settling txAPromise").catch(() => {}));
      if (calendarAddPromise) ops.push(withTimeout(calendarAddPromise, 4000, "Timeout settling calendarAddPromise").catch(() => {}));
      if (ops.length > 0) {
        try {
          await Promise.allSettled(ops);
        } catch {
          // Preserve the original test failure if settling throws
        }
      }
    }

    // Part B: Interleave second metadata update with DELETE /:id/calendar-added
    let releaseTxB: (() => void) | null = null;
    const txBCanCommitPromise = new Promise<void>((r) => { releaseTxB = r; });
    let notifyTxBLocked: ((pid: number) => void) | null = null;
    const txBLockedPromise = new Promise<number>((r) => { notifyTxBLocked = r; });

    let calendarDeletePromise: Promise<request.Response> | null = null;
    let txBPromise: Promise<any> | null = null;

    try {
      txBPromise = db.transaction(async (tx) => {
        const pidRows = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
        const txBPid = pidRows[0].pid;

        const [lockedItem2] = await tx
          .select()
          .from(items)
          .where(eq(items.id, itemId))
          .for("update");

        notifyTxBLocked!(txBPid);

        await txBCanCommitPromise;

        await tx
          .update(items)
          .set({
            metadata: { ...(lockedItem2.metadata as Record<string, any>), noteFromTxB: "survives_txB" },
            revision: sql`${items.revision} + 1`,
            updatedAt: sql`now()`,
          })
          .where(and(eq(items.id, itemId), eq(items.revision, lockedItem2.revision)));
      });

      const lockedPidB = await withTimeout(txBLockedPromise, 4000, "Timeout waiting for TxB lock");

      // Explicitly start competing calendar-delete request using .end() while Writer B holds row lock
      calendarDeletePromise = new Promise<request.Response>((resolve, reject) => {
        request(app)
          .delete(`/api/v1/items/${itemId}/calendar-added`)
          .set("Cookie", authCookie)
          .end((err, res) => {
            if (err) reject(err);
            else resolve(res);
          });
      });

      // Observable synchronization: establish that the calendar delete operation has blocked on TxB's PID
      const blockedPidB = await waitForBlockedBackend(lockedPidB, 4000);
      expect(blockedPidB).toBeGreaterThan(0);
      expect(blockedPidB).not.toBe(lockedPidB);

      releaseTxB!();

      await withTimeout(txBPromise, 4000, "Timeout waiting for TxB transaction commit");
      const deleteRes = await withTimeout(calendarDeletePromise, 4000, "Timeout waiting for calendarDelete response");
      expect(deleteRes.status).toBe(200);

      // Verify final DB state after Part B: revision is 5, both metadata additions survive, calendarAdded removed
      const [itemAfterDelete] = await db.select().from(items).where(eq(items.id, itemId));
      expect(itemAfterDelete.revision).toBe(5);
      expect((itemAfterDelete.metadata as any).project).toBe("Apollo");
      expect((itemAfterDelete.metadata as any).priority).toBe("high");
      expect((itemAfterDelete.metadata as any).noteFromTxA).toBe("survives_txA");
      expect((itemAfterDelete.metadata as any).noteFromTxB).toBe("survives_txB");
      expect((itemAfterDelete.metadata as any).calendarAdded).toBeUndefined();
    } finally {
      if (releaseTxB) releaseTxB();

      const ops: Promise<any>[] = [];
      if (txBPromise) ops.push(withTimeout(txBPromise, 4000, "Timeout settling txBPromise").catch(() => {}));
      if (calendarDeletePromise) ops.push(withTimeout(calendarDeletePromise, 4000, "Timeout settling calendarDeletePromise").catch(() => {}));
      if (ops.length > 0) {
        try {
          await Promise.allSettled(ops);
        } catch {
          // Preserve the original test failure if settling throws
        }
      }
    }

    // Cleanup
    await db.delete(items).where(eq(items.id, itemId));
  });
});
