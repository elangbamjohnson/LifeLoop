import { Router } from "express";
import multer from "multer";
import { db } from "../../../db";
import { captures } from "../../../db/schema";
import { eq, desc, and } from "drizzle-orm";
import { requireAuth, AuthenticatedRequest } from "../../middlewares/auth";
import { storage } from "../../services/StorageProvider";
import { aiProvider } from "../../services/AIProvider";

export const capturesRouter = Router();

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

    res.status(201).json({ capture });

    // Kick off async processing (fire and forget for now)
    processCaptureAsync(capture.id, req.userId!, capture.rawPayload, capture.type, (req as any).log).catch(e => {
      (req as any).log?.error(e, `Async processing failed for capture ${capture.id}`);
    });

  } catch (error) {
    next(error);
  }
});

// Async processing helper
async function processCaptureAsync(captureId: string, userId: string, payload: string, type: string, logger: any) {
  try {
    await db.update(captures).set({ processingStatus: "processing" }).where(eq(captures.id, captureId));
    await aiProvider.processCapture(captureId, userId, payload, type);
    await db.update(captures).set({ processingStatus: "completed" }).where(eq(captures.id, captureId));
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
capturesRouter.delete("/:id", requireAuth, async (req: AuthenticatedRequest, res, next) => {
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
    
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});
