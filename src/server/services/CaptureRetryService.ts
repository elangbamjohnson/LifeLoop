import { db } from "../../db";
import { captures } from "../../db/schema";
import { eq, and, lte, asc } from "drizzle-orm";
import { aiProvider } from "./AIProvider";
import { eventBus } from "./EventBus";

export class CaptureRetryService {
  private isRunning: boolean = false;
  private intervalTimer: NodeJS.Timeout | null = null;
  private maxRetries: number = 3;
  private backoffDelaysSec: number[] = [30, 90, 300]; // 30s, 90s, 5m

  startScheduler(intervalMs: number = 60000): void {
    if (this.intervalTimer) return;
    this.intervalTimer = setInterval(async () => {
      await this.runRetrySweep().catch((err) => {
        console.error("[CaptureRetryService] Sweep error:", err);
      });
    }, intervalMs);
    console.log(`[CaptureRetryService] Background retry scheduler active (interval: ${intervalMs}ms)`);
  }

  stopScheduler(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
  }

  async runRetrySweep(): Promise<number> {
    if (this.isRunning) return 0;
    this.isRunning = true;

    try {
      const now = new Date();
      // Find captures needing retry
      const pendingCaptures = await db
        .select()
        .from(captures)
        .where(
          and(
            eq(captures.processingStatus, "fallback_pending_retry"),
            lte(captures.nextRetryAt, now)
          )
        )
        .orderBy(asc(captures.nextRetryAt))
        .limit(10);

      if (pendingCaptures.length === 0) return 0;

      console.log(`[CaptureRetryService] Found ${pendingCaptures.length} captures ready for AI retry.`);
      let processed = 0;

      for (const cap of pendingCaptures) {
        await this.retryCapture(cap);
        processed++;
      }

      return processed;
    } finally {
      this.isRunning = false;
    }
  }

  async retryCapture(capture: typeof captures.$inferSelect): Promise<boolean> {
    const captureId = capture.id;
    const userId = capture.userId;

    try {
      // Re-verify capture status in DB to avoid race conditions
      const [current] = await db.select().from(captures).where(eq(captures.id, captureId)).limit(1);
      if (!current || current.processingStatus !== "fallback_pending_retry") {
        return false;
      }

      const clientTimezone = (capture.metadata as any)?.clientTimezone;

      let success = false;
      if (typeof aiProvider.enrichCapture === "function") {
        success = await aiProvider.enrichCapture(captureId, userId, capture.rawPayload, capture.type, clientTimezone);
      }

      if (success) {
        const metadata = {
          ...((current.metadata as any) || {}),
          aiEnriched: true,
          aiEnrichedAt: new Date().toISOString(),
        };

        await db
          .update(captures)
          .set({
            processingStatus: "completed",
            nextRetryAt: null,
            metadata,
          })
          .where(eq(captures.id, captureId));

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

        console.log(`[CaptureRetryService] Capture ${captureId} successfully enriched via AI retry.`);
        return true;
      } else {
        await this.handleRetryFailure(current, new Error("AI provider returned no items on retry"));
        return false;
      }
    } catch (err: any) {
      console.warn(`[CaptureRetryService] Retry attempt failed for ${captureId}:`, err.message || err);
      const [current] = await db.select().from(captures).where(eq(captures.id, captureId)).limit(1);
      if (current) {
        await this.handleRetryFailure(current, err);
      }
      return false;
    }
  }

  private async handleRetryFailure(current: typeof captures.$inferSelect, err: any): Promise<void> {
    const newRetryCount = (current.retryCount || 0) + 1;

    if (newRetryCount >= this.maxRetries) {
      // Option C: Max retries exhausted.
      // Mark as "completed" because the fallback items are already valid and usable.
      // Set aiEnrichmentFailed = true in metadata for observability.
      const metadata = {
        ...((current.metadata as any) || {}),
        aiEnrichmentFailed: true,
        lastRetryError: err?.message || String(err),
      };

      await db
        .update(captures)
        .set({
          processingStatus: "completed",
          retryCount: newRetryCount,
          nextRetryAt: null,
          metadata,
        })
        .where(eq(captures.id, current.id));

      eventBus.publish(current.userId, {
        type: "changed",
        entity: "capture",
        id: current.id,
        at: new Date().toISOString(),
      });

      console.warn(`[CaptureRetryService] Capture ${current.id} exhausted ${this.maxRetries} AI retries. Marked as completed with fallback items retained.`);
    } else {
      // Exponential backoff
      const delaySec = this.backoffDelaysSec[newRetryCount - 1] || 300;
      const nextRetryAt = new Date(Date.now() + delaySec * 1000);

      const metadata = {
        ...((current.metadata as any) || {}),
        lastRetryError: err?.message || String(err),
      };

      await db
        .update(captures)
        .set({
          processingStatus: "fallback_pending_retry",
          retryCount: newRetryCount,
          nextRetryAt,
          metadata,
        })
        .where(eq(captures.id, current.id));

      console.log(`[CaptureRetryService] Capture ${current.id} scheduled for retry ${newRetryCount + 1}/${this.maxRetries} at ${nextRetryAt.toISOString()}`);
    }
  }
}

export const captureRetryService = new CaptureRetryService();
