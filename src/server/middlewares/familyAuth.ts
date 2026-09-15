import { Response, NextFunction } from "express";
import { db } from "../../db";
import { familyMembers } from "../../db/schema";
import { and, eq } from "drizzle-orm";
import { AuthenticatedRequest } from "./auth";

export type FamilyRole = "owner" | "admin" | "member" | "view_only";

const ROLE_RANK: Record<FamilyRole, number> = {
  owner: 4,
  admin: 3,
  member: 2,
  view_only: 1,
};

/**
 * Middleware factory: ensures the authenticated user is a member of the
 * family (`:id` param) with at least the given minimum role.
 * Attaches `req.familyMember` for downstream handlers.
 */
export function requireFamilyRole(minRole: FamilyRole) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const familyId = req.params.id;
    if (!familyId) {
      return res.status(400).json({ error: "Family ID required" });
    }

    const [member] = await db
      .select()
      .from(familyMembers)
      .where(
        and(
          eq(familyMembers.familyId, familyId),
          eq(familyMembers.userId, req.userId!),
          eq(familyMembers.status, "accepted")
        )
      )
      .limit(1);

    if (!member) {
      return res.status(403).json({ error: "You are not a member of this family" });
    }

    const userRank = ROLE_RANK[member.role as FamilyRole] ?? 0;
    const requiredRank = ROLE_RANK[minRole];

    if (userRank < requiredRank) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    (req as any).familyMember = member;
    next();
  };
}
