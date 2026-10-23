import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import { itemsRouter } from "../src/server/api/v1/items";
import { remindersRouter } from "../src/server/api/v1/reminders";
import { db } from "../src/db";
import { users, items, reminders, notificationLogs } from "../src/db/schema";
import { eq, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { reminderService } from "../src/server/services/ReminderService";
import { notificationDispatcher } from "../src/server/services/NotificationProvider";

import { createTestApp } from './setup';

const app = createTestApp('/api/v1/items', itemsRouter);

const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret_for_development_only";

describe("Phase 3: Reminders, Life Timeline & Real Dashboard", () => {
  let testUserId: string;
  let authCookie: string;
  let sampleItemId: string;

  beforeAll(async () => {
    // 1. Create a dedicated test user
    const [user] = await db
      .insert(users)
      .values({
        email: `phase3_${uuidv4()}@example.com`,
        passwordHash: "dummy",
        settings: {
          timezone: "America/New_York",
          autoReminders: false,
          channels: ["web", "email"],
        },
      })
      .returning();

    testUserId = user.id;
    const token = jwt.sign({ userId: user.id }, JWT_SECRET);
    authCookie = `session=${token}`;

    // 2. Create sample item (Electricity bill due in future)
    const [item] = await db
      .insert(items)
      .values({
        userId: testUserId,
        title: "Electricity bill",
        itemType: "payment",
        status: "active",
        dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        metadata: { amount: 2840, currency: "INR" },
        confidenceScore: 0.95,
      })
      .returning();

    sampleItemId = item.id;
  });

  afterAll(async () => {
    await db.delete(notificationLogs).where(eq(notificationLogs.userId, testUserId));
    await db.delete(reminders).where(eq(reminders.userId, testUserId));
    await db.delete(items).where(eq(items.userId, testUserId));
    await db.delete(users).where(eq(users.id, testUserId));
  });

  // Test 1: Timezone handling
  it("should accurately schedule reminders across distinct timezones", () => {
    const baseDate = new Date("2026-09-18T12:00:00Z");
    
    // Schedule for 9:00 AM in America/New_York (UTC-4 in Sep DST)
    const nyDate = reminderService.calculateScheduledDate(baseDate, 0, 9, 0, "America/New_York");
    // Schedule for 9:00 AM in Asia/Kolkata (UTC+5:30)
    const istDate = reminderService.calculateScheduledDate(baseDate, 0, 9, 0, "Asia/Kolkata");

    expect(nyDate.toISOString()).toBe("2026-09-18T13:00:00.000Z"); // 09:00 EDT = 13:00 UTC
    expect(istDate.toISOString()).toBe("2026-09-18T03:30:00.000Z"); // 09:00 IST = 03:30 UTC
  });

  // Test 2: Daylight-saving transitions
  it("should preserve wall-clock time across Daylight-Saving (DST) boundary", () => {
    // In US Eastern time, DST ends on Nov 1, 2026 (clocks fall back 1 hour from EDT UTC-4 to EST UTC-5)
    const summerDate = new Date("2026-10-25T12:00:00Z");
    const winterDate = new Date("2026-11-08T12:00:00Z");

    const summer9am = reminderService.calculateScheduledDate(summerDate, 0, 9, 0, "America/New_York");
    const winter9am = reminderService.calculateScheduledDate(winterDate, 0, 9, 0, "America/New_York");

    // During summer/EDT: 9am local = 13:00 UTC
    expect(summer9am.getUTCHours()).toBe(13);
    // During winter/EST: 9am local = 14:00 UTC (preserved local wall-clock time!)
    expect(winter9am.getUTCHours()).toBe(14);
  });

  // Test 3: Relative reminders & deadline offsets (30d, 7d, 1d, 0d)
  it("should create relative reminders for an item", async () => {
    const res = await request(app)
      .post("/api/v1/reminders/standard-relative")
      .set("Cookie", authCookie)
      .send({
        itemId: sampleItemId,
        offsets: [-30, -7, -1, 0],
        channel: "web",
      });

    expect(res.status).toBe(201);
    expect(res.body.reminders).toBeInstanceOf(Array);
    expect(res.body.reminders.length).toBeGreaterThanOrEqual(1);

    const offsetsFound = res.body.reminders.map((r: any) => r.relativeOffsetDays);
    expect(offsetsFound).toContain(0);
  });

  // Test 4: Recurring reminders calculation
  it("should calculate next occurrence for recurring reminders (daily, weekly, monthly, yearly)", () => {
    const start = new Date("2026-09-14T09:00:00Z");

    const nextDaily = reminderService.calculateNextRecurrence(start, "daily");
    const nextWeekly = reminderService.calculateNextRecurrence(start, "weekly");
    const nextMonthly = reminderService.calculateNextRecurrence(start, "monthly");
    const nextYearly = reminderService.calculateNextRecurrence(start, "yearly");

    expect(nextDaily?.toISOString()).toBe("2026-09-15T09:00:00.000Z");
    expect(nextWeekly?.toISOString()).toBe("2026-09-21T09:00:00.000Z");
    expect(nextMonthly?.getUTCMonth()).toBe(9); // October
    expect(nextYearly?.getUTCFullYear()).toBe(2027);
  });

  // Test 5: Changed deadlines recalculate relative reminders
  it("should automatically reschedule relative reminders when item deadline changes", async () => {
    // Dynamically compute future date to avoid time-decay failure
    const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const newDueDate = futureDate.toISOString();

    const res = await request(app)
      .patch(`/api/v1/items/${sampleItemId}`)
      .set("Cookie", authCookie)
      .send({ dueDate: newDueDate });

    expect(res.status).toBe(200);

    // Verify reminders were updated to match the new date
    const remindersRes = await request(app)
      .get(`/api/v1/items/${sampleItemId}/reminders`)
      .set("Cookie", authCookie);

    expect(remindersRes.status).toBe(200);
    const sameDayReminder = remindersRes.body.reminders.find(
      (r: any) => r.relativeOffsetDays === 0 && r.status === "scheduled"
    );
    expect(sameDayReminder).toBeDefined();
    expect(new Date(sameDayReminder.scheduledAt).getUTCMonth()).toBe(futureDate.getUTCMonth());
    expect(new Date(sameDayReminder.scheduledAt).getUTCDate()).toBe(futureDate.getUTCDate());
  });

  // Test 6: Snooze and Completion
  it("should support snoozing and completing an item", async () => {
    // Snooze item
    const snoozeRes = await request(app)
      .post(`/api/v1/items/${sampleItemId}/snooze`)
      .set("Cookie", authCookie)
      .send({ snoozeDays: 3 });

    expect(snoozeRes.status).toBe(200);
    expect(snoozeRes.body.item.status).toBe("snoozed");
    expect(snoozeRes.body.item.snoozedUntil).toBeTruthy();

    // Complete item
    const completeRes = await request(app)
      .post(`/api/v1/items/${sampleItemId}/complete`)
      .set("Cookie", authCookie)
      .send({ completed: true });

    expect(completeRes.status).toBe(200);
    expect(completeRes.body.item.status).toBe("completed");
    expect(completeRes.body.item.completedAt).toBeTruthy();
  });

  // Test 7: Duplicate notification prevention (Idempotency)
  it("should prevent duplicate notifications for the same reminder and trigger time", async () => {
    const testReminder = await reminderService.createReminder({
      userId: testUserId,
      title: "Idempotency Test",
      scheduledAt: new Date("2026-09-14T10:00:00Z"),
      channel: "web",
    });

    const payload = {
      reminderId: testReminder.id,
      userId: testUserId,
      title: testReminder.title,
      body: "Test notification body",
      channel: "web" as const,
      scheduledAt: testReminder.scheduledAt,
    };

    // First dispatch -> should deliver
    const firstResult = await notificationDispatcher.dispatch(payload);
    expect(firstResult.status).toBe("delivered");

    // Second dispatch (identical key) -> should block duplicate and return cached/existing record
    const secondResult = await notificationDispatcher.dispatch(payload);
    expect(secondResult.idempotencyKey).toBe(firstResult.idempotencyKey);

    // Verify DB only has 1 log entry
    const logs = await db
      .select()
      .from(notificationLogs)
      .where(eq(notificationLogs.reminderId, testReminder.id));
    expect(logs.length).toBe(1);
  });

  // Test 8: Offline device queueing
  it("should queue notification when device is marked offline", async () => {
    const offlineReminder = await reminderService.createReminder({
      userId: testUserId,
      title: "Offline Sync Test",
      scheduledAt: new Date("2026-09-14T11:00:00Z"),
      channel: "web",
    });

    const result = await notificationDispatcher.dispatch({
      reminderId: offlineReminder.id,
      userId: testUserId,
      title: offlineReminder.title,
      body: "Will deliver when reconnected",
      channel: "web",
      scheduledAt: offlineReminder.scheduledAt,
      metadata: { isDeviceOffline: true },
    });

    expect(result.status).toBe("queued");
  });

  // Test 9: Reminder preferences
  it("should read and update user reminder preferences", async () => {
    const getRes = await request(app)
      .get("/api/v1/reminders/preferences")
      .set("Cookie", authCookie);

    expect(getRes.status).toBe(200);
    expect(getRes.body.preferences).toHaveProperty("autoReminders");

    const updateRes = await request(app)
      .put("/api/v1/reminders/preferences")
      .set("Cookie", authCookie)
      .send({
        autoReminders: true,
        quietHoursEnabled: true,
        quietHoursStart: "23:00",
        quietHoursEnd: "07:00",
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.preferences.autoReminders).toBe(true);
    expect(updateRes.body.preferences.quietHoursStart).toBe("23:00");
  });

  // Test 10: Life Timeline grouping
  it("should return intelligently grouped Life Timeline sections", async () => {
    const res = await request(app)
      .get("/api/v1/items/timeline")
      .set("Cookie", authCookie);

    expect(res.status).toBe(200);
    expect(res.body.timeline).toHaveProperty("needsAttention");
    expect(res.body.timeline).toHaveProperty("today");
    expect(res.body.timeline).toHaveProperty("tomorrow");
    expect(res.body.timeline).toHaveProperty("thisWeek");
    expect(res.body.timeline).toHaveProperty("upcoming");
    expect(res.body.timeline).toHaveProperty("waitingFor");
    expect(res.body.timeline).toHaveProperty("past");
  });

  // Test 11: Deleted items cascade and delete reminders
  it("should cascade delete all associated reminders when an item is deleted", async () => {
    // Create temporary item with reminder
    const [tempItem] = await db
      .insert(items)
      .values({
        userId: testUserId,
        title: "Item to be deleted",
        itemType: "task",
        status: "active",
      })
      .returning();

    await reminderService.createReminder({
      userId: testUserId,
      itemId: tempItem.id,
      title: "Temp reminder",
      scheduledAt: new Date(),
    });

    // Delete item
    const deleteRes = await request(app)
      .delete(`/api/v1/items/${tempItem.id}`)
      .set("Cookie", authCookie);

    expect(deleteRes.status).toBe(200);

    // Verify reminder is gone
    const remainingReminders = await db
      .select()
      .from(reminders)
      .where(eq(reminders.itemId, tempItem.id));

    expect(remainingReminders.length).toBe(0);
  });

  // Test 12: Direct reminder PATCH (Update)
  it("should update reminder title, time, and recurrence via PATCH /api/v1/reminders/:id", async () => {
    const [rem] = await db
      .insert(reminders)
      .values({
        userId: testUserId,
        title: "Initial Reminder Title",
        scheduledAt: new Date("2026-10-01T10:00:00Z"),
        channel: "web",
      })
      .returning();

    const newTime = "2026-10-05T14:00:00.000Z";
    const res = await request(app)
      .patch(`/api/v1/reminders/${rem.id}`)
      .set("Cookie", authCookie)
      .send({
        title: "Updated Reminder Title",
        scheduledAt: newTime,
        recurrence: "weekly",
      });

    expect(res.status).toBe(200);
    expect(res.body.reminder.title).toBe("Updated Reminder Title");
    expect(res.body.reminder.recurrence).toBe("weekly");
    expect(new Date(res.body.reminder.scheduledAt).toISOString()).toBe(newTime);
  });

  // Test 13: Direct reminder DELETE
  it("should delete an individual reminder via DELETE /api/v1/reminders/:id", async () => {
    const [rem] = await db
      .insert(reminders)
      .values({
        userId: testUserId,
        title: "To Be Deleted Reminder",
        scheduledAt: new Date("2026-10-10T10:00:00Z"),
        channel: "web",
      })
      .returning();

    const res = await request(app)
      .delete(`/api/v1/reminders/${rem.id}`)
      .set("Cookie", authCookie);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const check = await db.select().from(reminders).where(eq(reminders.id, rem.id));
    expect(check.length).toBe(0);
  });

  // Test 14: Overdue item categorization and chronological sorting in timeline
  it("should categorize past-due items in needsAttention/past and maintain timeline ordering", async () => {
    // Insert an overdue item (due 3 days ago)
    const [overdueItem] = await db
      .insert(items)
      .values({
        userId: testUserId,
        title: "Overdue Gas Bill",
        itemType: "payment",
        status: "active",
        dueDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      })
      .returning();

    const res = await request(app)
      .get("/api/v1/items/timeline")
      .set("Cookie", authCookie);

    expect(res.status).toBe(200);
    const needsAttention = res.body.timeline.needsAttention;
    expect(needsAttention).toBeInstanceOf(Array);
    expect(needsAttention.some((i: any) => i.id === overdueItem.id)).toBe(true);

    // Cleanup overdue item
    await db.delete(items).where(eq(items.id, overdueItem.id));
  });

  // Test 15: Cross-user reminder IDOR protection
  it("should prevent User B from updating or deleting User A's reminder", async () => {
    // Create User B
    const [userB] = await db
      .insert(users)
      .values({ email: `userb_rem_${uuidv4()}@example.com`, passwordHash: "dummy" })
      .returning();
    const userBCookie = `session=${jwt.sign({ userId: userB.id }, JWT_SECRET)}`;

    const [userAReminder] = await db
      .insert(reminders)
      .values({
        userId: testUserId,
        title: "User A Sensitive Reminder",
        scheduledAt: new Date("2026-11-01T10:00:00Z"),
        channel: "web",
      })
      .returning();

    // User B attempts to PATCH User A's reminder -> 404 (ownership check)
    const patchRes = await request(app)
      .patch(`/api/v1/reminders/${userAReminder.id}`)
      .set("Cookie", userBCookie)
      .send({ title: "Hacked Title" });
    expect(patchRes.status).toBe(404);

    // User B attempts to DELETE User A's reminder -> 404 (ownership check)
    const deleteRes = await request(app)
      .delete(`/api/v1/reminders/${userAReminder.id}`)
      .set("Cookie", userBCookie);
    expect(deleteRes.status).toBe(404);

    // Cleanup
    await db.delete(reminders).where(eq(reminders.id, userAReminder.id));
    await db.delete(users).where(eq(users.id, userB.id));
  });

  afterAll(async () => {
    if (testUserId) {
      await db.delete(users).where(eq(users.id, testUserId));
    }
  });
});
