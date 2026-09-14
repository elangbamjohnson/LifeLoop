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

    const [created] = await db
      .insert(itemRelations)
      .values({
        userId: req.userId!,
        sourceItemId,
        targetItemId,
        relationshipType: relationshipType || "related_to",
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
