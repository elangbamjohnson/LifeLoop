import { Router } from "express";
import multer from "multer";
import { db } from "../../../db";
import { captures } from "../../../db/schema";
import { eq, desc, and } from "drizzle-orm";
import { requireAuth, AuthenticatedRequest } from "../../middlewares/auth";
import { validateUuidParams, applyUuidParamValidation } from "../../middlewares/validation";
import { storage } from "../../services/StorageProvider";
import { aiProvider } from "../../services/AIProvider";
import { eventBus } from "../../services/EventBus";
import { isValidTimezone } from "../../../shared/utils/timezone";
import { captureRetryService } from "../../services/CaptureRetryService";

export const capturesRouter = Router();
applyUuidParamValidation(capturesRouter);

// Configure multer for memory storage (we'll save it via StorageProvider)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

// Create Capture (Text or File)
capturesRouter.post("/", requireAuth, upload.single("file"), async (req: AuthenticatedRequest, res, next) => {
  try {
    const { source = "web", type, rawPayload } = req.body;
    let finalPayload = rawPayload;
    let originalFilename = null;
    let mimeType = null;

    if (!type) {
      return res.status(400).json({ error: "Capture type is required" });
    }

    // If it's a file upload, save it via the storage provider
    if (req.file) {
      originalFilename = req.file.originalname;
      mimeType = req.file.mimetype;
      finalPayload = await storage.uploadFile(req.file.buffer, originalFilename, mimeType);
    } else if (!finalPayload) {
      return res.status(400).json({ error: "Text payload or file is required" });
    }

    if (type === "text" && finalPayload && finalPayload.length > 10000) {
      return res.status(400).json({ error: "Text payload exceeds maximum allowed length of 10,000 characters." });
    }

    let capture;
    try {
      const [inserted] = await db
        .insert(captures)
        .values({
          userId: req.userId!,
          source,
          type,
          rawPayload: finalPayload,
          originalFilename,
          mimeType,
          processingStatus: "pending",
        })
        .returning();
      capture = inserted;
    } catch (insertError) {
      if (req.file && finalPayload) {
        // Clean up orphaned file
        await storage.deleteFile(finalPayload).catch(e => (req as any).log?.error(e, "Failed to clean up orphaned file"));
      }
      throw insertError;
    }

    eventBus.publish(req.userId!, {
      type: "changed",
      entity: "capture",
      id: capture.id,
      at: new Date().toISOString(),
      origin: req.headers["x-client-id"] as string | undefined,
    });

    res.status(201).json({ capture });

    // Kick off async processing (fire and forget for now)
    const rawClientTimezone = req.headers['x-timezone'] as string | undefined;
    const clientTimezone = rawClientTimezone !== undefined
      ? (isValidTimezone(rawClientTimezone) ? rawClientTimezone : "UTC")
      : undefined;

    // Persist clientTimezone in the capture metadata so background retries
    // use the correct timezone when re-enriching with AI.
    if (clientTimezone) {
      await db
        .update(captures)
        .set({ metadata: { ...(capture.metadata as any || {}), clientTimezone } })
        .where(eq(captures.id, capture.id))
        .catch(e => (req as any).log?.warn(e, `Failed to persist clientTimezone for capture ${capture.id}`));
    }
    processCaptureAsync(capture.id, req.userId!, capture.rawPayload, capture.type, (req as any).log, clientTimezone).catch(e => {
      (req as any).log?.error(e, `Async processing failed for capture ${capture.id}`);
    });

  } catch (error) {
    next(error);
  }
});

