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

    const [existingItem] = await db
      .select()
      .from(items)
      .where(and(eq(items.id, id), eq(items.userId, req.userId!)))
      .limit(1);

    if (!existingItem) {
      return res.status(404).json({ error: "Item not found or could not be updated" });
    }

    const { status, title, itemType, dueDate, metadata, snoozedUntil, hasExplicitTime: bodyHasExplicitTime } = req.body;
    
    // Determine if we need to auto-adjust completedAt based on incoming status
    let completedAt: Date | null | undefined = undefined;
    if (status === "completed") {
      completedAt = new Date();
    } else if (status === "active") {
      completedAt = null;
    }

    const existingMeta = (existingItem.metadata as any) || {};
    const baseMetadata = metadata !== undefined ? { ...metadata } : { ...existingMeta };

    // Resolve hasExplicitTime:
    // If not provided in request body, preserve the existing item's flag (behavior for PATCH dueDate edit with no hasExplicitTime).
    // If provided in body (at top-level or inside metadata), use the provided boolean.
    let resolvedHasExplicitTime: boolean;
    if (bodyHasExplicitTime !== undefined) {
      resolvedHasExplicitTime = Boolean(bodyHasExplicitTime);
    } else if (metadata?.hasExplicitTime !== undefined) {
      resolvedHasExplicitTime = Boolean(metadata.hasExplicitTime);
    } else {
      resolvedHasExplicitTime = Boolean(existingMeta.hasExplicitTime);
    }

    const updatePayload: any = {};
    if (status !== undefined) updatePayload.status = status;
    if (title !== undefined) updatePayload.title = title;
    if (itemType !== undefined) updatePayload.itemType = itemType;
    if (snoozedUntil !== undefined) {
      updatePayload.snoozedUntil = snoozedUntil ? new Date(snoozedUntil) : null;
    }
    if (dueDate !== undefined) {
      updatePayload.dueDate = dueDate ? new Date(dueDate) : null;
    }
    if (completedAt !== undefined) {
      updatePayload.completedAt = completedAt;
    }

    // Persist the flag in item metadata on edit
    if (dueDate !== undefined || bodyHasExplicitTime !== undefined || metadata !== undefined) {
      updatePayload.metadata = {
        ...baseMetadata,
        hasExplicitTime: resolvedHasExplicitTime,
      };
    }

    const updatedItem = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(items)
        .set(updatePayload)
        .where(and(eq(items.id, id), eq(items.userId, req.userId!)))
        .returning();

      // If deadline was provided in payload, automatically reschedule reminders
      if (dueDate !== undefined) {
        await reminderService.syncItemReminderLifecycle(
          id,
          req.userId!,
          "reschedule",
          {
            newDueDate: dueDate ? new Date(dueDate) : null,
            hasExplicitTime: resolvedHasExplicitTime,
            itemTitle: updated.title,
          },
          tx
        );
      }

      // If completed or reopened, adjust reminders via lifecycle sync
      if (status === "completed") {
        await reminderService.syncItemReminderLifecycle(id, req.userId!, "complete", undefined, tx);
      } else if (status === "active") {
        await reminderService.syncItemReminderLifecycle(id, req.userId!, "reopen", undefined, tx);
      }

      return updated;
    });

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
    
    // Wrap lifecycle sync and item delete in one db.transaction
    const deletedItem = await db.transaction(async (tx) => {
      // Sync reminder lifecycle before deleting item (cancels pending reminders, leaves sent alone, detaches itemId)
      await reminderService.syncItemReminderLifecycle(id, req.userId!, "delete", undefined, tx);

      const [deleted] = await tx
        .delete(items)
        .where(and(eq(items.id, id), eq(items.userId, req.userId!)))
        .returning();

      return deleted;
    });
    
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
