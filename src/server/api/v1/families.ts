import { Router } from "express";
import { db } from "../../../db";
import {
  families,
  familyMembers,
  familyNotifications,
  sharedItems,
  items,
  users,
} from "../../../db/schema";
import { and, eq, desc, inArray } from "drizzle-orm";
import { requireAuth, AuthenticatedRequest } from "../../middlewares/auth";
import { requireFamilyRole } from "../../middlewares/familyAuth";
import crypto from "crypto";

export const familiesRouter = Router();

// ── Helper: fan out notifications to all family members (except excludedUserId) ──
async function fanOutNotification(
  familyId: string,
  excludeUserId: string,
  type: string,
  payload: object
) {
  const members = await db
    .select({ userId: familyMembers.userId })
    .from(familyMembers)
    .where(
      and(
        eq(familyMembers.familyId, familyId),
        eq(familyMembers.status, "accepted")
      )
    );

  const recipients = members
    .map((m) => m.userId)
    .filter((uid): uid is string => !!uid && uid !== excludeUserId);

  if (recipients.length === 0) return;

  await db.insert(familyNotifications).values(
    recipients.map((userId) => ({
      familyId,
      userId,
      type,
      payload,
    }))
  );
}

// ────────────────────────────────────────────────────────────────────────────
// FAMILIES
// ────────────────────────────────────────────────────────────────────────────

// GET /families — list families the user belongs to
familiesRouter.get("/", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const memberships = await db
      .select({ familyId: familyMembers.familyId })
      .from(familyMembers)
      .where(
        and(
          eq(familyMembers.userId, req.userId!),
          eq(familyMembers.status, "accepted")
        )
      );

    if (memberships.length === 0) return res.json({ families: [] });

    const familyIds = memberships.map((m) => m.familyId);
    const familyList = await db
      .select()
      .from(families)
      .where(inArray(families.id, familyIds));

    res.json({ families: familyList });
  } catch (err) {
    next(err);
  }
});

// POST /families — create a new family
familiesRouter.post("/", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) {
      return res.status(400).json({ error: "Family name is required" });
    }

    const [family] = await db
      .insert(families)
      .values({ name: name.trim(), ownerId: req.userId! })
      .returning();

    // Insert the creator as owner member (auto-accepted)
    const [ownerEmail] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, req.userId!))
      .limit(1);

    await db.insert(familyMembers).values({
      familyId: family.id,
      userId: req.userId!,
      invitedEmail: ownerEmail.email,
      role: "owner",
      status: "accepted",
      invitedByUserId: req.userId!,
      joinedAt: new Date(),
    });

    res.status(201).json({ family });
  } catch (err) {
    next(err);
  }
});

// GET /families/:id — get family details + members
familiesRouter.get(
  "/:id",
  requireAuth,
  requireFamilyRole("view_only"),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const [family] = await db
        .select()
        .from(families)
        .where(eq(families.id, req.params.id))
        .limit(1);

      if (!family) return res.status(404).json({ error: "Family not found" });

      const members = await db
        .select({
          id: familyMembers.id,
          familyId: familyMembers.familyId,
          userId: familyMembers.userId,
          invitedEmail: familyMembers.invitedEmail,
          role: familyMembers.role,
          status: familyMembers.status,
          joinedAt: familyMembers.joinedAt,
          createdAt: familyMembers.createdAt,
        })
        .from(familyMembers)
        .where(eq(familyMembers.familyId, req.params.id))
        .orderBy(desc(familyMembers.createdAt));

      res.json({ family, members });
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /families/:id — rename family
familiesRouter.patch(
  "/:id",
  requireAuth,
  requireFamilyRole("admin"),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const { name } = req.body;
      if (!name?.trim()) return res.status(400).json({ error: "Name required" });

      const [updated] = await db
        .update(families)
        .set({ name: name.trim() })
        .where(eq(families.id, req.params.id))
        .returning();

      res.json({ family: updated });
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /families/:id — delete family (owner only)
familiesRouter.delete(
  "/:id",
  requireAuth,
  requireFamilyRole("owner"),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      await db.delete(families).where(eq(families.id, req.params.id));
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  }
);

// ────────────────────────────────────────────────────────────────────────────
// INVITATIONS
// ────────────────────────────────────────────────────────────────────────────

// POST /families/:id/invite — invite a user by email
familiesRouter.post(
  "/:id/invite",
  requireAuth,
  requireFamilyRole("admin"),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const { email, role = "member" } = req.body;
      if (!email) return res.status(400).json({ error: "Email is required" });

      const validRoles = ["admin", "member", "view_only"];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ error: "Invalid role" });
      }

      // Check if already a member
      const [existing] = await db
        .select()
        .from(familyMembers)
        .where(
          and(
            eq(familyMembers.familyId, req.params.id),
            eq(familyMembers.invitedEmail, email.toLowerCase())
          )
        )
        .limit(1);

      if (existing && existing.status === "accepted") {
        return res.status(400).json({ error: "User is already a family member" });
      }

      const inviteToken = crypto.randomBytes(32).toString("hex");
      const inviteExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      let member;
      if (existing) {
        // Re-invite: refresh the token
        [member] = await db
          .update(familyMembers)
          .set({ inviteToken, inviteExpiresAt, status: "pending" })
          .where(eq(familyMembers.id, existing.id))
          .returning();
      } else {
        [member] = await db
          .insert(familyMembers)
          .values({
            familyId: req.params.id,
            invitedEmail: email.toLowerCase(),
            role,
            status: "pending",
            invitedByUserId: req.userId!,
            inviteToken,
            inviteExpiresAt,
          })
          .returning();
      }

      // Notify the invited user if they have an account
      const [invitedUser] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email.toLowerCase()))
        .limit(1);

      if (invitedUser) {
        const [family] = await db
          .select({ name: families.name })
          .from(families)
          .where(eq(families.id, req.params.id))
          .limit(1);

        await db.insert(familyNotifications).values({
          familyId: req.params.id,
          userId: invitedUser.id,
          type: "invite_received",
          payload: {
            inviteToken,
            familyId: req.params.id,
            familyName: family?.name,
            invitedByUserId: req.userId!,
          },
        });
      }

      res.status(201).json({ member, inviteToken });
    } catch (err) {
      next(err);
    }
  }
);

