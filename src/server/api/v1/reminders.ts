import { Router } from "express";
import { db } from "../../../db";
import { reminders, items, users } from "../../../db/schema";
import { eq, desc, and } from "drizzle-orm";
import { requireAuth, AuthenticatedRequest } from "../../middlewares/auth";
import { reminderService } from "../../services/ReminderService";

export const remindersRouter = Router();

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

// 2. Create custom reminder
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

    res.status(201).json({ reminder: newReminder });
  } catch (error) {
    next(error);
  }
});

// 3. Create standard relative reminders for an item (30d, 7d, 1d, 0d)
remindersRouter.post("/standard-relative", requireAuth, async (req: AuthenticatedRequest, res, next) => {
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

    res.status(201).json({ reminders: created });
  } catch (error) {
    next(error);
  }
});

// 4. Snooze reminder
remindersRouter.post("/:id/snooze", requireAuth, async (req: AuthenticatedRequest, res, next) => {
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
    res.json({ reminder: updated });
  } catch (error) {
    next(error);
  }
});

// 5. Update reminder
remindersRouter.patch("/:id", requireAuth, async (req: AuthenticatedRequest, res, next) => {
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

    res.json({ reminder: updated });
  } catch (error) {
    next(error);
  }
});

// 6. Delete reminder
remindersRouter.delete("/:id", requireAuth, async (req: AuthenticatedRequest, res, next) => {
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
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// 7. Trigger manual dispatch of due reminders (for tests or frontend synchronization)
remindersRouter.post("/dispatch-now", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const results = await reminderService.dispatchDueReminders(new Date());
    res.json({ success: true, count: results.length, results });
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

    res.json({ success: true, preferences: updatedSettings });
  } catch (error) {
    next(error);
  }
});