// Async processing helper
async function processCaptureAsync(captureId: string, userId: string, payload: string, type: string, logger: any, clientTimezone?: string) {
  try {
    await db.update(captures).set({ processingStatus: "processing" }).where(eq(captures.id, captureId));
    const result = await aiProvider.processCapture(captureId, userId, payload, type, clientTimezone);

    if (result?.fallback) {
      const nextRetryAt = new Date(Date.now() + 30 * 1000);
      const [curr] = await db.select().from(captures).where(eq(captures.id, captureId)).limit(1);
      const metadata = {
        ...((curr?.metadata as any) || {}),
        fallbackUsed: true,
        fallbackReason: result.error || "Live AI unavailable",
      };

      await db
        .update(captures)
        .set({
          processingStatus: "fallback_pending_retry",
          retryCount: 0,
          nextRetryAt,
          metadata,
        })
        .where(eq(captures.id, captureId));

      if (logger) {
        logger.warn(`Capture ${captureId} processed via heuristic fallback; scheduled background retry for ${nextRetryAt.toISOString()}`);
      }
    } else {
      await db.update(captures).set({ processingStatus: "completed" }).where(eq(captures.id, captureId));
    }

    eventBus.publish(userId, {
      type: "changed",
      entity: "capture",
      id: captureId,
      at: new Date().toISOString(),
    });
    eventBus.publish(userId, {
      type: "changed",
      entity: "item",
      at: new Date().toISOString(),
    });
  } catch (error) {
    if (logger) {
      logger.error(error, `Processing failed for ${captureId}`);
    } else {
      console.error(`Processing failed for ${captureId}:`, error);
    }
    await db.update(captures).set({ processingStatus: "failed" }).where(eq(captures.id, captureId));
  }
}

// Get all captures for user
capturesRouter.get("/", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userCaptures = await db
      .select()
      .from(captures)
      .where(eq(captures.userId, req.userId!))
      .orderBy(desc(captures.createdAt));

    res.json({ captures: userCaptures });
  } catch (error) {
    next(error);
  }
});

// Delete capture
capturesRouter.delete("/:id", requireAuth, validateUuidParams("id"), async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    
    // Ensure ownership
    const [capture] = await db
      .select()
      .from(captures)
      .where(and(eq(captures.id, id), eq(captures.userId, req.userId!)))
      .limit(1);

    if (!capture) {
      return res.status(404).json({ error: "Capture not found" });
    }

    // If it was a file, delete it from storage
    if (capture.type !== "text" && capture.rawPayload.startsWith("/uploads/")) {
      await storage.deleteFile(capture.rawPayload);
    }

    await db.delete(captures).where(eq(captures.id, id));
    
    eventBus.publish(req.userId!, {
      type: "changed",
      entity: "capture",
      id,
      at: new Date().toISOString(),
      origin: req.headers["x-client-id"] as string | undefined,
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// Retry AI enrichment for capture
capturesRouter.post("/:id/retry", requireAuth, validateUuidParams("id"), async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    const [capture] = await db
      .select()
      .from(captures)
      .where(and(eq(captures.id, id), eq(captures.userId, req.userId!)))
      .limit(1);

    if (!capture) {
      return res.status(404).json({ error: "Capture not found" });
    }

    const clientTimezone = (req.headers["x-timezone"] as string | undefined) || (capture.metadata as any)?.clientTimezone;

    const metadata = {
      ...((capture.metadata as any) || {}),
      aiEnrichmentFailed: false,
      lastRetryError: null,
      clientTimezone: clientTimezone || (capture.metadata as any)?.clientTimezone,
    };

    await db
      .update(captures)
      .set({
        processingStatus: "fallback_pending_retry",
        retryCount: 0,
        nextRetryAt: null,
        metadata,
      })
      .where(eq(captures.id, id));

    eventBus.publish(req.userId!, {
      type: "changed",
      entity: "capture",
      id,
      at: new Date().toISOString(),
      origin: req.headers["x-client-id"] as string | undefined,
    });

    const updatedCapture = { ...capture, metadata, processingStatus: "fallback_pending_retry" as const, retryCount: 0 };
    captureRetryService.retryCapture(updatedCapture as any).catch(e => {
      (req as any).log?.error(e, `Manual retry failed for capture ${id}`);
    });

    res.json({ success: true, message: "AI retry initiated" });
  } catch (error) {
    next(error);
  }
});

