import { db } from "../../db";
import { reminders, items, users } from "../../db/schema";
import { eq, and, lte, or } from "drizzle-orm";
import { notificationDispatcher } from "./NotificationProvider";
import { eventBus } from "./EventBus";

export interface CreateReminderParams {
  userId: string;
  itemId?: string;
  title: string;
  triggerType?: "exact_time" | "relative_to_deadline";
  relativeOffsetDays?: number; // e.g. -30, -7, -1, 0
  baseDeadline?: Date;
  scheduledAt?: Date;
  recurrence?: "none" | "daily" | "weekly" | "monthly" | "yearly";
  channel?: "web" | "ios" | "android" | "email";
  timezone?: string; // e.g. 'America/New_York', 'UTC', etc.
  targetHour?: number; // default 9 (9:00 AM)
  targetMinute?: number; // default 0
}

/**
 * Evaluates whether a given instant falls inside a user's quiet hours in their local timezone.
 * Handles both standard daytime/evening windows and windows spanning midnight (e.g. 22:00 to 07:00).
 */
export function isTimeInQuietHours(
  date: Date,
  quietHoursStart: string = "22:00",
  quietHoursEnd: string = "08:00",
  timezone: string = "UTC"
): boolean {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    });

    const parts = formatter.formatToParts(date);
    const hourPart = parts.find((p) => p.type === "hour")?.value ?? "0";
    const minutePart = parts.find((p) => p.type === "minute")?.value ?? "0";

    const currentHour = parseInt(hourPart, 10) % 24;
    const currentMinute = parseInt(minutePart, 10);
    const currentMinutes = currentHour * 60 + currentMinute;

    const [startH, startM] = quietHoursStart.split(":").map((v) => parseInt(v, 10) || 0);
    const [endH, endM] = quietHoursEnd.split(":").map((v) => parseInt(v, 10) || 0);

    const startMinutes = (startH % 24) * 60 + startM;
    const endMinutes = (endH % 24) * 60 + endM;

    if (startMinutes === endMinutes) {
      return false;
    }

    if (startMinutes < endMinutes) {
      // Normal range within same day (e.g. 13:00 to 17:00)
      return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    } else {
      // Range spanning midnight (e.g. 22:00 to 07:00)
      return currentMinutes >= startMinutes || currentMinutes < endMinutes;
    }
  } catch (err) {
    console.error(`[isTimeInQuietHours] Error checking quiet hours for timezone ${timezone}:`, err);
    return false;
  }
}

export class ReminderService {
  private schedulerInterval: NodeJS.Timeout | null = null;
  /**
   * Safely calculates a scheduled date accounting for day offset and timezone / DST.
   * Uses wall-clock calculation in user's timezone so that a 9:00 AM reminder stays 9:00 AM
   * even across Daylight Saving Time boundaries.
   */
  calculateScheduledDate(
    baseDate: Date,
    offsetDays: number = 0,
    targetHour: number = 9,
    targetMinute: number = 0,
    timezone: string = "UTC"
  ): Date {
    // 1. Convert baseDate to formatted YYYY-MM-DD in the specified timezone
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

    const parts = formatter.formatToParts(baseDate);
    const yearPart = parts.find((p) => p.type === "year")?.value;
    const monthPart = parts.find((p) => p.type === "month")?.value;
    const dayPart = parts.find((p) => p.type === "day")?.value;

    const baseYear = parseInt(yearPart || `${baseDate.getUTCFullYear()}`, 10);
    const baseMonth = parseInt(monthPart || `${baseDate.getUTCMonth() + 1}`, 10) - 1;
    const baseDay = parseInt(dayPart || `${baseDate.getUTCDate()}`, 10);

    // 2. Add day offset in wall-clock days
    const wallDate = new Date(Date.UTC(baseYear, baseMonth, baseDay + offsetDays, targetHour, targetMinute, 0, 0));

    // 3. Adjust for timezone offset at that target instant
    // Calculate the difference between UTC and local time in the given timezone
    const targetIsoString = wallDate.toISOString();
    const tzDateStr = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(wallDate);

    // Construct equivalent Date object
    const [dPart, tPart] = tzDateStr.split(", ");
    const [m, d, y] = dPart.split("/").map(Number);
    const [h, min, s] = tPart.split(":").map(Number);
    const asInTz = Date.UTC(y, m - 1, d, h % 24, min, s);
    const offsetMs = asInTz - wallDate.getTime();

    // The true UTC instant when the user's wall clock shows targetHour:targetMinute
    return new Date(wallDate.getTime() - offsetMs);
  }

