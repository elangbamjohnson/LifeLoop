import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { db } from "../../../db";
import { users, emailVerificationTokens } from "../../../db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { requireAuth, AuthenticatedRequest } from "../../middlewares/auth";
import crypto from "crypto";
import { getEmailProvider } from "../../services/EmailProvider";
import { OAuth2Client } from "google-auth-library";
import { isValidTimezone } from "../../../shared/utils/timezone";

export const authRouter = Router();

export const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("FATAL: JWT_SECRET environment variable is missing");
}

// Public auth configuration for client discovery
authRouter.get("/config", (_req, res) => {
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || null,
  });
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 attempts per 15 min per IP — blocks brute-force while tolerating honest typos
  message: { error: "Too many requests, please try again later" },
  skip: (req) => process.env.NODE_ENV !== 'production' && process.env.DISABLE_RATE_LIMIT === "1" && req.headers['x-force-rate-limit'] !== "1",
  validate: { xForwardedForHeader: false, default: true }
});

const resendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 per IP
  skip: (req) => process.env.NODE_ENV !== 'production' && process.env.DISABLE_RATE_LIMIT === "1" && req.headers['x-force-rate-limit'] !== "1",
  message: { error: "Too many resend attempts, please try again later" },
  validate: { xForwardedForHeader: false, default: true }
});

const resendAccountLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3, // 3 per email per hour
  skip: (req) => process.env.NODE_ENV !== 'production' && process.env.DISABLE_RATE_LIMIT === "1" && req.headers['x-force-rate-limit'] !== "1",
  message: { error: "Too many resend attempts, please try again later" },
  validate: { xForwardedForHeader: false, default: true }
});

function generateToken() {
  const tokenRaw = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(tokenRaw).digest('hex');
  return { tokenRaw, tokenHash };
}