// POST /families/invitations/:token/accept — accept an invite
familiesRouter.post(
  "/invitations/:token/accept",
  requireAuth,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const { token } = req.params;

      const [member] = await db
        .select()
        .from(familyMembers)
        .where(eq(familyMembers.inviteToken, token))
        .limit(1);

      if (!member) return res.status(404).json({ error: "Invite not found" });
      if (member.status === "accepted") return res.status(400).json({ error: "Invite already accepted" });
      if (member.inviteExpiresAt && member.inviteExpiresAt < new Date()) {
        return res.status(400).json({ error: "Invite has expired" });
      }

      // Verify email matches
      const [currentUser] = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, req.userId!))
        .limit(1);

      if (currentUser.email !== member.invitedEmail) {
        return res.status(403).json({ error: "This invite was sent to a different email address" });
      }

      const [updated] = await db
        .update(familyMembers)
        .set({
          userId: req.userId!,
          status: "accepted",
          joinedAt: new Date(),
          inviteToken: null,
        })
        .where(eq(familyMembers.id, member.id))
        .returning();

      // Fan out member_joined notification
      const [family] = await db
        .select({ name: families.name })
        .from(families)
        .where(eq(families.id, member.familyId))
        .limit(1);

      await fanOutNotification(member.familyId, req.userId!, "member_joined", {
        userId: req.userId!,
        email: currentUser.email,
        familyName: family?.name,
      });

      res.json({ member: updated });
    } catch (err) {
      next(err);
    }
  }
);

// POST /families/invitations/:token/reject
familiesRouter.post(
  "/invitations/:token/reject",
  requireAuth,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const { token } = req.params;

      const [member] = await db
        .select()
        .from(familyMembers)
        .where(eq(familyMembers.inviteToken, token))
        .limit(1);

      if (!member) return res.status(404).json({ error: "Invite not found" });

      await db
        .update(familyMembers)
        .set({ status: "rejected", inviteToken: null })
        .where(eq(familyMembers.id, member.id));

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /families/:id/members/:memberId — change role
familiesRouter.patch(
  "/:id/members/:memberId",
  requireAuth,
  requireFamilyRole("admin"),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const { role } = req.body;
      const validRoles = ["admin", "member", "view_only"];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ error: "Invalid role. Cannot assign owner via this endpoint." });
      }

      const [target] = await db
        .select()
        .from(familyMembers)
        .where(
          and(
            eq(familyMembers.id, req.params.memberId),
            eq(familyMembers.familyId, req.params.id)
          )
        )
        .limit(1);

      if (!target) return res.status(404).json({ error: "Member not found" });
      if (target.role === "owner") {
        return res.status(403).json({ error: "Cannot change the owner's role" });
      }

      const [updated] = await db
        .update(familyMembers)
        .set({ role })
        .where(eq(familyMembers.id, req.params.memberId))
        .returning();

      res.json({ member: updated });
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /families/:id/members/:memberId — remove a member or leave
familiesRouter.delete(
  "/:id/members/:memberId",
  requireAuth,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const [target] = await db
        .select()
        .from(familyMembers)
        .where(
          and(
            eq(familyMembers.id, req.params.memberId),
            eq(familyMembers.familyId, req.params.id)
          )
        )
        .limit(1);

      if (!target) return res.status(404).json({ error: "Member not found" });

      // Can remove yourself (leave), or admin/owner can remove others
      const isSelf = target.userId === req.userId;
      if (!isSelf) {
        // Must be admin or owner
        const [myMembership] = await db
          .select()
          .from(familyMembers)
          .where(
            and(
              eq(familyMembers.familyId, req.params.id),
              eq(familyMembers.userId, req.userId!),
              eq(familyMembers.status, "accepted")
            )
          )
          .limit(1);

        const rank = { owner: 4, admin: 3, member: 2, view_only: 1 };
        if (!myMembership || (rank[myMembership.role as keyof typeof rank] ?? 0) < 3) {
          return res.status(403).json({ error: "Insufficient permissions" });
        }
      }

      if (target.role === "owner") {
        return res.status(400).json({ error: "Owner cannot be removed. Transfer ownership first." });
      }

      await db.delete(familyMembers).where(eq(familyMembers.id, req.params.memberId));
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  }
);

