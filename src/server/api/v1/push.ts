import { Router } from "express";
import { db } from "../../../db";
import { pushSubscriptions } from "../../../db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, AuthenticatedRequest } from "../../middlewares/auth";
import { isSupportedPushEndpoint } from "../../services/pushEndpoint";

export const pushRouter = Router();

// GET /api/v1/push/public-key
pushRouter.get("/public-key", requireAuth, async (req: AuthenticatedRequest, res) => {
  const publicKey = process.env.VAPID_PRIVATE_KEY ? process.env.VAPID_PUBLIC_KEY || "" : "";
  res.json({ publicKey });
});

pushRouter.post("/status", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const endpoint = req.body?.endpoint;
    if (typeof endpoint !== "string") return res.status(400).json({ error: "Endpoint is required" });
    const [subscription] = await db.select({ id: pushSubscriptions.id }).from(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, req.userId!), eq(pushSubscriptions.endpoint, endpoint))).limit(1);
    res.json({ registered: Boolean(subscription), available: Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/push/subscribe
pushRouter.post("/subscribe", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = req.body || {};
    const subObj = body.subscription || body;
    const endpoint = subObj.endpoint;
    const p256dh = subObj.keys?.p256dh || subObj.p256dh;
    const auth = subObj.keys?.auth || subObj.auth;
    const userAgent = body.userAgent || subObj.userAgent || (req.headers["user-agent"] as string) || null;

    if (!endpoint || typeof p256dh !== "string" || !p256dh || typeof auth !== "string" || !auth) {
      return res.status(400).json({
        error: "Missing required push subscription parameters: endpoint, p256dh, auth",
      });
    }
    if (!isSupportedPushEndpoint(endpoint)) {
      return res.status(400).json({ error: "Unsupported push subscription endpoint" });
    }

    const [saved] = await db
      .insert(pushSubscriptions)
      .values({
        userId: req.userId!,
        endpoint,
        p256dh,
        auth,
        userAgent,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          p256dh,
          auth,
          userAgent,
          createdAt: new Date(),
        },
        setWhere: eq(pushSubscriptions.userId, req.userId!),
      })
      .returning({ id: pushSubscriptions.id });

    if (!saved) {
      return res.status(409).json({ error: "This browser subscription is already registered to another account" });
    }

    res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/v1/push/subscribe
pushRouter.delete("/subscribe", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const endpoint = (req.body?.endpoint || req.query?.endpoint) as string | undefined;

    let removed;
    if (endpoint) {
      removed = await db
        .delete(pushSubscriptions)
        .where(
          and(
            eq(pushSubscriptions.userId, req.userId!),
            eq(pushSubscriptions.endpoint, endpoint)
          )
        ).returning({ id: pushSubscriptions.id });
    } else {
      removed = await db
        .delete(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, req.userId!)).returning({ id: pushSubscriptions.id });
    }

    res.json({ success: true, removed: removed.length > 0 });
  } catch (error) {
    next(error);
  }
});