// Register
authRouter.post("/register", authLimiter, async (req, res, next) => {
  try {
    const { email, password, timezone } = req.body;
    
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
    const { tokenRaw, tokenHash } = generateToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    let user;
    await db.transaction(async (tx) => {
      [user] = await tx
        .insert(users)
        .values({ 
          email: normalizedEmail, 
          passwordHash, 
          accountStatus: 'pending_verification',
          settings: { timezone: isValidTimezone(timezone) ? timezone : "UTC", autoReminders: true }
        })
        .returning({ id: users.id, email: users.email, isAdmin: users.isAdmin, accountStatus: users.accountStatus });

      await tx.insert(emailVerificationTokens).values({
        userId: user.id,
        tokenHash,
        expiresAt,
      });
    });

    const verifyUrl = `${req.protocol}://${req.get("host")}/verify-email?token=${tokenRaw}`;
    
    // Async send email
    getEmailProvider().sendVerificationEmail({
      to: normalizedEmail,
      verifyUrl,
      expiresAt,
    }).catch(() => {});

    // Issue session cookie for pending user
    // Issue session cookie for pending user
    const sessionToken = jwt.sign(
      { userId: user.id },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    const isSecure = process.env.NODE_ENV === "production" || req.secure || (req.headers["x-forwarded-proto"] === "https");
    res.cookie("session", sessionToken, {
      httpOnly: true,
      secure: isSecure,
      sameSite: isSecure ? "none" : "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.status(201).json({ user: { id: user!.id, email: user!.email, isAdmin: Boolean(user!.isAdmin), accountStatus: user!.accountStatus } });
  } catch (error) {
    next(error);
  }
});

// Google OAuth Login & Registration
authRouter.post("/google", authLimiter, async (req, res, next) => {
  try {
    const { credential, timezone } = req.body;

    if (!credential || typeof credential !== "string") {
      return res.status(400).json({ error: "Google credential is required" });
    }

    let payload: { email?: string; email_verified?: boolean; sub: string; name?: string };

    // Deterministic mock token for automated unit/E2E test suites: "mock_google_token:<email>:<sub_id>"
    if (process.env.NODE_ENV === "test" && credential.startsWith("mock_google_token:")) {
      const parts = credential.split(":");
      payload = {
        email: parts[1] || "google_user@example.com",
        email_verified: true,
        sub: parts[2] || `google_sub_${Date.now()}`,
      };
    } else {
      let ticket;
      try {
        ticket = await googleClient.verifyIdToken({
          idToken: credential,
          audience: process.env.GOOGLE_CLIENT_ID,
        });
      } catch (verifyError: any) {
        // Log the full error so Render logs show the exact failure reason.
        req.log.error(
          {
            err: verifyError,
            errCode: verifyError?.code,
            errMessage: verifyError?.message,
            googleClientIdPresent: !!process.env.GOOGLE_CLIENT_ID,
          },
          "[google-auth] verifyIdToken failed"
        );

        const msg: string = verifyError?.message ?? "";
        const isNetworkError =
          verifyError?.code === "ECONNREFUSED" ||
          verifyError?.code === "ETIMEDOUT" ||
          verifyError?.code === "ENOTFOUND" ||
          verifyError?.code === "ERR_NETWORK" ||
          msg.toLowerCase().includes("network") ||
          msg.toLowerCase().includes("fetch failed");

        if (isNetworkError) {
          return res.status(503).json({
            error: "Google authentication is temporarily unavailable. Please try again.",
          });
        }

        // Token is invalid / expired / wrong audience — client error.
        return res.status(400).json({ error: "Invalid Google credential." });
      }

      const googlePayload = ticket.getPayload();
      if (!googlePayload || !googlePayload.email) {
        return res.status(400).json({ error: "Invalid Google token payload" });
      }
      if (!googlePayload.email_verified) {
        return res.status(400).json({ error: "Google email is not verified" });
      }
      payload = {
        email: googlePayload.email,
        email_verified: googlePayload.email_verified,
        sub: googlePayload.sub,
        name: googlePayload.name,
      };
    }

    const normalizedEmail = payload.email!.trim().toLowerCase();
    const googleId = payload.sub;

    // 1. Check if user already exists by googleId
    let [user] = await db
      .select()
      .from(users)
      .where(eq(users.googleId, googleId))
      .limit(1);

    if (!user) {
      // 2. Check if user exists by email (link Google OAuth to existing email account)
      const [existingByEmail] = await db
        .select()
        .from(users)
        .where(eq(users.email, normalizedEmail))
        .limit(1);

      if (existingByEmail) {
        // If the existing row was never email-verified (pending_verification) we null out
        // the password_hash in the same UPDATE so the unverified hash cannot be replayed
        // via /login after this account is promoted to active via Google sign-in.
        const wasUnverified = existingByEmail.accountStatus === "pending_verification";
        const [updatedUser] = await db
          .update(users)
          .set({
            googleId,
            authProvider: existingByEmail.authProvider === "local" ? "hybrid" : existingByEmail.authProvider,
            accountStatus: "active",
            emailVerifiedAt: existingByEmail.emailVerifiedAt || new Date(),
            // Null out password_hash for previously-unverified accounts so the /login
            // guard correctly blocks password auth (the user never proved they owned
            // that address — Google has now verified it instead).
            ...(wasUnverified ? { passwordHash: null } : {}),
            updatedAt: new Date(),
          })
          .where(eq(users.id, existingByEmail.id))
          .returning();
        user = updatedUser;
      } else {
        // 3. Create brand-new verified user
        const [newUser] = await db
          .insert(users)
          .values({
            email: normalizedEmail,
            passwordHash: null,
            googleId,
            authProvider: "google",
            accountStatus: "active",
            emailVerifiedAt: new Date(),
            settings: { timezone: isValidTimezone(timezone) ? timezone : "UTC", autoReminders: true },
          })
          .returning();
        user = newUser;
      }
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "7d" });
    const isSecure = process.env.NODE_ENV === "production" || req.secure || (req.headers["x-forwarded-proto"] === "https");

    res.cookie("session", token, {
      httpOnly: true,
      secure: isSecure,
      sameSite: isSecure ? "none" : "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({
      user: {
        id: user.id,
        email: user.email,
        isAdmin: Boolean(user.isAdmin),
        accountStatus: user.accountStatus,
        authProvider: user.authProvider,
      },
    });
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

    if (!user.passwordHash) {
      return res.status(401).json({ error: "This account was registered with Google. Please sign in with Google." });
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    if (user.accountStatus === 'pending_verification') {
      return res.status(401).json({ error: "Please verify your email address to log in" });
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "7d" });
    
    const isSecure = process.env.NODE_ENV === "production" || req.secure || req.headers["x-forwarded-proto"] === "https";
    res.cookie("session", token, {
      httpOnly: true,
      secure: isSecure,
      sameSite: isSecure ? "none" : "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({ user: { id: user.id, email: user.email, isAdmin: Boolean(user.isAdmin), accountStatus: user.accountStatus } });
  } catch (error) {
    next(error);
  }
});

// Verify Email
authRouter.get("/verify-email", async (req, res, next) => {
  try {
    const { token } = req.query;
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: "Invalid or missing token" });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const result = await db.transaction(async (tx) => {
      const [tokenRecord] = await tx
        .select()
        .from(emailVerificationTokens)
        .where(eq(emailVerificationTokens.tokenHash, tokenHash))
        .limit(1);

      if (!tokenRecord) {
        return { error: "Invalid or expired token" };
      }

      if (tokenRecord.expiresAt < new Date()) {
        return { error: "Invalid or expired token" };
      }

      const now = new Date();
      if (tokenRecord.usedAt) {
        // Idempotent grace window of 5 minutes
        if (now.getTime() - tokenRecord.usedAt.getTime() <= 5 * 60 * 1000) {
          return { success: true };
        }
        return { error: "Invalid or expired token" };
      }

      const [user] = await tx.select().from(users).where(eq(users.id, tokenRecord.userId)).limit(1);
      if (!user) {
        return { error: "Invalid or expired token" };
      }

      // Conditional update for concurrent double-submit
      const [updatedToken] = await tx
        .update(emailVerificationTokens)
        .set({ usedAt: now })
        .where(and(eq(emailVerificationTokens.id, tokenRecord.id), isNull(emailVerificationTokens.usedAt)))
        .returning({ id: emailVerificationTokens.id });

      if (!updatedToken) {
        // We lost the race to another concurrent request. 
        // Since it happened right now, it is guaranteed to be within the 5-minute grace window.
        return { success: true, userId: user.id };
      }

      await tx
        .update(users)
        .set({ accountStatus: 'active', emailVerifiedAt: now })
        .where(eq(users.id, user.id));

      await tx
        .update(emailVerificationTokens)
        .set({ usedAt: now })
        .where(and(eq(emailVerificationTokens.userId, user.id), isNull(emailVerificationTokens.usedAt)));

      return { success: true, userId: user.id };
    });

    if (result.error) {
      return res.status(400).json({ error: result.error });
    }

    res.json({ success: true, message: "Email successfully verified. You may now log in." });
  } catch (error) {
    next(error);
  }
});

// Resend Verification
authRouter.post("/resend-verification", resendLimiter, resendAccountLimiter, async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== "string") {
      return res.status(400).json({ error: "Email required" });
    }
    const normalizedEmail = email.trim().toLowerCase();
    
    const [user] = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);

    if (user && user.accountStatus === 'pending_verification') {
      const { tokenRaw, tokenHash } = generateToken();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await db.transaction(async (tx) => {
        await tx
          .delete(emailVerificationTokens)
          .where(and(eq(emailVerificationTokens.userId, user.id), isNull(emailVerificationTokens.usedAt)));

        await tx.insert(emailVerificationTokens).values({
          userId: user.id,
          tokenHash,
          expiresAt,
        });
      });

      const verifyUrl = `${req.protocol}://${req.get("host")}/verify-email?token=${tokenRaw}`;
      getEmailProvider().sendVerificationEmail({
        to: normalizedEmail,
        verifyUrl,
        expiresAt,
      }).catch(err => {
        req.log.error({ err, email: normalizedEmail }, "Failed to send verification email");
      });
    }

    res.json({ message: "If an account requires email verification, a verification email has been sent." });
  } catch (error) {
    next(error);
  }
});

