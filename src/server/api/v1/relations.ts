import { Router } from "express";
import { db } from "../../../db";
import { itemRelations, items } from "../../../db/schema";
import { eq, or, and, desc } from "drizzle-orm";
import { requireAuth, AuthenticatedRequest } from "../../middlewares/auth";

export const relationsRouter = Router();

// Get relations for an item
relationsRouter.get("/:itemId", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { itemId } = req.params;

    const relations = await db
      .select()
      .from(itemRelations)
      .where(
        and(
          eq(itemRelations.userId, req.userId!),
          or(eq(itemRelations.sourceItemId, itemId), eq(itemRelations.targetItemId, itemId))
        )
      )
      .orderBy(desc(itemRelations.createdAt));

    res.json({ relations });
  } catch (error) {
    next(error);
  }
});

// Create relationship
relationsRouter.post("/", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { sourceItemId, targetItemId, relationshipType, metadata } = req.body;
    const relType = relationshipType || "related_to";

    const existing = await db
      .select()
      .from(itemRelations)
      .where(
        and(
          eq(itemRelations.sourceItemId, sourceItemId),
          eq(itemRelations.targetItemId, targetItemId),
          eq(itemRelations.relationshipType, relType)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      return res.json(existing[0]);
    }

    const [created] = await db
      .insert(itemRelations)
      .values({
        userId: req.userId!,
        sourceItemId,
        targetItemId,
        relationshipType: relType,
        status: "active",
        metadata: metadata || {},
      })
      .returning();

    res.json(created);
  } catch (error) {
    next(error);
  }
});

// Update relationship
relationsRouter.patch("/:id", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    const { status, relationshipType } = req.body;

    const [existing] = await db
      .select()
      .from(itemRelations)
      .where(and(eq(itemRelations.id, id), eq(itemRelations.userId, req.userId!)))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Relation not found" });
    }

    const payload: any = {};
    if (status !== undefined) payload.status = status;
    if (relationshipType !== undefined) payload.relationshipType = relationshipType;

    const [updated] = await db
      .update(itemRelations)
      .set(payload)
      .where(eq(itemRelations.id, id))
      .returning();

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

// Delete relationship
relationsRouter.delete("/:id", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;

    const [existing] = await db
      .select()
      .from(itemRelations)
      .where(and(eq(itemRelations.id, id), eq(itemRelations.userId, req.userId!)))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Relation not found" });
    }

    await db.delete(itemRelations).where(eq(itemRelations.id, id));
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});
