import { Router } from "express";
import { db } from "../../../db";
import { items, reminders, sharedItems, familyMembers } from "../../../db/schema";
import { eq, desc, and, inArray } from "drizzle-orm";
import { requireAuth, AuthenticatedRequest } from "../../middlewares/auth";
import { reminderService } from "../../services/ReminderService";
import { eventBus } from "../../services/EventBus";
import { groupItemsIntoTimeline, TimelineItem } from "../../../shared/utils/timeline";
import { isValidUuid, applyUuidParamValidation } from "../../middlewares/validation";

export const itemsRouter = Router();
applyUuidParamValidation(itemsRouter);

const isValidUUID = isValidUuid;

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

    eventBus.publish(req.userId!, {
      type: "changed",
      entity: "item",
      id: item.id,
      at: new Date().toISOString(),
      origin: req.headers["x-client-id"] as string | undefined,
    });

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
    if (!isValidUUID(id)) {
      return res.status(400).json({ error: "Invalid format for identifier" });
    }

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
    return res.status(404).json({ error: "Item not found" });
  } catch (error) {
    next(error);
  }
});

// Get reminders for a specific item
itemsRouter.get("/:id/reminders", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    if (!isValidUUID(id)) {
      return res.status(400).json({ error: "Invalid format for identifier" });
    }

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
    if (!isValidUUID(id)) {
      return res.status(400).json({ error: "Invalid format for identifier" });
    }
    const { status, title, itemType, dueDate, metadata, snoozedUntil } = req.body;
    
    // Determine if we need to auto-adjust completedAt based on incoming status
    let completedAt: Date | null | undefined = undefined;
    if (status === "completed") {
      completedAt = new Date();
    } else if (status === "active") {
      completedAt = null;
    }

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
    if (completedAt !== undefined) {
      updatePayload.completedAt = completedAt;
    }

    const [updatedItem] = await db
      .update(items)
      .set(updatePayload)
      .where(and(eq(items.id, id), eq(items.userId, req.userId!)))
      .returning();

    if (!updatedItem) {
      return res.status(404).json({ error: "Item not found or could not be updated" });
    }

    // If deadline was provided in payload, automatically reschedule relative reminders
    if (dueDate !== undefined) {
      await reminderService.rescheduleForDeadlineChange(id, new Date(dueDate));
    }

    // If completed or reopened, adjust reminders
    if (status === "completed") {
      await db.update(reminders).set({ status: "dismissed" }).where(eq(reminders.itemId, id));
    } else if (status === "active") {
      await db.update(reminders).set({ status: "scheduled" }).where(eq(reminders.itemId, id));
    }

    eventBus.publish(req.userId!, {
      type: "changed",
      entity: "item",
      id: updatedItem.id,
      at: new Date().toISOString(),
      origin: req.headers["x-client-id"] as string | undefined,
    });
      
    res.json({ item: updatedItem });
  } catch (error) {
    next(error);
  }
});

// Snooze an item
itemsRouter.post("/:id/snooze", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    if (!isValidUUID(id)) {
      return res.status(400).json({ error: "Invalid format for identifier" });
    }
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

    const updated = await reminderService.snoozeItem(id, req.userId!, targetDate);
    if (!updated) {
      return res.status(404).json({ error: "Item not found" });
    }

    eventBus.publish(req.userId!, {
      type: "changed",
      entity: "item",
      id: updated.id,
      at: new Date().toISOString(),
      origin: req.headers["x-client-id"] as string | undefined,
    });

    res.json({ item: updated });
  } catch (error) {
    next(error);
  }
});

// Complete / uncomplete an item
itemsRouter.post("/:id/complete", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    if (!isValidUUID(id)) {
      return res.status(400).json({ error: "Invalid format for identifier" });
    }
    const { completed = true } = req.body;

    const updated = await reminderService.completeItem(id, req.userId!, completed);
    if (!updated) {
      return res.status(404).json({ error: "Item not found" });
    }

    eventBus.publish(req.userId!, {
      type: "changed",
      entity: "item",
      id: updated.id,
      at: new Date().toISOString(),
      origin: req.headers["x-client-id"] as string | undefined,
    });

    res.json({ item: updated });
  } catch (error) {
    next(error);
  }
});

// Delete item
itemsRouter.delete("/:id", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    if (!isValidUUID(id)) {
      return res.status(400).json({ error: "Invalid format for identifier" });
    }
    
    // Deleting item cascades to associated reminders
    const [deletedItem] = await db.delete(items)
      .where(and(eq(items.id, id), eq(items.userId, req.userId!)))
      .returning();
    
    if (!deletedItem) {
      return res.status(404).json({ error: "Item not found" });
    }

    eventBus.publish(req.userId!, {
      type: "changed",
      entity: "item",
      id: deletedItem.id,
      at: new Date().toISOString(),
      origin: req.headers["x-client-id"] as string | undefined,
    });
    
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});