  /**
   * Calculates next recurrence date preserving time and accounting for DST.
   */
  calculateNextRecurrence(
    currentDate: Date,
    recurrence: "none" | "daily" | "weekly" | "monthly" | "yearly",
    timezone: string = "UTC"
  ): Date | null {
    if (recurrence === "none") return null;

    const d = new Date(currentDate);

    switch (recurrence) {
      case "daily":
        return this.calculateScheduledDate(d, 1, d.getUTCHours(), d.getUTCMinutes(), timezone);
      case "weekly":
        return this.calculateScheduledDate(d, 7, d.getUTCHours(), d.getUTCMinutes(), timezone);
      case "monthly": {
        const nextMonth = new Date(d);
        nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
        return nextMonth;
      }
      case "yearly": {
        const nextYear = new Date(d);
        nextYear.setUTCFullYear(nextYear.getUTCFullYear() + 1);
        return nextYear;
      }
      default:
        return null;
    }
  }

  /**
   * Creates a single reminder record.
   */
  async createReminder(params: CreateReminderParams) {
    let scheduledAt = params.scheduledAt;

    if (!scheduledAt && params.baseDeadline) {
      scheduledAt = this.calculateScheduledDate(
        params.baseDeadline,
        params.relativeOffsetDays ?? 0,
        params.targetHour ?? 9,
        params.targetMinute ?? 0,
        params.timezone || "UTC"
      );
    }

    if (!scheduledAt) {
      throw new Error("Either scheduledAt or baseDeadline must be provided");
    }

    const [newReminder] = await db
      .insert(reminders)
      .values({
        userId: params.userId,
        itemId: params.itemId || null,
        title: params.title,
        triggerType: params.triggerType || (params.relativeOffsetDays !== undefined ? "relative_to_deadline" : "exact_time"),
        relativeOffsetDays: params.relativeOffsetDays ?? 0,
        scheduledAt,
        recurrence: params.recurrence || "none",
        channel: params.channel || "web",
        status: "scheduled",
      })
      .returning();

    eventBus.publish(params.userId, {
      type: "changed",
      entity: "reminder",
      id: newReminder.id,
      at: new Date().toISOString(),
    });

    return newReminder;
  }

  /**
   * Automatically creates standard deadline-relative reminders for an item
   * (e.g. 30 days before, 7 days before, 1 day before, on the day)
   */
  async createStandardRelativeReminders(
    itemId: string,
    userId: string,
    itemTitle: string,
    dueDate: Date,
    offsets: number[] = [-30, -7, -1, 0],
    channel: "web" | "ios" | "android" | "email" = "web",
    timezone: string = "UTC"
  ) {
    const created = [];
    const now = new Date();

    for (const offset of offsets) {
      const scheduledAt = this.calculateScheduledDate(dueDate, offset, 9, 0, timezone);
      
      // Only schedule future or near-future reminders
      if (scheduledAt.getTime() > now.getTime() - 24 * 60 * 60 * 1000) {
        let label = "Due today";
        if (offset === -1) label = "Due tomorrow (1 day before)";
        else if (offset < 0) label = `Due in ${Math.abs(offset)} days`;

        const [r] = await db
          .insert(reminders)
          .values({
            userId,
            itemId,
            title: `${itemTitle} - ${label}`,
            triggerType: "relative_to_deadline",
            relativeOffsetDays: offset,
            scheduledAt,
            recurrence: "none",
            channel,
            status: "scheduled",
          })
          .returning();
        created.push(r);
      }
    }

    if (created.length > 0) {
      eventBus.publish(userId, {
        type: "changed",
        entity: "reminder",
        at: new Date().toISOString(),
      });
    }

    return created;
  }

