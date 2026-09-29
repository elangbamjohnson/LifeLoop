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
  metadata?: any;
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
        metadata: { manual: true, ...(params.metadata || {}) },
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
    timezone: string = "UTC",
    tx?: any,
    eventsCollector?: Array<{ userId: string; event: any }>
  ) {
    const execute = async (client: any, events: Array<{ userId: string; event: any }>) => {
      const created = [];
      const now = new Date();

      for (const offset of offsets) {
        const scheduledAt = this.calculateScheduledDate(dueDate, offset, 9, 0, timezone);
        
        // Only schedule future or near-future reminders
        if (scheduledAt.getTime() > now.getTime() - 24 * 60 * 60 * 1000) {
          // Idempotency check: dedupe on (itemId, triggerType="relative_to_deadline", relativeOffsetDays=offset, scheduledAt)
          const existing = await client
            .select()
            .from(reminders)
            .where(
              and(
                eq(reminders.itemId, itemId),
                eq(reminders.triggerType, "relative_to_deadline"),
                eq(reminders.relativeOffsetDays, offset),
                or(
                  eq(reminders.status, "scheduled"),
                  eq(reminders.status, "snoozed"),
                  eq(reminders.status, "dispatching"),
                  eq(reminders.status, "sent")
                )
              )
            );

          const duplicate = existing.find(
            (r: any) =>
              ((r.metadata as any)?.autoCreated === true || !(r.metadata as any)?.manual) &&
              Math.abs(new Date(r.scheduledAt).getTime() - scheduledAt.getTime()) < 1000
          );

          if (duplicate) continue;

          let label = "Due today";
          if (offset === -1) label = "Due tomorrow (1 day before)";
          else if (offset < 0) label = `Due in ${Math.abs(offset)} days`;

          const [r] = await client
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
              metadata: { autoCreated: true },
            })
            .returning();
          created.push(r);
        }
      }

      if (created.length > 0) {
        events.push({
          userId,
          event: {
            type: "changed",
            entity: "reminder",
            at: new Date().toISOString(),
          },
        });
      }

      return created;
    };

    if (tx) {
      return execute(tx, eventsCollector || []);
    } else {
      const localEvents: Array<{ userId: string; event: any }> = [];
      const result = await db.transaction(async (newTx) => execute(newTx, localEvents));
      for (const e of localEvents) {
        eventBus.publish(e.userId, e.event);
      }
      return result;
    }
  }

  /**
   * Creates reminders for an item obeying exact-time vs date-only rules:
   * Rule 2 (hasExplicitTime): exactly one reminder at due instant if not >60s past.
   * Rule 3 (date-only): ladder offsets [-30, -7, -1, 0] at 9:00 AM local time.
   * Rule 4 (Serialization): locks item row (FOR UPDATE) at start of transaction.
   * Rule 6 (Idempotency): wrapped in a transaction; dedupes on (itemId, triggerType, scheduledAt/offset).
   */
  async createRemindersForItem(
    itemId: string,
    userId: string,
    itemTitle: string,
    dueDate: Date,
    hasExplicitTime: boolean,
    timezone: string = "UTC",
    tx?: any,
    eventsCollector?: Array<{ userId: string; event: any }>
  ) {
    const execute = async (client: any, events: Array<{ userId: string; event: any }>) => {
      // Serialize concurrent runs for the same item by locking the item row
      await client
        .select({ id: items.id })
        .from(items)
        .where(eq(items.id, itemId))
        .for("update");

      if (hasExplicitTime) {
        const now = new Date();
        // If the due time is already more than 60 seconds in the past when the item is created, create nothing.
        if (dueDate.getTime() <= now.getTime() - 60 * 1000) {
          return [];
        }

        // Idempotency: dedupe on (itemId, triggerType="exact_time", scheduledAt=dueDate)
        const existing = await client
          .select()
          .from(reminders)
          .where(
            and(
              eq(reminders.itemId, itemId),
              eq(reminders.triggerType, "exact_time"),
              or(
                eq(reminders.status, "scheduled"),
                eq(reminders.status, "snoozed"),
                eq(reminders.status, "dispatching"),
                eq(reminders.status, "sent")
              )
            )
          );

        const duplicate = existing.find(
          (r: any) =>
            ((r.metadata as any)?.autoCreated === true || !(r.metadata as any)?.manual) &&
            Math.abs(new Date(r.scheduledAt).getTime() - dueDate.getTime()) < 1000
        );

        if (duplicate) {
          return [duplicate];
        }

        const [r] = await client
          .insert(reminders)
          .values({
            userId,
            itemId,
            title: itemTitle,
            triggerType: "exact_time",
            relativeOffsetDays: 0,
            scheduledAt: dueDate,
            recurrence: "none",
            channel: "web",
            status: "scheduled",
            metadata: { autoCreated: true },
          })
          .returning();

        events.push({
          userId,
          event: {
            type: "changed",
            entity: "reminder",
            id: r.id,
            at: new Date().toISOString(),
          },
        });

        return [r];
      } else {
        return this.createStandardRelativeReminders(
          itemId,
          userId,
          itemTitle,
          dueDate,
          [-30, -7, -1, 0],
          "web",
          timezone,
          client,
          events
        );
      }
    };

    if (tx) {
      return execute(tx, eventsCollector || []);
    } else {
      const localEvents: Array<{ userId: string; event: any }> = [];
      const result = await db.transaction(async (newTx) => execute(newTx, localEvents));
      for (const e of localEvents) {
        eventBus.publish(e.userId, e.event);
      }
      return result;
    }
  }

  /**
   * Single shared service method for lifecycle synchronization of item reminders:
   * - Item completed: cancel pending reminders (scheduled/snoozed), leave sent and dispatching untouched.
   * - Item uncompleted (reopened): do NOT resurrect cancelled reminders.
   * - Item deleted: cancel pending reminders, detach itemId to null and record deletedItemId to preserve audit trail. Leave sent and dispatching untouched.
   * - Item due date edited: cancel pending auto-created reminders, create new ones under rules 2/3. Leave manual reminders untouched.
   */
  async syncItemReminderLifecycle(
    itemId: string,
    userId: string,
    action: "complete" | "reopen" | "delete" | "reschedule",
    options?: {
      newDueDate?: Date | null;
      hasExplicitTime?: boolean;
      timezone?: string;
      itemTitle?: string;
    },
    tx?: any,
    eventsCollector?: Array<{ userId: string; event: any }>
  ) {
    const execute = async (client: any, events: Array<{ userId: string; event: any }>) => {
      if (action === "reopen") {
        // Reopening a completed item does NOT resurrect cancelled reminders.
        return;
      }

      if (action === "complete") {
        // Set pending reminders (status 'scheduled' or 'snoozed') to 'cancelled'. Leave 'dispatching' and 'sent' alone.
        const pending = await client
          .select()
          .from(reminders)
          .where(
            and(
              eq(reminders.itemId, itemId),
              eq(reminders.userId, userId),
              or(eq(reminders.status, "scheduled"), eq(reminders.status, "snoozed"))
            )
          );

        if (pending.length > 0) {
          await client
            .update(reminders)
            .set({ status: "cancelled" })
            .where(
              and(
                eq(reminders.itemId, itemId),
                eq(reminders.userId, userId),
                or(eq(reminders.status, "scheduled"), eq(reminders.status, "snoozed"))
              )
            );

          for (const r of pending) {
            events.push({
              userId,
              event: {
                type: "changed",
                entity: "reminder",
                id: r.id,
                at: new Date().toISOString(),
              },
            });
          }
        }
        return;
      }

      if (action === "delete") {
        // Cancel pending reminders, detach itemId to null and preserve audit records in metadata.
        // Leave 'dispatching' and 'sent' alone (their status stays 'dispatching' or 'sent').
        const allReminders = await client
          .select()
          .from(reminders)
          .where(and(eq(reminders.itemId, itemId), eq(reminders.userId, userId)));

        for (const r of allReminders) {
          const isPending = r.status === "scheduled" || r.status === "snoozed";
          const newStatus = isPending ? "cancelled" : r.status;
          const currentMeta = (r.metadata as any) || {};

          await client
            .update(reminders)
            .set({
              status: newStatus,
              itemId: null,
              metadata: { ...currentMeta, originalItemId: itemId, deletedItemId: itemId },
            })
            .where(eq(reminders.id, r.id));

          if (isPending) {
            events.push({
              userId,
              event: {
                type: "changed",
                entity: "reminder",
                id: r.id,
                at: new Date().toISOString(),
              },
            });
          }
        }
        return;
      }

      if (action === "reschedule") {
        // Cancel pending auto-created reminders for that item.
        // Reminders created manually via the API are NOT touched.
        const itemReminders = await client
          .select()
          .from(reminders)
          .where(and(eq(reminders.itemId, itemId), eq(reminders.userId, userId)));

        for (const r of itemReminders) {
          const isPending = r.status === "scheduled" || r.status === "snoozed";
          if (!isPending) continue;

          const isAuto =
            (r.metadata as any)?.autoCreated === true ||
            (!(r.metadata as any)?.manual && r.triggerType === "relative_to_deadline");

          if (isAuto) {
            await client
              .update(reminders)
              .set({ status: "cancelled" })
              .where(eq(reminders.id, r.id));

            events.push({
              userId,
              event: {
                type: "changed",
                entity: "reminder",
                id: r.id,
                at: new Date().toISOString(),
              },
            });
          }
        }

        // If a new due date is provided, create new reminders under rules 2/3
        if (options?.newDueDate) {
          let title = options.itemTitle;
          if (!title) {
            const [it] = await client.select().from(items).where(eq(items.id, itemId)).limit(1);
            title = it?.title || "Reminder";
          }

          let timezone = options.timezone;
          if (!timezone) {
            const [user] = await client.select().from(users).where(eq(users.id, userId)).limit(1);
            timezone = (user?.settings as any)?.timezone || "UTC";
          }

          await this.createRemindersForItem(
            itemId,
            userId,
            title,
            options.newDueDate,
            options.hasExplicitTime ?? false,
            timezone,
            client,
            events
          );
        }
        return;
      }
    };

    if (tx) {
      return execute(tx, eventsCollector || []);
    } else {
      const localEvents: Array<{ userId: string; event: any }> = [];
      const result = await db.transaction(async (newTx) => execute(newTx, localEvents));
      for (const e of localEvents) {
        eventBus.publish(e.userId, e.event);
      }
      return result;
    }
  }

  /**
   * Reschedules all relative_to_deadline reminders when an item's deadline changes.
   */
  async rescheduleForDeadlineChange(itemId: string, newDueDate: Date, timezone: string = "UTC", hasExplicitTime?: boolean) {
    const [it] = await db.select().from(items).where(eq(items.id, itemId)).limit(1);
    if (!it) return [];

    await this.syncItemReminderLifecycle(itemId, it.userId, "reschedule", {
      newDueDate,
      timezone,
      hasExplicitTime: hasExplicitTime ?? (it.metadata as any)?.hasExplicitTime ?? false,
      itemTitle: it.title,
    });
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
   * Completes an item and synchronizes reminders via syncItemReminderLifecycle.
   */
  async completeItem(itemId: string, userId: string, completed: boolean = true) {
    const events: Array<{ userId: string; event: any }> = [];
    const updatedItem = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(items)
        .set({
          status: completed ? "completed" : "active",
          completedAt: completed ? new Date() : null,
        })
        .where(and(eq(items.id, itemId), eq(items.userId, userId)))
        .returning();

      if (!updated) return undefined;

      await this.syncItemReminderLifecycle(itemId, userId, completed ? "complete" : "reopen", undefined, tx, events);

      return updated;
    });

    if (!updatedItem) return undefined;

    for (const e of events) {
      eventBus.publish(e.userId, e.event);
    }
    eventBus.publish(userId, {
      type: "changed",
      entity: "item",
      id: updatedItem.id,
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
        const emailReminders = settings.emailReminders === true;
        const isEmailVerified = user?.emailVerifiedAt != null;

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

        const reminderMetadata = (reminder.metadata as Record<string, any>) || {};
        const isEmailChannel = reminder.channel === "email";

        // Primary dispatch metadata: if channel is email, pass userEmail & timezone
        const primaryMetadata = isEmailChannel
          ? { ...reminderMetadata, userEmail: user?.email, timezone: userTimezone }
          : { ...reminderMetadata };

        // 4. Primary dispatch via notificationDispatcher
        const primaryResult = await notificationDispatcher.dispatch({
          reminderId: reminder.id,
          userId: reminder.userId,
          title: reminder.title,
          body: `LifeLoop Reminder: ${reminder.title}`,
          channel: (reminder.channel as any) || "web",
          scheduledAt: reminder.scheduledAt,
          itemId: reminder.itemId || undefined,
          metadata: primaryMetadata,
        });

        const passResults = [primaryResult];

        // Secondary email dispatch if emailReminders is on, verified, and primary is not email
        if (emailReminders && isEmailVerified && !isEmailChannel) {
          const emailResult = await notificationDispatcher.dispatch({
            reminderId: reminder.id,
            userId: reminder.userId,
            title: reminder.title,
            body: `LifeLoop Reminder: ${reminder.title}`,
            channel: "email",
            scheduledAt: reminder.scheduledAt,
            itemId: reminder.itemId || undefined,
            metadata: { userEmail: user?.email, timezone: userTimezone },
          });
          passResults.push(emailResult);
        }

        const hasFailed = passResults.some((r) => r.status === "failed");
        let activeMetadata = { ...reminderMetadata };

        if (hasFailed) {
          const attempts = ((reminderMetadata.deliveryAttempts as number) || 0) + 1;
          if (attempts < 5) {
            // Revert back to 'scheduled' for next retry
            await db
              .update(reminders)
              .set({
                status: "scheduled",
                updatedAt: now,
                metadata: {
                  ...reminderMetadata,
                  deliveryAttempts: attempts,
                },
              })
              .where(eq(reminders.id, reminder.id));

            results.push(...passResults);
            continue;
          } else {
            // attempts >= 5: set metadata.deliveryFailed = true and proceed to normal sent/recurrence handling
            activeMetadata = {
              ...reminderMetadata,
              deliveryAttempts: attempts,
              deliveryFailed: true,
            };
          }
        }

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
                metadata: {
                  ...activeMetadata,
                  deliveryAttempts: 0, // Reset deliveryAttempts to 0 whenever a recurring reminder advances
                },
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
              metadata: activeMetadata,
            })
            .where(eq(reminders.id, reminder.id));
        }

        results.push(...passResults);
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
