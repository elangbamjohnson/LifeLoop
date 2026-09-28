import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { db } from "../src/db";
import { users, items, reminders, captures } from "../src/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { reminderService } from "../src/server/services/ReminderService";
import { saveExtractedItems } from "../src/server/services/AIProvider";
import { createTestApp } from "./setup";

const app = createTestApp();
const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret_for_development_only";

describe("Exact-Time Reminders and Lifecycle Synchronization", () => {
  let testUserId: string;
  let authCookie: string;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    const [user] = await db
      .insert(users)
      .values({
        email: `exact_time_${uuidv4()}@example.com`,
        passwordHash: "dummy",
        settings: {
          timezone: "UTC",
          autoReminders: true,
          channels: ["web"],
        },
      })
      .returning();

    testUserId = user.id;
    createdUserIds.push(user.id);
    const token = jwt.sign({ userId: user.id }, JWT_SECRET);
    authCookie = `session=${token}`;
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await db.delete(reminders).where(inArray(reminders.userId, createdUserIds));
      await db.delete(items).where(inArray(items.userId, createdUserIds));
      await db.delete(captures).where(inArray(captures.userId, createdUserIds));
      await db.delete(users).where(inArray(users.id, createdUserIds));
    }
  });

  // Test 1: Time-specific item ("at 4:30 pm", "in 2 minutes") creates exactly one reminder at the due instant
  it("Time-specific item ('at 4:30 pm', 'in 2 minutes') creates exactly one reminder at the due instant", async () => {
    const res = await request(app)
      .post("/api/v1/captures")
      .set("Cookie", authCookie)
      .send({ type: "text", rawPayload: "remind me in 2 minutes to check the oven" });

    expect(res.status).toBe(201);
    const captureId = res.body.capture.id;

    // Poll for AI capture processing
    let createdItem: any;
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      const [it] = await db.select().from(items).where(eq(items.captureId, captureId));
      if (it) {
        createdItem = it;
        break;
      }
    }

    expect(createdItem).toBeDefined();
    expect(createdItem.metadata?.hasExplicitTime).toBe(true);
    expect(createdItem.dueDate).toBeDefined();

    // Verify reminder creation
    const itemReminders = await db
      .select()
      .from(reminders)
      .where(eq(reminders.itemId, createdItem.id));

    expect(itemReminders.length).toBe(1);
    const r = itemReminders[0];
    expect(r.triggerType).toBe("exact_time");
    expect(r.relativeOffsetDays).toBe(0);
    expect(r.channel).toBe("web");
    expect(r.status).toBe("scheduled");
    expect(Math.abs(new Date(r.scheduledAt).getTime() - new Date(createdItem.dueDate).getTime())).toBeLessThan(1000);
  });

  // Test 2: Date-only item creates the same ladder as before (assert offsets and 9:00 AM local time for a non-UTC timezone, e.g. Asia/Kolkata)
  it("Date-only item creates the same ladder as before (assert offsets and 9:00 AM local time for a non-UTC timezone, e.g. Asia/Kolkata)", async () => {
    const kolkataTimezone = "Asia/Kolkata";
    const [kolkataUser] = await db
      .insert(users)
      .values({
        email: `kolkata_${uuidv4()}@example.com`,
        passwordHash: "dummy",
        settings: {
          timezone: kolkataTimezone,
          autoReminders: true,
        },
      })
      .returning();
    createdUserIds.push(kolkataUser.id);

    // Future due date: 40 days in future so all 4 ladder offsets [-30, -7, -1, 0] fire
    const futureDueDate = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000);

    const [item] = await db
      .insert(items)
      .values({
        userId: kolkataUser.id,
        title: "Annual Vehicle Tax Payment",
        itemType: "payment",
        status: "active",
        dueDate: futureDueDate,
        metadata: { hasExplicitTime: false },
        confidenceScore: 0.95,
      })
      .returning();

    const createdReminders = await reminderService.createRemindersForItem(
      item.id,
      kolkataUser.id,
      item.title,
      item.dueDate!,
      false,
      kolkataTimezone
    );

    expect(createdReminders.length).toBe(4);
    const offsets = createdReminders.map((r) => r.relativeOffsetDays).sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(offsets).toEqual([-30, -7, -1, 0]);

    for (const r of createdReminders) {
      expect(r.triggerType).toBe("relative_to_deadline");
      expect(r.channel).toBe("web");
      expect(r.status).toBe("scheduled");

      // Verify that in Asia/Kolkata timezone, the local hour is 9 and minute is 0
      const localTimeStr = new Intl.DateTimeFormat("en-US", {
        timeZone: kolkataTimezone,
        hour: "numeric",
        minute: "numeric",
        hour12: false,
      }).format(new Date(r.scheduledAt));

      expect(localTimeStr).toBe("09:00");
    }
  });

  // Test 3: Missing flag falls back to date-only through real AI save path
  it("Missing flag falls back to date-only through real AI save path", async () => {
    const futureDate = new Date(Date.now() + 35 * 24 * 60 * 60 * 1000);
    const [capture] = await db
      .insert(captures)
      .values({
        userId: testUserId,
        source: "web",
        type: "text",
        rawPayload: "Renew passport by end of next month",
        processingStatus: "completed",
      })
      .returning();

    // Call saveExtractedItems directly without hasExplicitTime
    await saveExtractedItems(
      testUserId,
      capture.id,
      [
        {
          title: "Renew passport",
          itemType: "task",
          dueDate: futureDate,
          confidenceScore: 0.9,
          metadata: {}, // no hasExplicitTime provided
        },
      ],
      capture.rawPayload,
      true, // autoReminders enabled
      "UTC"
    );

    const [createdItem] = await db.select().from(items).where(eq(items.captureId, capture.id));
    expect(createdItem).toBeDefined();
    expect(createdItem.metadata?.hasExplicitTime).toBe(false);

    const itemReminders = await db
      .select()
      .from(reminders)
      .where(eq(reminders.itemId, createdItem.id));

    expect(itemReminders.length).toBeGreaterThan(1);
    for (const r of itemReminders) {
      expect(r.triggerType).toBe("relative_to_deadline");
    }
  });

  // Test 4: Due time already more than 60s past: no reminder created
  it("Due time already more than 60s past: no reminder created", async () => {
    const pastDueDate = new Date(Date.now() - 90 * 1000); // 90 seconds ago
    const [item] = await db
      .insert(items)
      .values({
        userId: testUserId,
        title: "Past Due Item",
        itemType: "task",
        status: "active",
        dueDate: pastDueDate,
        metadata: { hasExplicitTime: true },
        confidenceScore: 0.95,
      })
      .returning();

    const created = await reminderService.createRemindersForItem(
      item.id,
      testUserId,
      item.title,
      item.dueDate!,
      true,
      "UTC"
    );

    expect(created.length).toBe(0);

    const fromDb = await db.select().from(reminders).where(eq(reminders.itemId, item.id));
    expect(fromDb.length).toBe(0);
  });

  // Test 5: Completing an item cancels its pending reminders and leaves a 'sent' one untouched
  it("Completing an item cancels its pending reminders and leaves a 'sent' one untouched", async () => {
    const [item] = await db
      .insert(items)
      .values({
        userId: testUserId,
        title: "Item to complete",
        itemType: "task",
        status: "active",
      })
      .returning();

    // Create 1 scheduled, 1 snoozed, and 1 sent reminder
    const [scheduledRem] = await db
      .insert(reminders)
      .values({
        userId: testUserId,
        itemId: item.id,
        title: "Pending scheduled reminder",
        scheduledAt: new Date(Date.now() + 60000),
        status: "scheduled",
      })
      .returning();

    const [snoozedRem] = await db
      .insert(reminders)
      .values({
        userId: testUserId,
        itemId: item.id,
        title: "Pending snoozed reminder",
        scheduledAt: new Date(Date.now() + 120000),
        status: "snoozed",
      })
      .returning();

    const [sentRem] = await db
      .insert(reminders)
      .values({
        userId: testUserId,
        itemId: item.id,
        title: "Already sent reminder",
        scheduledAt: new Date(Date.now() - 60000),
        status: "sent",
        sentAt: new Date(),
      })
      .returning();

    // Complete the item via API
    const res = await request(app)
      .post(`/api/v1/items/${item.id}/complete`)
      .set("Cookie", authCookie)
      .send({ completed: true });

    expect(res.status).toBe(200);

    // Verify reminder statuses
    const [freshScheduled] = await db.select().from(reminders).where(eq(reminders.id, scheduledRem.id));
    const [freshSnoozed] = await db.select().from(reminders).where(eq(reminders.id, snoozedRem.id));
    const [freshSent] = await db.select().from(reminders).where(eq(reminders.id, sentRem.id));

    expect(freshScheduled.status).toBe("cancelled");
    expect(freshSnoozed.status).toBe("cancelled");
    expect(freshSent.status).toBe("sent");

    // Verify reopening does NOT resurrect cancelled reminders
    const reopenRes = await request(app)
      .post(`/api/v1/items/${item.id}/complete`)
      .set("Cookie", authCookie)
      .send({ completed: false });

    expect(reopenRes.status).toBe(200);

    const [afterReopenScheduled] = await db.select().from(reminders).where(eq(reminders.id, scheduledRem.id));
    expect(afterReopenScheduled.status).toBe("cancelled");
  });

  // Test 6: Deleting an item cancels pending reminders and detaches reminders without cascade loss
  it("Deleting an item cancels pending reminders and detaches reminders without cascade loss", async () => {
    const [item] = await db
      .insert(items)
      .values({
        userId: testUserId,
        title: "Item to delete",
        itemType: "task",
        status: "active",
      })
      .returning();

    const [pendingRem] = await db
      .insert(reminders)
      .values({
        userId: testUserId,
        itemId: item.id,
        title: "Reminder before deletion",
        scheduledAt: new Date(Date.now() + 60000),
        status: "scheduled",
      })
      .returning();

    const [sentRem] = await db
      .insert(reminders)
      .values({
        userId: testUserId,
        itemId: item.id,
        title: "Sent reminder before deletion",
        scheduledAt: new Date(Date.now() - 60000),
        status: "sent",
        sentAt: new Date(),
      })
      .returning();

    const res = await request(app)
      .delete(`/api/v1/items/${item.id}`)
      .set("Cookie", authCookie);

    expect(res.status).toBe(200);

    // Verify pending reminder still exists in reminders table with status 'cancelled' and detached itemId
    const [freshPending] = await db.select().from(reminders).where(eq(reminders.id, pendingRem.id));
    expect(freshPending).toBeDefined();
    expect(freshPending.status).toBe("cancelled");
    expect(freshPending.itemId).toBeNull();
    expect((freshPending.metadata as any)?.deletedItemId).toBe(item.id);

    // Verify sent reminder still exists in reminders table with status 'sent' and detached itemId
    const [freshSent] = await db.select().from(reminders).where(eq(reminders.id, sentRem.id));
    expect(freshSent).toBeDefined();
    expect(freshSent.status).toBe("sent");
    expect(freshSent.itemId).toBeNull();
    expect((freshSent.metadata as any)?.deletedItemId).toBe(item.id);
  });

  // Test 7: Editing the due date replaces auto-created reminders and leaves a manually created one alone
  it("Editing the due date replaces auto-created reminders and leaves a manually created one alone", async () => {
    const initialDueDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const [item] = await db
      .insert(items)
      .values({
        userId: testUserId,
        title: "Item to edit deadline",
        itemType: "task",
        status: "active",
        dueDate: initialDueDate,
        metadata: { hasExplicitTime: true },
      })
      .returning();

    // 1. Auto-created reminder
    const [autoRem] = await db
      .insert(reminders)
      .values({
        userId: testUserId,
        itemId: item.id,
        title: "Auto-created reminder",
        triggerType: "exact_time",
        scheduledAt: initialDueDate,
        status: "scheduled",
        metadata: { autoCreated: true },
      })
      .returning();

    // 2. Manually created reminder via API createReminder
    const manualRem = await reminderService.createReminder({
      userId: testUserId,
      itemId: item.id,
      title: "Manual user reminder",
      scheduledAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      channel: "web",
    });

    const newDueDate = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);

    // Update due date via PATCH
    const patchRes = await request(app)
      .patch(`/api/v1/items/${item.id}`)
      .set("Cookie", authCookie)
      .send({
        dueDate: newDueDate.toISOString(),
        hasExplicitTime: true,
      });

    expect(patchRes.status).toBe(200);

    // Verify old auto reminder was cancelled
    const [updatedAutoRem] = await db.select().from(reminders).where(eq(reminders.id, autoRem.id));
    expect(updatedAutoRem.status).toBe("cancelled");

    // Verify manual reminder was untouched
    const [updatedManualRem] = await db.select().from(reminders).where(eq(reminders.id, manualRem.id));
    expect(updatedManualRem.status).toBe("scheduled");

    // Verify a new active auto-created reminder exists for the new due date
    const allActiveExactReminders = await db
      .select()
      .from(reminders)
      .where(
        and(
          eq(reminders.itemId, item.id),
          eq(reminders.status, "scheduled"),
          eq(reminders.triggerType, "exact_time")
        )
      );

    const newAutoReminders = allActiveExactReminders.filter((r) => (r.metadata as any)?.autoCreated === true);
    expect(newAutoReminders.length).toBe(1);
    expect(Math.abs(new Date(newAutoReminders[0].scheduledAt).getTime() - newDueDate.getTime())).toBeLessThan(1000);
  });

  // Test 8: Same item processed twice: still one reminder, not two
  it("Same item processed twice: still one reminder, not two", async () => {
    const dueDate = new Date(Date.now() + 5 * 60 * 1000);
    const [item] = await db
      .insert(items)
      .values({
        userId: testUserId,
        title: "Idempotent item",
        itemType: "task",
        status: "active",
        dueDate,
        metadata: { hasExplicitTime: true },
      })
      .returning();

    // Process once
    await reminderService.createRemindersForItem(
      item.id,
      testUserId,
      item.title,
      dueDate,
      true,
      "UTC"
    );

    const firstRun = await db.select().from(reminders).where(eq(reminders.itemId, item.id));
    expect(firstRun.length).toBe(1);

    // Process a second time (reprocessing/retry)
    await reminderService.createRemindersForItem(
      item.id,
      testUserId,
      item.title,
      dueDate,
      true,
      "UTC"
    );

    const secondRun = await db.select().from(reminders).where(eq(reminders.itemId, item.id));
    expect(secondRun.length).toBe(1);
  });

  // Test 9: A cancelled reminder is never picked up by dispatchDueReminders
  it("A cancelled reminder is never picked up by dispatchDueReminders", async () => {
    const pastDueInstant = new Date(Date.now() - 5000);
    const [cancelledRem] = await db
      .insert(reminders)
      .values({
        userId: testUserId,
        title: "Cancelled due reminder",
        triggerType: "exact_time",
        scheduledAt: pastDueInstant,
        status: "cancelled",
      })
      .returning();

    const dispatched = await reminderService.dispatchDueReminders(new Date());

    const dispatchedIds = dispatched.map((d) => d.reminderId);
    expect(dispatchedIds).not.toContain(cancelledRem.id);

    const [afterDispatch] = await db.select().from(reminders).where(eq(reminders.id, cancelledRem.id));
    expect(afterDispatch.status).toBe("cancelled");
    expect(afterDispatch.sentAt).toBeNull();
  });

  // Test 10: New users get autoReminders true; an existing user's saved false stays false
  it("New users get autoReminders true; an existing user's saved false stays false", async () => {
    // 1. Register brand new user
    const newEmail = `new_user_${uuidv4()}@example.com`;
    const regRes = await request(app)
      .post("/api/v1/auth/register")
      .send({
        email: newEmail,
        password: "ValidPassword123!",
      });

    expect(regRes.status).toBe(201);
    createdUserIds.push(regRes.body.user.id);

    // Verify in DB directly that default settings include autoReminders: true
    const [freshDbUser] = await db.select().from(users).where(eq(users.id, regRes.body.user.id));
    expect((freshDbUser.settings as any)?.autoReminders).toBe(true);

    // Activate user to access preferences API endpoint
    await db.update(users).set({ accountStatus: "active" }).where(eq(users.id, regRes.body.user.id));

    const newCookie = regRes.headers["set-cookie"]?.[0]?.split(";")[0];
    expect(newCookie).toBeDefined();

    const newPrefRes = await request(app)
      .get("/api/v1/reminders/preferences")
      .set("Cookie", newCookie);

    expect(newPrefRes.status).toBe(200);
    expect(newPrefRes.body.preferences.autoReminders).toBe(true);

    // 2. Existing user with saved false
    const existingEmail = `existing_false_${uuidv4()}@example.com`;
    const [existingUser] = await db
      .insert(users)
      .values({
        email: existingEmail,
        passwordHash: "dummy",
        settings: {
          autoReminders: false,
          timezone: "UTC",
        },
      })
      .returning();
    createdUserIds.push(existingUser.id);

    const existingToken = jwt.sign({ userId: existingUser.id }, JWT_SECRET);
    const existingCookie = `session=${existingToken}`;

    const existingPrefRes = await request(app)
      .get("/api/v1/reminders/preferences")
      .set("Cookie", existingCookie);

    expect(existingPrefRes.status).toBe(200);
    expect(existingPrefRes.body.preferences.autoReminders).toBe(false);
  });

  // Test 11: Google-created user gets autoReminders true via POST /api/v1/auth/google
  it("Google-created user gets autoReminders true via POST /api/v1/auth/google", async () => {
    const googleSub = `google_sub_${uuidv4()}`;
    const googleEmail = `google_user_${uuidv4()}@gmail.com`;

    const res = await request(app)
      .post("/api/v1/auth/google")
      .send({
        credential: `mock_google_token:${googleEmail}:${googleSub}`,
        timezone: "America/Chicago",
      });

    expect(res.status).toBe(200);

    const [createdUser] = await db.select().from(users).where(eq(users.googleId, googleSub));
    expect(createdUser).toBeDefined();
    createdUserIds.push(createdUser.id);

    expect(createdUser.authProvider).toBe("google");
    expect((createdUser.settings as any)?.autoReminders).toBe(true);
    expect((createdUser.settings as any)?.timezone).toBe("America/Chicago");
  });

  // Test 12: Reprocessing an item after its reminder is already 'sent' creates no second reminder
  it("Reprocessing an item after its reminder is already 'sent' creates no second reminder", async () => {
    const dueDate = new Date(Date.now() + 10 * 60 * 1000);
    const [item] = await db
      .insert(items)
      .values({
        userId: testUserId,
        title: "Item with already sent reminder",
        itemType: "task",
        status: "active",
        dueDate,
        metadata: { hasExplicitTime: true },
      })
      .returning();

    // 1. Initial reminder creation
    const created = await reminderService.createRemindersForItem(
      item.id,
      testUserId,
      item.title,
      dueDate,
      true,
      "UTC"
    );
    expect(created.length).toBe(1);

    // 2. Simulate dispatch marking the reminder as 'sent'
    await db
      .update(reminders)
      .set({ status: "sent", sentAt: new Date() })
      .where(eq(reminders.id, created[0].id));

    const [sentRem] = await db.select().from(reminders).where(eq(reminders.id, created[0].id));
    expect(sentRem.status).toBe("sent");

    // 3. Reprocess item (e.g. background retry, re-sync)
    const reprocessed = await reminderService.createRemindersForItem(
      item.id,
      testUserId,
      item.title,
      dueDate,
      true,
      "UTC"
    );

    // 4. Assert: still exactly 1 reminder in DB, its status remains 'sent', no duplicate created
    const allReminders = await db.select().from(reminders).where(eq(reminders.itemId, item.id));
    expect(allReminders.length).toBe(1);
    expect(allReminders[0].id).toBe(sentRem.id);
    expect(allReminders[0].status).toBe("sent");
  });

  // Test 13: PATCH dueDate edit with no hasExplicitTime in body preserves existing flag and persists it
  it("PATCH dueDate edit with no hasExplicitTime in body preserves existing flag and persists it", async () => {
    // Sub-case A: Existing item had hasExplicitTime: true
    const initialDueDate = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const [exactItem] = await db
      .insert(items)
      .values({
        userId: testUserId,
        title: "Exact Time Item to edit",
        itemType: "task",
        status: "active",
        dueDate: initialDueDate,
        metadata: { hasExplicitTime: true },
      })
      .returning();

    await reminderService.createRemindersForItem(
      exactItem.id,
      testUserId,
      exactItem.title,
      initialDueDate,
      true,
      "UTC"
    );

    const newDueDateExact = new Date(Date.now() + 5 * 60 * 60 * 1000);

    // PATCH with ONLY dueDate (no hasExplicitTime in body)
    const patchResExact = await request(app)
      .patch(`/api/v1/items/${exactItem.id}`)
      .set("Cookie", authCookie)
      .send({
        dueDate: newDueDateExact.toISOString(),
      });

    expect(patchResExact.status).toBe(200);

    // Verify flag was persisted in item metadata on edit
    const [updatedExactDbItem] = await db.select().from(items).where(eq(items.id, exactItem.id));
    expect((updatedExactDbItem.metadata as any)?.hasExplicitTime).toBe(true);

    // Verify exact-time reminder was rescheduled for new due date
    const exactReminders = await db
      .select()
      .from(reminders)
      .where(and(eq(reminders.itemId, exactItem.id), eq(reminders.status, "scheduled")));
    expect(exactReminders.length).toBe(1);
    expect(exactReminders[0].triggerType).toBe("exact_time");
    expect(Math.abs(new Date(exactReminders[0].scheduledAt).getTime() - newDueDateExact.getTime())).toBeLessThan(1000);

    // Sub-case B: Existing item had hasExplicitTime: false (date-only)
    const dateOnlyInitial = new Date(Date.now() + 25 * 24 * 60 * 60 * 1000);
    const [dateOnlyItem] = await db
      .insert(items)
      .values({
        userId: testUserId,
        title: "Date-only Item to edit",
        itemType: "task",
        status: "active",
        dueDate: dateOnlyInitial,
        metadata: { hasExplicitTime: false },
      })
      .returning();

    const newDueDateDateOnly = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000);

    const patchResDateOnly = await request(app)
      .patch(`/api/v1/items/${dateOnlyItem.id}`)
      .set("Cookie", authCookie)
      .send({
        dueDate: newDueDateDateOnly.toISOString(),
      });

    expect(patchResDateOnly.status).toBe(200);

    const [updatedDateOnlyDbItem] = await db.select().from(items).where(eq(items.id, dateOnlyItem.id));
    expect((updatedDateOnlyDbItem.metadata as any)?.hasExplicitTime).toBe(false);

    const ladderReminders = await db
      .select()
      .from(reminders)
      .where(and(eq(reminders.itemId, dateOnlyItem.id), eq(reminders.status, "scheduled")));
    expect(ladderReminders.length).toBeGreaterThan(1);
    for (const r of ladderReminders) {
      expect(r.triggerType).toBe("relative_to_deadline");
    }
  });
});