// ────────────────────────────────────────────────────────────────────────────
// SHARED ITEMS
// ────────────────────────────────────────────────────────────────────────────

// POST /families/:id/share — share an item with the family
familiesRouter.post(
  "/:id/share",
  requireAuth,
  requireFamilyRole("member"),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const { itemId, category, canEdit = false } = req.body;
      if (!itemId || !category) {
        return res.status(400).json({ error: "itemId and category are required" });
      }

      const validCategories = ["bills", "school_events", "appointments", "shopping", "documents", "reminders", "vehicle"];
      if (!validCategories.includes(category)) {
        return res.status(400).json({ error: "Invalid category" });
      }

      // Verify the item belongs to the sharing user
      const [item] = await db
        .select()
        .from(items)
        .where(and(eq(items.id, itemId), eq(items.userId, req.userId!)))
        .limit(1);

      if (!item) return res.status(404).json({ error: "Item not found or not owned by you" });

      const [shared] = await db
        .insert(sharedItems)
        .values({
          familyId: req.params.id,
          itemId,
          sharedByUserId: req.userId!,
          category,
          canEdit: canEdit ? 1 : 0,
        })
        .onConflictDoUpdate({
          target: [sharedItems.familyId, sharedItems.itemId],
          set: { category, canEdit: canEdit ? 1 : 0 },
        })
        .returning();

      // Fan out item_shared notification
      await fanOutNotification(req.params.id, req.userId!, "item_shared", {
        sharedItemId: shared.id,
        itemId,
        itemTitle: item.title,
        category,
        sharedByUserId: req.userId!,
      });

      res.status(201).json({ sharedItem: shared });
    } catch (err) {
      next(err);
    }
  }
);

// GET /families/:id/shared — get all shared items for a family
familiesRouter.get(
  "/:id/shared",
  requireAuth,
  requireFamilyRole("view_only"),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const shared = await db
        .select({
          id: sharedItems.id,
          familyId: sharedItems.familyId,
          itemId: sharedItems.itemId,
          sharedByUserId: sharedItems.sharedByUserId,
          category: sharedItems.category,
          canEdit: sharedItems.canEdit,
          createdAt: sharedItems.createdAt,
          item: {
            id: items.id,
            title: items.title,
            itemType: items.itemType,
            status: items.status,
            dueDate: items.dueDate,
            metadata: items.metadata,
            confidenceScore: items.confidenceScore,
            userId: items.userId,
          },
        })
        .from(sharedItems)
        .innerJoin(items, eq(sharedItems.itemId, items.id))
        .where(eq(sharedItems.familyId, req.params.id))
        .orderBy(desc(sharedItems.createdAt));

      res.json({ sharedItems: shared });
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /families/:id/shared/:sharedItemId — unshare an item
familiesRouter.delete(
  "/:id/shared/:sharedItemId",
  requireAuth,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const [shared] = await db
        .select()
        .from(sharedItems)
        .where(
          and(
            eq(sharedItems.id, req.params.sharedItemId),
            eq(sharedItems.familyId, req.params.id)
          )
        )
        .limit(1);

      if (!shared) return res.status(404).json({ error: "Shared item not found" });

      // Only the sharer or admin/owner can unshare
      const isSharer = shared.sharedByUserId === req.userId;
      if (!isSharer) {
        const [myMembership] = await db
          .select()
          .from(familyMembers)
          .where(
            and(
              eq(familyMembers.familyId, req.params.id),
              eq(familyMembers.userId, req.userId!),
              eq(familyMembers.status, "accepted")
            )
          )
          .limit(1);

        const rank = { owner: 4, admin: 3, member: 2, view_only: 1 };
        if (!myMembership || (rank[myMembership.role as keyof typeof rank] ?? 0) < 3) {
          return res.status(403).json({ error: "Insufficient permissions" });
        }
      }

      await db.delete(sharedItems).where(eq(sharedItems.id, req.params.sharedItemId));
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  }
);

// ────────────────────────────────────────────────────────────────────────────
// NOTIFICATIONS
// ────────────────────────────────────────────────────────────────────────────

// GET /families/notifications — get unread notifications for the current user
familiesRouter.get(
  "/notifications",
  requireAuth,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const notifications = await db
        .select()
        .from(familyNotifications)
        .where(eq(familyNotifications.userId, req.userId!))
        .orderBy(desc(familyNotifications.createdAt))
        .limit(50);

      res.json({ notifications });
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /families/notifications/:id/read
familiesRouter.patch(
  "/notifications/:notifId/read",
  requireAuth,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      await db
        .update(familyNotifications)
        .set({ isRead: 1 })
        .where(
          and(
            eq(familyNotifications.id, req.params.notifId),
            eq(familyNotifications.userId, req.userId!)
          )
        );

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  }
);
