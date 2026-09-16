import { Router } from "express";
import { db } from "../../../db";
import { items, reminders, sharedItems, familyMembers } from "../../../db/schema";
import { eq, desc, and, inArray } from "drizzle-orm";
import { requireAuth, AuthenticatedRequest } from "../../middlewares/auth";
import { reminderService } from "../../services/ReminderService";
import { groupItemsIntoTimeline, TimelineItem } from "../../../shared/utils/timeline";

export const itemsRouter = Router();

// Create item manually (for tasks, waiting_for, entities, etc.)
itemsRouter.post("/", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { title, itemType, status = "active", dueDate, metadata = {}, confidenceScore = 1.0 } = req.body;

    if (!title || !itemType) {
      return res.status(400).json({ error: "Title and itemType are required" });
    }

    const [item] = await db
      .insert(items)
      .values({
        userId: req.userId!,
        title: title.trim(),
        itemType,
        status,
        dueDate: dueDate ? new Date(dueDate) : null,
        confidenceScore,
        metadata,
      })
      .returning();

    res.status(201).json({ item });
  } catch (error) {
    next(error);
  }
});

// Get all parsed items for user
itemsRouter.get("/", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userItems = await db
      .select()
      .from(items)
      .where(eq(items.userId, req.userId!))
      .orderBy(desc(items.createdAt));

    res.json({ items: userItems });
  } catch (error) {
    next(error);
  }
});

// Get Life Timeline grouping (must be before /:id to avoid param collision)
itemsRouter.get("/timeline", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userItems = await db
      .select()
      .from(items)
      .where(eq(items.userId, req.userId!))
      .orderBy(desc(items.createdAt));

    const timelineItems: TimelineItem[] = userItems.map((item) => ({
      id: item.id,
      title: item.title,
      itemType: item.itemType,
      status: item.status,
      dueDate: item.dueDate ? item.dueDate.toISOString() : null,
      snoozedUntil: item.snoozedUntil ? item.snoozedUntil.toISOString() : null,
      completedAt: item.completedAt ? item.completedAt.toISOString() : null,
      confidenceScore: item.confidenceScore as number | null,
      metadata: item.metadata as Record<string, any> | null,
      createdAt: item.createdAt.toISOString(),
    }));

    const timeline = groupItemsIntoTimeline(timelineItems, new Date());
    res.json({ timeline, total: userItems.length });
  } catch (error) {
    next(error);
  }
});

// Get single item by ID (accessible by owner or family member if shared)
itemsRouter.get("/:id", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;

    const [item] = await db
      .select()
      .from(items)
      .where(eq(items.id, id))
      .limit(1);

    if (!item) {
      return res.status(404).json({ error: "Item not found" });
    }

    // If caller is the owner, allow access
    if (item.userId === req.userId) {
      return res.json({ item });
    }

    // Check if the item is shared to any family where req.userId is an accepted member
    const sharedRecord = await db
      .select({
        sharedId: sharedItems.id,
        canEdit: sharedItems.canEdit,
      })
      .from(sharedItems)
      .innerJoin(
        familyMembers,
        and(
          eq(familyMembers.familyId, sharedItems.familyId),
          eq(familyMembers.userId, req.userId!),
          eq(familyMembers.status, "accepted")
        )
      )
      .where(eq(sharedItems.itemId, id))
      .limit(1);

    if (sharedRecord.length > 0) {
      return res.json({ item, isShared: true, canEdit: sharedRecord[0].canEdit === 1 });
    }

    // If item is not owned by user and not shared with user's family
    return res.status(403).json({ error: "Access denied: this item is private to its owner" });
  } catch (error) {
    next(error);
  }
});

// Get reminders for a specific item
itemsRouter.get("/:id/reminders", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;

    const itemReminders = await db
      .select()
      .from(reminders)
      .where(and(eq(reminders.itemId, id), eq(reminders.userId, req.userId!)))
      .orderBy(desc(reminders.scheduledAt));

    res.json({ reminders: itemReminders });
  } catch (error) {
    next(error);
  }
});

// Update item (e.g. approve, edit title, deadline, metadata, status)
itemsRouter.patch("/:id", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    const { status, title, itemType, dueDate, metadata, snoozedUntil } = req.body;
    
    // Ensure ownership
    const [existing] = await db
      .select()
      .from(items)
      .where(and(eq(items.id, id), eq(items.userId, req.userId!)))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Item not found" });
    }

    const hasDueDateChanged = dueDate !== undefined && 
      (dueDate ? new Date(dueDate).toISOString() : null) !== (existing.dueDate ? existing.dueDate.toISOString() : null);

    const updatePayload: any = {};
    if (status !== undefined) updatePayload.status = status;
    if (title !== undefined) updatePayload.title = title;
    if (itemType !== undefined) updatePayload.itemType = itemType;
    if (metadata !== undefined) updatePayload.metadata = metadata;
    if (snoozedUntil !== undefined) {
      updatePayload.snoozedUntil = snoozedUntil ? new Date(snoozedUntil) : null;
    }
    if (dueDate !== undefined) {
      updatePayload.dueDate = dueDate ? new Date(dueDate) : null;
    }

    if (status === "completed" && existing.status !== "completed") {
      updatePayload.completedAt = new Date();
    } else if (status === "active" && existing.status === "completed") {
      updatePayload.completedAt = null;
    }

    const [updatedItem] = await db
      .update(items)
      .set(updatePayload)
      .where(eq(items.id, id))
      .returning();

    // If deadline changed, automatically reschedule relative reminders!
    if (hasDueDateChanged && dueDate) {
      await reminderService.rescheduleForDeadlineChange(id, new Date(dueDate));
    }

    // If completed or reopened, adjust reminders
    if (status === "completed") {
      await db.update(reminders).set({ status: "dismissed" }).where(eq(reminders.itemId, id));
    } else if (status === "active" && existing.status === "completed") {
      await db.update(reminders).set({ status: "scheduled" }).where(eq(reminders.itemId, id));
    }
      
    res.json({ item: updatedItem });
  } catch (error) {
    next(error);
  }
});

// Snooze an item
itemsRouter.post("/:id/snooze", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    const { snoozeDays, snoozeUntil } = req.body;

    let targetDate: Date;
    if (snoozeUntil) {
      targetDate = new Date(snoozeUntil);
    } else {
      const days = typeof snoozeDays === "number" ? snoozeDays : 1;
      targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + days);
      targetDate.setHours(9, 0, 0, 0);
    }

    const [existing] = await db
      .select()
      .from(items)
      .where(and(eq(items.id, id), eq(items.userId, req.userId!)))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Item not found" });
    }

    const updated = await reminderService.snoozeItem(id, targetDate);
    res.json({ item: updated });
  } catch (error) {
    next(error);
  }
});

// Complete / uncomplete an item
itemsRouter.post("/:id/complete", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    const { completed = true } = req.body;

    const [existing] = await db
      .select()
      .from(items)
      .where(and(eq(items.id, id), eq(items.userId, req.userId!)))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Item not found" });
    }

    const updated = await reminderService.completeItem(id, completed);
    res.json({ item: updated });
  } catch (error) {
    next(error);
  }
});

// Delete item
itemsRouter.delete("/:id", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    
    // Ensure ownership
    const [existing] = await db
      .select()
      .from(items)
      .where(and(eq(items.id, id), eq(items.userId, req.userId!)))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Item not found" });
    }

    // Deleting item cascades to associated reminders
    await db.delete(items).where(eq(items.id, id));
    
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});