  /**
   * Reschedules all relative_to_deadline reminders when an item's deadline changes.
   */
  async rescheduleForDeadlineChange(itemId: string, newDueDate: Date, timezone: string = "UTC") {
    const existing = await db
      .select()
      .from(reminders)
      .where(and(eq(reminders.itemId, itemId), eq(reminders.triggerType, "relative_to_deadline")));

    const updated = [];
    for (const reminder of existing) {
      const newScheduledAt = this.calculateScheduledDate(
        newDueDate,
        reminder.relativeOffsetDays ?? 0,
        9,
        0,
        timezone
      );

      const [u] = await db
        .update(reminders)
        .set({
          scheduledAt: newScheduledAt,
          status: "scheduled", // Reactivate if it was previously triggered
        })
        .where(eq(reminders.id, reminder.id))
        .returning();
      updated.push(u);
    }

    if (updated.length > 0 && existing[0]?.userId) {
      eventBus.publish(existing[0].userId, {
        type: "changed",
        entity: "reminder",
        at: new Date().toISOString(),
      });
    }

    return updated;
  }

  /**
   * Snoozes a reminder for a duration or to a specific date.
   */
  async snoozeReminder(reminderId: string, snoozeUntil: Date) {
    const [updated] = await db
      .update(reminders)
      .set({
        status: "snoozed",
        snoozedUntil: snoozeUntil,
        scheduledAt: snoozeUntil,
      })
      .where(eq(reminders.id, reminderId))
      .returning();

    if (updated) {
      eventBus.publish(updated.userId, {
        type: "changed",
        entity: "reminder",
        id: updated.id,
        at: new Date().toISOString(),
      });
    }

    return updated;
  }

  /**
   * Snoozes an item (and adjusts its reminders).
   */
  async snoozeItem(itemId: string, userId: string, snoozeUntil: Date) {
    const [updatedItem] = await db
      .update(items)
      .set({
        snoozedUntil: snoozeUntil,
        status: "snoozed",
      })
      .where(and(eq(items.id, itemId), eq(items.userId, userId)))
      .returning();

    if (updatedItem) {
      eventBus.publish(userId, {
        type: "changed",
        entity: "item",
        id: updatedItem.id,
        at: new Date().toISOString(),
      });
      eventBus.publish(userId, {
        type: "changed",
        entity: "reminder",
        at: new Date().toISOString(),
      });
    }

    return updatedItem;
  }

  /**
   * Completes an item and marks all associated reminders as dismissed.
   */
  async completeItem(itemId: string, userId: string, completed: boolean = true) {
    const [updatedItem] = await db
      .update(items)
      .set({
        status: completed ? "completed" : "active",
        completedAt: completed ? new Date() : null,
      })
      .where(and(eq(items.id, itemId), eq(items.userId, userId)))
      .returning();

    if (!updatedItem) return undefined;

    if (completed) {
      await db
        .update(reminders)
        .set({ status: "dismissed" })
        .where(eq(reminders.itemId, itemId));
    } else {
      await db
        .update(reminders)
        .set({ status: "scheduled" })
        .where(eq(reminders.itemId, itemId));
    }

    eventBus.publish(userId, {
      type: "changed",
      entity: "item",
      id: updatedItem.id,
      at: new Date().toISOString(),
    });
    eventBus.publish(userId, {
      type: "changed",
      entity: "reminder",
      at: new Date().toISOString(),
    });

    return updatedItem;
  }

