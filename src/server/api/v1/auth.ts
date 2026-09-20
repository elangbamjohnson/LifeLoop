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
  max: 100,
  skip: () => process.env.DISABLE_RATE_LIMIT === "1",
  message: { error: "Too many login attempts, please try again later" },
  validate: { xForwardedForHeader: false, default: true }
});

// Register
authRouter.post("/register", authLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    
    if (!email || typeof email !== "string" || !password || typeof password !== "string") {
      return res.status(400).json({ error: "Email and password required" });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      return res.status(400).json({ error: "Invalid email format" });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters long" });
    }

    const existing = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);
    if (existing.length > 0) {
      return res.status(400).json({ error: "Email already in use" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const [user] = await db
      .insert(users)
      .values({ email: normalizedEmail, passwordHash })
      .returning({ id: users.id, email: users.email });

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "7d" });
    
    const isSecure = process.env.NODE_ENV === "production" || req.secure || req.headers["x-forwarded-proto"] === "https";
    res.cookie("session", token, {
      httpOnly: true,
      secure: isSecure, // Required for sameSite: "none", false for localhost HTTP
      sameSite: isSecure ? "none" : "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.status(201).json({ user });
  } catch (error) {
    next(error);
  }
});

// Login
authRouter.post("/login", authLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    
    if (!email || typeof email !== "string" || !password || typeof password !== "string") {
      return res.status(400).json({ error: "Email and password required" });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const [user] = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);
    
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "7d" });
    
    const isSecure = process.env.NODE_ENV === "production" || req.secure || req.headers["x-forwarded-proto"] === "https";
    res.cookie("session", token, {
      httpOnly: true,
      secure: isSecure,
      sameSite: isSecure ? "none" : "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({ user: { id: user.id, email: user.email } });
  } catch (error) {
    next(error);
  }
});

// Logout
authRouter.post("/logout", (req, res) => {
  const isSecure = process.env.NODE_ENV === "production" || req.secure || req.headers["x-forwarded-proto"] === "https";
  res.clearCookie("session", {
    httpOnly: true,
    secure: isSecure,
    sameSite: isSecure ? "none" : "lax",
  });
  res.json({ success: true });
});

// Get Current User (Me)
authRouter.get("/me", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const [user] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, req.userId!)).limit(1);
    if (!user) {
      const isSecure = process.env.NODE_ENV === "production" || req.secure || req.headers["x-forwarded-proto"] === "https";
      res.clearCookie("session", {
        httpOnly: true,
        secure: isSecure,
        sameSite: isSecure ? "none" : "lax",
      });
      return res.status(401).json({ error: "User not found" });
    }
    res.json({ user });
  } catch (error) {
    next(error);
  }
});
