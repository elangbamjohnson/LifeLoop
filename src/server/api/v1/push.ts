import { Router } from "express";
import { db } from "../../../db";
import { pushSubscriptions } from "../../../db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, AuthenticatedRequest } from "../../middlewares/auth";

export const pushRouter = Router();

// GET /api/v1/push/public-key
pushRouter.get("/public-key", requireAuth, async (req: AuthenticatedRequest, res) => {
  const publicKey = process.env.VAPID_PUBLIC_KEY || "";
  res.json({ publicKey });
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

    if (!endpoint || !p256dh || !auth) {
      return res.status(400).json({
        error: "Missing required push subscription parameters: endpoint, p256dh, auth",
      });
    }

    await db
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
          userId: req.userId!,
          p256dh,
          auth,
          userAgent,
          createdAt: new Date(),
        },
      });

    res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/v1/push/subscribe
pushRouter.delete("/subscribe", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const endpoint = (req.body?.endpoint || req.query?.endpoint) as string | undefined;

    if (endpoint) {
      await db
        .delete(pushSubscriptions)
        .where(
          and(
            eq(pushSubscriptions.userId, req.userId!),
            eq(pushSubscriptions.endpoint, endpoint)
          )
        );
    } else {
      await db
        .delete(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, req.userId!));
    }

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});
