import { Router } from "express";
import { db } from "../../../db";
import { reminders, items, users } from "../../../db/schema";
import { eq, desc, and } from "drizzle-orm";
import { requireAuth, AuthenticatedRequest } from "../../middlewares/auth";
import { reminderService } from "../../services/ReminderService";
import { eventBus } from "../../services/EventBus";
import { validateUuidParams, validateUuidBody, isValidUuid, applyUuidParamValidation } from "../../middlewares/validation";

export const remindersRouter = Router();
applyUuidParamValidation(remindersRouter);

// 1. Get all reminders for current user
remindersRouter.get("/", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userReminders = await db
      .select()
      .from(reminders)
      .where(eq(reminders.userId, req.userId!))
      .orderBy(desc(reminders.scheduledAt));

    res.json({ reminders: userReminders });
  } catch (error) {
    next(error);
  }
});

// 2. Create standalone or custom reminder
remindersRouter.post("/", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const {
      itemId,
      title,
      triggerType,
      relativeOffsetDays,
      baseDeadline,
      scheduledAt,
      recurrence,
      channel,
      timezone,
    } = req.body;

    if (!title) {
      return res.status(400).json({ error: "Title is required" });
    }

    if (itemId && !isValidUuid(itemId)) {
      return res.status(400).json({ error: "Invalid identifier format for 'itemId'" });
    }

    const newReminder = await reminderService.createReminder({
      userId: req.userId!,
      itemId,
      title,
      triggerType,
      relativeOffsetDays,
      baseDeadline: baseDeadline ? new Date(baseDeadline) : undefined,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
      recurrence,
      channel,
      timezone,
    });

    eventBus.publish(req.userId!, {
      type: "changed",
      entity: "reminder",
      id: newReminder.id,
      at: new Date().toISOString(),
      origin: req.headers["x-client-id"] as string | undefined,
    });

    res.status(201).json({ reminder: newReminder });
  } catch (error) {
    next(error);
  }
});

// 3. Create standard relative reminders for an item (30d, 7d, 1d, 0d)
remindersRouter.post("/standard-relative", requireAuth, validateUuidBody("itemId"), async (req: AuthenticatedRequest, res, next) => {
  try {
    const { itemId, offsets, channel, timezone } = req.body;

    const [item] = await db
      .select()
      .from(items)
      .where(and(eq(items.id, itemId), eq(items.userId, req.userId!)))
      .limit(1);

    if (!item) {
      return res.status(404).json({ error: "Item not found" });
    }

    const dueDate = item.dueDate || (item.metadata as any)?.dueDate;
    if (!dueDate) {
      return res.status(400).json({ error: "Item has no due date" });
    }

    const created = await reminderService.createStandardRelativeReminders(
      item.id,
      req.userId!,
      item.title,
      new Date(dueDate),
      offsets || [-30, -7, -1, 0],
      channel || "web",
      timezone || "UTC"
    );

    eventBus.publish(req.userId!, {
      type: "changed",
      entity: "reminder",
      at: new Date().toISOString(),
      origin: req.headers["x-client-id"] as string | undefined,
    });

    res.status(201).json({ reminders: created });
  } catch (error) {
    next(error);
  }
});

// 4. Snooze reminder
remindersRouter.post("/:id/snooze", requireAuth, validateUuidParams("id"), async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    const { snoozeUntil } = req.body;

    if (!snoozeUntil) {
      return res.status(400).json({ error: "snoozeUntil date is required" });
    }

    const [existing] = await db
      .select()
      .from(reminders)
      .where(and(eq(reminders.id, id), eq(reminders.userId, req.userId!)))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Reminder not found" });
    }

    const updated = await reminderService.snoozeReminder(id, new Date(snoozeUntil));

    eventBus.publish(req.userId!, {
      type: "changed",
      entity: "reminder",
      id: updated?.id || id,
      at: new Date().toISOString(),
      origin: req.headers["x-client-id"] as string | undefined,
    });

    res.json({ reminder: updated });
  } catch (error) {
    next(error);
  }
});

