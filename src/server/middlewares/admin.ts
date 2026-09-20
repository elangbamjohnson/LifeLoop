import { Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { users } from "../../db/schema";
import { AuthenticatedRequest } from "./auth";

export async function requireAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  if (!req.userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const [user] = await db
      .select({ isAdmin: users.isAdmin })
      .from(users)
      .where(eq(users.id, req.userId))
      .limit(1);

    if (!user || !user.isAdmin) {
      const routePath = `${req.baseUrl || ""}${req.path}`;
      console.warn(`[WARN] ${req.method} ${routePath} - 403: Forbidden`);
      return res.status(403).json({ error: "Forbidden" });
    }

    next();
  } catch (error) {
    next(error);
  }
}
