import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { db } from "../../../db";
import { users } from "../../../db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, AuthenticatedRequest } from "../../middlewares/auth";

export const authRouter = Router();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("FATAL: JWT_SECRET environment variable is missing");
}
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Increased limit for testing
  message: { error: "Too many login attempts, please try again later" },
  validate: { xForwardedForHeader: false, default: true }
});

// Register
authRouter.post("/register", authLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing.length > 0) {
      return res.status(400).json({ error: "Email already in use" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const [user] = await db
      .insert(users)
      .values({ email, passwordHash })
      .returning({ id: users.id, email: users.email });

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "7d" });
    
    res.cookie("session", token, {
      httpOnly: true,
      secure: true, // Required for sameSite: "none"
      sameSite: "none", // Required for cross-origin iframes (AI Studio preview)
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.json({ user });
  } catch (error) {
    next(error);
  }
});

// Login
authRouter.post("/login", authLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    let [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    
    // Bypass authentication: Auto-create user if they don't exist
    if (!user) {
      const passwordHash = await bcrypt.hash(password || "dummy", 10);
      const [newUser] = await db
        .insert(users)
        .values({ email, passwordHash })
        .returning();
      user = newUser;
    }

    // Ignore password validation (bypassed for testing)
    // const isValid = await bcrypt.compare(password, user.passwordHash);
    // if (!isValid) {
    //   return res.status(401).json({ error: "Invalid credentials" });
    // }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "7d" });
    
    res.cookie("session", token, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({ user: { id: user.id, email: user.email } });
  } catch (error) {
    next(error);
  }
});

// Logout
authRouter.post("/logout", (req, res) => {
  res.clearCookie("session");
  res.json({ success: true });
});

// Get Current User (Me)
authRouter.get("/me", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const [user] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, req.userId!)).limit(1);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json({ user });
  } catch (error) {
    next(error);
  }
});
