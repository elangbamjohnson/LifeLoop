import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { v4 as uuidv4 } from "uuid";
import { db } from "../src/db";
import { users, reminders, notificationLogs } from "../src/db/schema";
import { eq, inArray } from "drizzle-orm";
import { reminderService, isTimeInQuietHours } from "../src/server/services/ReminderService";
import { remindersRouter } from "../src/server/api/v1/reminders";
import { createTestApp } from "./setup";

const app = createTestApp("/api/v1/reminders", remindersRouter);

describe("Automatic Background Reminder Dispatch & Quiet Hours Enforcement", () => {
  const testUserIds: string[] = [];

  afterAll(async () => {
    if (testUserIds.length > 0) {
      await db.delete(notificationLogs).where(inArray(notificationLogs.userId, testUserIds));
      await db.delete(reminders).where(inArray(reminders.userId, testUserIds));
      await db.delete(users).where(inArray(users.id, testUserIds));
    }
  });

  // Helper to create a user with specific quiet hours settings
  async function createTestUserWithSettings(settings: {
    timezone?: string;
    quietHoursEnabled?: boolean;
    quietHoursStart?: string;
    quietHoursEnd?: string;
  }) {
    const [user] = await db
      .insert(users)
      .values({
        email: `dispatch_${uuidv4()}@example.com`,
        passwordHash: "dummy_hash",
        settings: {
          timezone: settings.timezone || "America/New_York",
          quietHoursEnabled: settings.quietHoursEnabled ?? false,
          quietHoursStart: settings.quietHoursStart || "22:00",
          quietHoursEnd: settings.quietHoursEnd || "07:00",
        },
      })
      .returning();

    testUserIds.push(user.id);
    return user;
  }

  // 1. A reminder due now, outside quiet hours, dispatches successfully.
  it("A reminder due now, outside quiet hours, dispatches successfully", async () => {
    // User in America/New_York (EDT UTC-4 in October)
    // Quiet hours: 22:00 to 07:00
    // "Now" is 14:00 (2:00 PM) EDT -> outside quiet hours
    const user = await createTestUserWithSettings({
      timezone: "America/New_York",
      quietHoursEnabled: true,
      quietHoursStart: "22:00",
      quietHoursEnd: "07:00",
    });

    const now = new Date("2026-10-15T18:00:00Z"); // 14:00 EDT (outside quiet hours)
    const scheduledAt = new Date("2026-10-15T17:30:00Z"); // 13:30 EDT (due 30 mins ago)

    const [reminder] = await db
      .insert(reminders)
      .values({
        userId: user.id,
        title: "Afternoon Meeting Reminder",
        scheduledAt,
        status: "scheduled",
        channel: "web",
      })
      .returning();

    const results = await reminderService.dispatchDueReminders(now);

    // Assert dispatch succeeded
    const result = results.find((r: any) => r.payload?.tag?.includes(reminder.id) || r.status === "delivered");
    expect(result).toBeDefined();
    expect(result?.status).toBe("delivered");

    // Verify DB status transitioned to 'sent'
    const [dbReminder] = await db.select().from(reminders).where(eq(reminders.id, reminder.id));
    expect(dbReminder.status).toBe("sent");
    expect(dbReminder.sentAt).not.toBeNull();

    // Verify notification log created
    const logs = await db.select().from(notificationLogs).where(eq(notificationLogs.reminderId, reminder.id));
    expect(logs.length).toBe(1);
    expect(logs[0].status).toBe("delivered");
  });

  // 2. A reminder due now, inside quiet hours, does NOT dispatch at that moment (assert your chosen behavior from Requirement 3).
  it("A reminder due now, inside quiet hours, does NOT dispatch at that moment (held until quiet hours end)", async () => {
    // User in America/New_York (EDT UTC-4 in October)
    // Quiet hours: 22:00 to 07:00
    // "Now" is 23:15 EDT -> inside quiet hours
    const user = await createTestUserWithSettings({
      timezone: "America/New_York",
      quietHoursEnabled: true,
      quietHoursStart: "22:00",
      quietHoursEnd: "07:00",
    });

    const now = new Date("2026-10-16T03:15:00Z"); // 23:15 EDT (inside quiet hours)
    const scheduledAt = new Date("2026-10-16T03:00:00Z"); // 23:00 EDT (due 15 mins ago)

    const [reminder] = await db
      .insert(reminders)
      .values({
        userId: user.id,
        title: "Late Night Pill Reminder",
        scheduledAt,
        status: "scheduled",
        channel: "web",
      })
      .returning();

    const results = await reminderService.dispatchDueReminders(now);

    // Assert: reminder was held and NOT sent
    const heldResult = results.find((r: any) => r.reminderId === reminder.id);
    expect(heldResult).toBeDefined();
    expect(heldResult?.status).toBe("held_quiet_hours");
    expect(heldResult?.held).toBe(true);
    expect(heldResult?.reason).toBe("quiet_hours");

    // In DB, status remains/reverts to 'scheduled' (held without delivering)
    const [dbReminder] = await db.select().from(reminders).where(eq(reminders.id, reminder.id));
    expect(dbReminder.status).toBe("scheduled");
    expect(dbReminder.sentAt).toBeNull();

    // Verify NO notification logs were created (not delivered)
    const logs = await db.select().from(notificationLogs).where(eq(notificationLogs.reminderId, reminder.id));
    expect(logs.length).toBe(0);

    // Verify hold release: Once quiet hours pass (e.g. 07:05 AM next morning), it dispatches!
    const nextMorning = new Date("2026-10-16T11:05:00Z"); // 07:05 AM EDT (quiet hours ended at 07:00)
    const morningResults = await reminderService.dispatchDueReminders(nextMorning);

    const morningResult = morningResults.find((r: any) => r.status === "delivered");
    expect(morningResult).toBeDefined();

    const [dispatchedReminder] = await db.select().from(reminders).where(eq(reminders.id, reminder.id));
    expect(dispatchedReminder.status).toBe("sent");
  });

  // 3. Quiet hours spanning midnight: a reminder due at 23:30 with quiet hours 22:00–07:00 is correctly treated as "in quiet hours."
  it("Quiet hours spanning midnight: a reminder due at 23:30 with quiet hours 22:00–07:00 is correctly treated as 'in quiet hours.'", async () => {
    const user = await createTestUserWithSettings({
      timezone: "America/New_York",
      quietHoursEnabled: true,
      quietHoursStart: "22:00",
      quietHoursEnd: "07:00",
    });

    // 23:30 in America/New_York (EDT UTC-4) is 03:30 UTC next day
    const dueAt2330 = new Date("2026-10-16T03:30:00Z");

    // Pure unit check on utility
    const isQuiet = isTimeInQuietHours(dueAt2330, "22:00", "07:00", "America/New_York");
    expect(isQuiet).toBe(true);

    // End-to-end service check with a reminder
    const [reminder] = await db
      .insert(reminders)
      .values({
        userId: user.id,
        title: "Midnight Span Test Reminder",
        scheduledAt: dueAt2330,
        status: "scheduled",
        channel: "web",
      })
      .returning();

    const results = await reminderService.dispatchDueReminders(dueAt2330);

    // Assert: reminder at 23:30 was recognized as within quiet hours and held
    const held = results.find((r: any) => r.reminderId === reminder.id);
    expect(held?.status).toBe("held_quiet_hours");
    expect(held?.held).toBe(true);

    const [dbReminder] = await db.select().from(reminders).where(eq(reminders.id, reminder.id));
    expect(dbReminder.status).toBe("scheduled");
    expect(dbReminder.sentAt).toBeNull();
  });

  // 4. Concurrency: simulate two overlapping dispatch calls for the same due reminder
  // (e.g. call the dispatch function twice without awaiting the first) and assert the reminder is only sent once.
  it("Concurrency: simulate two overlapping dispatch calls for the same due reminder and assert the reminder is only sent once", async () => {
    const user = await createTestUserWithSettings({
      timezone: "UTC",
      quietHoursEnabled: false,
    });

    const now = new Date("2026-10-15T10:00:00Z");
    const [reminder] = await db
      .insert(reminders)
      .values({
        userId: user.id,
        title: "Concurrent Dispatch Test Reminder",
        scheduledAt: new Date("2026-10-15T09:55:00Z"),
        status: "scheduled",
        channel: "web",
      })
      .returning();

    // Execute two concurrent dispatch calls simultaneously without awaiting the first
    const [results1, results2] = await Promise.all([
      reminderService.dispatchDueReminders(now),
      reminderService.dispatchDueReminders(now),
    ]);

    // Combine delivered results for this reminder
    const allDelivered = [...results1, ...results2].filter(
      (r: any) => r.status === "delivered" && (r.idempotencyKey?.includes(reminder.id) || r.payload?.tag?.includes(reminder.id))
    );

    // Exactly one call should have successfully claimed and dispatched it
    expect(allDelivered.length).toBe(1);

    // Verify DB reminder was only marked sent once
    const [dbReminder] = await db.select().from(reminders).where(eq(reminders.id, reminder.id));
    expect(dbReminder.status).toBe("sent");

    // Verify notification logs table contains strictly 1 delivery record (no duplicate sends)
    const logs = await db.select().from(notificationLogs).where(eq(notificationLogs.reminderId, reminder.id));
    expect(logs.length).toBe(1);
    expect(logs[0].status).toBe("delivered");
  });

  // 5. Crash recovery: a reminder claimed but left in a stuck "dispatching" state past the timeout gets re-claimed and dispatched on the next run.
  it("Crash recovery: a reminder claimed but left in a stuck 'dispatching' state past the timeout gets re-claimed and dispatched on the next run", async () => {
    const user = await createTestUserWithSettings({
      timezone: "UTC",
      quietHoursEnabled: false,
    });

    const now = new Date("2026-10-15T12:00:00Z");
    // Reminder scheduled 15 minutes ago, but claimed and crashed 10 minutes ago
    const scheduledAt = new Date("2026-10-15T11:45:00Z");
    const stuckUpdatedAt = new Date("2026-10-15T11:50:00Z"); // 10 mins ago

    const [stuckReminder] = await db
      .insert(reminders)
      .values({
        userId: user.id,
        title: "Crashed Mid-Dispatch Recovery Reminder",
        scheduledAt,
        status: "dispatching", // Left in 'dispatching' state from a crashed process
        channel: "web",
        updatedAt: stuckUpdatedAt,
      })
      .returning();

    // Verify it is initially stuck in 'dispatching'
    expect(stuckReminder.status).toBe("dispatching");

    // Run dispatch with a 5-minute timeout threshold (10 mins ago > 5 mins threshold)
    const results = await reminderService.dispatchDueReminders(now, 5 * 60 * 1000);

    // Assert: the stuck reminder was re-claimed and delivered
    const recovered = results.find(
      (r: any) => r.status === "delivered" && (r.idempotencyKey?.includes(stuckReminder.id) || r.payload?.tag?.includes(stuckReminder.id))
    );
    expect(recovered).toBeDefined();
    expect(recovered?.status).toBe("delivered");

    // DB state is now 'sent'
    const [dbReminder] = await db.select().from(reminders).where(eq(reminders.id, stuckReminder.id));
    expect(dbReminder.status).toBe("sent");
    expect(dbReminder.sentAt).not.toBeNull();
  });

  // 6. External Cron Authentication: POST /api/v1/reminders/dispatch-now with X-Cron-Secret
  it("POST /api/v1/reminders/dispatch-now dispatches with valid X-Cron-Secret header", async () => {
    const originalSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "test_cron_secret_token_12345";

    try {
      // 1. Call with valid X-Cron-Secret header
      const res = await request(app)
        .post("/api/v1/reminders/dispatch-now")
        .set("X-Cron-Secret", "test_cron_secret_token_12345");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.trigger).toBe("cron");

      // 2. Call with valid Bearer token
      const resBearer = await request(app)
        .post("/api/v1/reminders/dispatch-now")
        .set("Authorization", "Bearer test_cron_secret_token_12345");

      expect(resBearer.status).toBe(200);
      expect(resBearer.body.success).toBe(true);
      expect(resBearer.body.trigger).toBe("cron");

      // 3. Call with invalid secret without cookie -> 401 Unauthorized
      const resInvalid = await request(app)
        .post("/api/v1/reminders/dispatch-now")
        .set("X-Cron-Secret", "wrong_secret");

      expect(resInvalid.status).toBe(401);
    } finally {
      process.env.CRON_SECRET = originalSecret;
    }
  });

  // 7. Specific Test: One-time reminder terminal status & non-reclaim after stuckTimeoutMs
  it("one-time reminder dispatches successfully, time advances past stuckTimeoutMs, dispatchDueReminders runs again, assert dispatch was called exactly once total across both runs", async () => {
    const user = await createTestUserWithSettings({
      timezone: "UTC",
      quietHoursEnabled: false,
    });

    const t0 = new Date("2026-10-15T10:00:00Z");
    const [reminder] = await db
      .insert(reminders)
      .values({
        userId: user.id,
        title: "One-Time Terminal Status Test Reminder",
        scheduledAt: new Date("2026-10-15T09:50:00Z"), // Due 10m before T0
        recurrence: "none",
        status: "scheduled",
        channel: "web",
      })
      .returning();

    // Run 1 at T0
    const resultsRun1 = await reminderService.dispatchDueReminders(t0, 5 * 60 * 1000);
    const deliveredRun1 = resultsRun1.filter(
      (r: any) => r.status === "delivered" && (r.idempotencyKey?.includes(reminder.id) || r.payload?.tag?.includes(reminder.id))
    );
    expect(deliveredRun1.length).toBe(1);

    // Assert status is now terminal 'sent'
    const [dbAfterRun1] = await db.select().from(reminders).where(eq(reminders.id, reminder.id));
    expect(dbAfterRun1.status).toBe("sent");

    // Advance time past stuckTimeoutMs (15 minutes past T0, well beyond 5m timeout)
    const tFuture = new Date(t0.getTime() + 15 * 60 * 1000);

    // Run 2 at tFuture
    const resultsRun2 = await reminderService.dispatchDueReminders(tFuture, 5 * 60 * 1000);
    const deliveredRun2 = resultsRun2.filter(
      (r: any) => r.status === "delivered" && (r.idempotencyKey?.includes(reminder.id) || r.payload?.tag?.includes(reminder.id))
    );
    expect(deliveredRun2.length).toBe(0);

    // Assert dispatch was called exactly once total across both runs
    const totalDelivered = [...deliveredRun1, ...deliveredRun2];
    expect(totalDelivered.length).toBe(1);

    // Assert notification logs table only has 1 record for this reminder
    const logs = await db.select().from(notificationLogs).where(eq(notificationLogs.reminderId, reminder.id));
    expect(logs.length).toBe(1);
  });
});
