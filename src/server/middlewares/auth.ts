import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { db } from "../../db";
import { users } from "../../db/schema";
import { eq } from "drizzle-orm";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("FATAL: JWT_SECRET environment variable is missing");
}

export interface AuthenticatedRequest extends Request {
  userId?: string;
}

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const token = req.cookies.session;

  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId: string };
    
    // Check user status in database
    const [user] = await db.select({ accountStatus: users.accountStatus }).from(users).where(eq(users.id, payload.userId)).limit(1);

    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    // Allow /auth/me to proceed so it can return the specialized pending response
    if (user.accountStatus === 'pending_verification' && req.baseUrl === '/api/v1/auth' && req.path === '/me') {
      req.userId = payload.userId;
      return next();
    }

    if (user.accountStatus === 'pending_verification') {
      return res.status(403).json({ error: "Please verify your email address to access this resource" });
    }

    req.userId = payload.userId;
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ error: "Session expired" });
    }
    return res.status(401).json({ error: "Invalid session" });
  }
}