// 5. Update reminder
remindersRouter.patch("/:id", requireAuth, validateUuidParams("id"), async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    const { title, scheduledAt, recurrence, channel, status } = req.body;

    const [existing] = await db
      .select()
      .from(reminders)
      .where(and(eq(reminders.id, id), eq(reminders.userId, req.userId!)))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Reminder not found" });
    }

    const [updated] = await db
      .update(reminders)
      .set({
        ...(title && { title }),
        ...(scheduledAt && { scheduledAt: new Date(scheduledAt) }),
        ...(recurrence && { recurrence }),
        ...(channel && { channel }),
        ...(status && { status }),
      })
      .where(eq(reminders.id, id))
      .returning();

    eventBus.publish(req.userId!, {
      type: "changed",
      entity: "reminder",
      id: updated.id,
      at: new Date().toISOString(),
      origin: req.headers["x-client-id"] as string | undefined,
    });

    res.json({ reminder: updated });
  } catch (error) {
    next(error);
  }
});

// 6. Delete reminder
remindersRouter.delete("/:id", requireAuth, validateUuidParams("id"), async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;

    const [existing] = await db
      .select()
      .from(reminders)
      .where(and(eq(reminders.id, id), eq(reminders.userId, req.userId!)))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Reminder not found" });
    }

    await db.delete(reminders).where(eq(reminders.id, id));

    eventBus.publish(req.userId!, {
      type: "changed",
      entity: "reminder",
      id,
      at: new Date().toISOString(),
      origin: req.headers["x-client-id"] as string | undefined,
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// 7. Trigger dispatch of due reminders (called by background cron or authenticated user)
remindersRouter.post("/dispatch-now", async (req: AuthenticatedRequest, res, next) => {
  try {
    const cronSecret = process.env.CRON_SECRET;
    const incomingCronSecret =
      (req.headers["x-cron-secret"] as string) ||
      (req.headers.authorization?.startsWith("Bearer ")
        ? req.headers.authorization.slice(7)
        : undefined);

    const isCronAuthorized = Boolean(
      cronSecret && incomingCronSecret && cronSecret === incomingCronSecret
    );

    if (isCronAuthorized) {
      const results = await reminderService.dispatchDueReminders(new Date());
      return res.json({ success: true, count: results.length, results, trigger: "cron" });
    }

    // Fall back to standard session cookie authentication
    requireAuth(req, res, async () => {
      try {
        const results = await reminderService.dispatchDueReminders(new Date());
        res.json({ success: true, count: results.length, results, trigger: "manual" });
      } catch (err) {
        next(err);
      }
    });
  } catch (error) {
    next(error);
  }
});

// 8. Get user reminder preferences
remindersRouter.get("/preferences", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const [user] = await db.select().from(users).where(eq(users.id, req.userId!)).limit(1);
    const settings = (user?.settings as any) || {};
    
    res.json({
      preferences: {
        autoReminders: settings.autoReminders ?? false,
        channels: settings.channels || ["web"],
        defaultOffsets: settings.defaultOffsets || [-30, -7, -1, 0],
        timezone: settings.timezone || "UTC",
        quietHoursEnabled: settings.quietHoursEnabled ?? false,
        quietHoursStart: settings.quietHoursStart || "22:00",
        quietHoursEnd: settings.quietHoursEnd || "08:00",
      }
    });
  } catch (error) {
    next(error);
  }
});

// 9. Update user reminder preferences
remindersRouter.put("/preferences", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const [user] = await db.select().from(users).where(eq(users.id, req.userId!)).limit(1);
    const currentSettings = (user?.settings as any) || {};

    const updatedSettings = {
      ...currentSettings,
      ...req.body,
    };

    await db
      .update(users)
      .set({ settings: updatedSettings })
      .where(eq(users.id, req.userId!));

    eventBus.publish(req.userId!, {
      type: "changed",
      entity: "reminder",
      at: new Date().toISOString(),
      origin: req.headers["x-client-id"] as string | undefined,
    });

    res.json({ success: true, preferences: updatedSettings });
  } catch (error) {
    next(error);
  }
});
