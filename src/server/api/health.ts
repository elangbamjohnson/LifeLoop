import { Router } from "express";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const healthRouter = Router();

// Liveness probe (no DB check)
healthRouter.get(["/healthz", "/api/v1/healthz"], (_req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

// Readiness probe (SELECT 1 check)
healthRouter.get(["/readyz", "/api/v1/readyz", "/api/v1/health"], async (_req, res) => {
  let dbStatus = "ok";
  let dbError = null;
  try {
    await db.execute(sql`SELECT 1`);
  } catch (err: any) {
    dbStatus = "error";
    dbError = err?.message || String(err);
  }

  const isHealthy = dbStatus === "ok";
  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? "ok" : "degraded",
    database: dbStatus,
    databaseError: dbError,
    timestamp: new Date().toISOString(),
  });
});