  /**
   * Dispatches due reminders across all configured channels.
   * Concurrency-safe: atomically claims eligible rows to 'dispatching' in the DB so concurrent workers never double-send.
   * Crash-resilient: reclaims reminders stuck in 'dispatching' past stuckTimeoutMs.
   * Quiet-hours aware: respects user's quiet hours in their local timezone; holds reminders until quiet hours end.
   */
  async dispatchDueReminders(
    now: Date = new Date(),
    stuckTimeoutMs: number = 5 * 60 * 1000
  ) {
    const stuckThreshold = new Date(now.getTime() - stuckTimeoutMs);

    // 1. Concurrency-safe atomic DB claim step
    // Matches reminders that are:
    // - due ('scheduled' or 'snoozed' with scheduledAt <= now)
    // - OR stuck in 'dispatching' state older than stuckThreshold (crash recovery)
    const claimedReminders = await db
      .update(reminders)
      .set({
        status: "dispatching",
        updatedAt: now,
      })
      .where(
        or(
          and(
            or(eq(reminders.status, "scheduled"), eq(reminders.status, "snoozed")),
            lte(reminders.scheduledAt, now)
          ),
          and(
            eq(reminders.status, "dispatching"),
            lte(reminders.updatedAt, stuckThreshold)
          )
        )
      )
      .returning();

    if (claimedReminders.length === 0) {
      return [];
    }

    const results = [];
    for (const reminder of claimedReminders) {
      try {
        // 2. Fetch user settings for quiet hours and timezone check
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.id, reminder.userId))
          .limit(1);

        const settings = (user?.settings as any) || {};
        const quietHoursEnabled = settings.quietHoursEnabled === true;
        const quietHoursStart = settings.quietHoursStart || "22:00";
        const quietHoursEnd = settings.quietHoursEnd || "08:00";
        const userTimezone = settings.timezone || "UTC";

        // 3. Quiet hours check: hold reminder if currently within quiet hours
        if (quietHoursEnabled && isTimeInQuietHours(now, quietHoursStart, quietHoursEnd, userTimezone)) {
          // Chosen behavior: Option (a) - Hold reminder until quiet hours end.
          // Release claim back to 'scheduled' without changing original scheduledAt.
          await db
            .update(reminders)
            .set({
              status: "scheduled",
              updatedAt: now,
            })
            .where(eq(reminders.id, reminder.id));

          results.push({
            reminderId: reminder.id,
            userId: reminder.userId,
            channel: reminder.channel as any,
            status: "held_quiet_hours",
            held: true,
            reason: "quiet_hours",
          });
          continue;
        }

        // 4. Dispatch via notificationDispatcher
        const result = await notificationDispatcher.dispatch({
          reminderId: reminder.id,
          userId: reminder.userId,
          title: reminder.title,
          body: `LifeLoop Reminder: ${reminder.title}`,
          channel: (reminder.channel as any) || "web",
          scheduledAt: reminder.scheduledAt,
          itemId: reminder.itemId || undefined,
        });

        // 5. Handle recurrence or explicit terminal status
        if (reminder.recurrence && reminder.recurrence !== "none") {
          const nextScheduled = this.calculateNextRecurrence(reminder.scheduledAt, reminder.recurrence as any, userTimezone);
          if (nextScheduled) {
            await db
              .update(reminders)
              .set({
                scheduledAt: nextScheduled,
                status: "scheduled",
                sentAt: now,
                updatedAt: now,
              })
              .where(eq(reminders.id, reminder.id));
          }
        } else {
          // Explicit terminal status: mark non-recurring reminder as 'sent' immediately in the same code path
          await db
            .update(reminders)
            .set({
              status: "sent",
              sentAt: now,
              updatedAt: now,
            })
            .where(eq(reminders.id, reminder.id));
        }

        results.push(result);
        eventBus.publish(reminder.userId, {
          type: "changed",
          entity: "reminder",
          id: reminder.id,
          at: now.toISOString(),
        });
      } catch (err: any) {
        console.error(`Failed to dispatch reminder ${reminder.id}:`, err);
        // Release claim on unexpected error so it can be retried on next run
        await db
          .update(reminders)
          .set({
            status: "scheduled",
            updatedAt: now,
          })
          .where(eq(reminders.id, reminder.id));
      }
    }

    return results;
  }

  startScheduler(intervalMs: number = 60000) {
    if (this.schedulerInterval) return;
    this.schedulerInterval = setInterval(async () => {
      try {
        await this.dispatchDueReminders();
      } catch (err) {
        console.error("[ReminderScheduler] Error during automatic dispatch:", err);
      }
    }, intervalMs);

    if (this.schedulerInterval.unref) {
      this.schedulerInterval.unref();
    }
  }

  stopScheduler() {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
    }
  }
}

export const reminderService = new ReminderService();