// Change Email
authRouter.post("/change-email", authLimiter, async (req, res, next) => {
  try {
    const { currentEmail, newEmail } = req.body;
    if (!currentEmail || typeof currentEmail !== "string" || !newEmail || typeof newEmail !== "string") {
      return res.status(400).json({ error: "Both current and new email are required" });
    }
    
    const normalizedCurrentEmail = currentEmail.trim().toLowerCase();
    const normalizedNewEmail = newEmail.trim().toLowerCase();

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedNewEmail)) {
      return res.status(400).json({ error: "Invalid new email format" });
    }

    await db.transaction(async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.email, normalizedCurrentEmail)).limit(1);
      
      if (!user || user.accountStatus !== 'pending_verification') {
        throw new Error("Invalid request");
      }

      const [existingNew] = await tx.select().from(users).where(eq(users.email, normalizedNewEmail)).limit(1);
      if (existingNew) {
        throw new Error("Email already in use");
      }

      const { tokenRaw, tokenHash } = generateToken();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await tx.update(users).set({ email: normalizedNewEmail }).where(eq(users.id, user.id));

      await tx
        .delete(emailVerificationTokens)
        .where(and(eq(emailVerificationTokens.userId, user.id), isNull(emailVerificationTokens.usedAt)));

      await tx.insert(emailVerificationTokens).values({
        userId: user.id,
        tokenHash,
        expiresAt,
      });

      const verifyUrl = `${req.protocol}://${req.get("host")}/verify-email?token=${tokenRaw}`;
      getEmailProvider().sendVerificationEmail({
        to: normalizedNewEmail,
        verifyUrl,
        expiresAt,
      }).catch(err => {
        req.log.error({ err, email: normalizedNewEmail }, "Failed to send change-email verification email");
      });
    });

    res.json({ success: true, message: "Email changed and verification resent." });
  } catch (error: any) {
    if (error.message === "Email already in use" || error.message === "Invalid request") {
      return res.status(400).json({ error: error.message });
    }
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
    const [user] = await db
      .select({ id: users.id, email: users.email, isAdmin: users.isAdmin, accountStatus: users.accountStatus })
      .from(users)
      .where(eq(users.id, req.userId!))
      .limit(1);
    if (!user) {
      const isSecure = process.env.NODE_ENV === "production" || req.secure || req.headers["x-forwarded-proto"] === "https";
      res.clearCookie("session", {
        httpOnly: true,
        secure: isSecure,
        sameSite: isSecure ? "none" : "lax",
      });
      return res.status(401).json({ error: "User not found" });
    }
    
    if (user.accountStatus === 'pending_verification') {
      return res.json({ user: { id: user.id, email: user.email, accountStatus: user.accountStatus } });
    }
    
    res.json({ user: { id: user.id, email: user.email, isAdmin: Boolean(user.isAdmin), accountStatus: user.accountStatus } });
  } catch (error) {
    next(error);
  }
});
