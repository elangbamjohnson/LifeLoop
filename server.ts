import "dotenv/config";
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";

import { authRouter } from "./src/server/api/v1/auth";
import { capturesRouter } from "./src/server/api/v1/captures";
import { itemsRouter } from "./src/server/api/v1/items";
import { remindersRouter } from "./src/server/api/v1/reminders";
import { askRouter } from "./src/server/api/v1/ask";
import { relationsRouter } from "./src/server/api/v1/relations";
import { familiesRouter } from "./src/server/api/v1/families";
import { healthRouter } from "./src/server/api/health";
import { errorHandler } from "./src/server/middlewares/errorHandler";
import { db } from "./src/db";
import { users } from "./src/db/schema";

async function startServer() {
  // Strict production safety guards at boot
  if (process.env.NODE_ENV === "production") {
    if (process.env.AI_PROVIDER === "mock") {
      throw new Error("FATAL: AI_PROVIDER cannot be set to 'mock' in production environment. Fix: Unset or remove AI_PROVIDER from production environment variables.");
    }
    if (process.env.DISABLE_RATE_LIMIT === "1") {
      throw new Error("FATAL: DISABLE_RATE_LIMIT cannot be set to '1' in production environment. Fix: Unset or remove DISABLE_RATE_LIMIT from production environment variables.");
    }
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("FATAL: GEMINI_API_KEY environment variable is missing in production. Fix: Set GEMINI_API_KEY in your production environment variables (e.g. export GEMINI_API_KEY=\"<your_gemini_api_key>\").");
    }
  }

  const app = express();
  
  // Trust the proxy to correctly resolve client IP for rate limiting behind Cloud Run / AI Studio infrastructure
  app.set("trust proxy", 1);
  
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  // Middleware
  app.use(pinoHttp({
    level: process.env.NODE_ENV === "production" ? "info" : "debug",
    // Redact sensitive info
    redact: ['req.headers.cookie', 'req.headers.authorization', 'req.body.password']
  }));
  app.use(express.json());
  app.use(cookieParser());
  
  // Serve uploads statically for local development
  app.use("/uploads", express.static(path.join(process.cwd(), "public", "uploads")));

  // API Routes
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/captures", capturesRouter);
  app.use("/api/v1/items", itemsRouter);
  app.use("/api/v1/reminders", remindersRouter);
  app.use("/api/v1/ask", askRouter);
  app.use("/api/v1/relations", relationsRouter);
  app.use("/api/v1/families", familiesRouter);
  
  // Health & Readiness probes
  app.use(healthRouter);


  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Production static serving
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Error Handler (must be last)
  app.use(errorHandler);

  // HOST resolution: HOST env var wins (lets the caller inject any interface).
  // Outside production, default to 127.0.0.1 (numeric loopback) — never "localhost",
  // which on Node >= 17 / macOS resolves to ::1 (IPv6) and breaks curl/Playwright
  // health-check probes that connect via IPv4.
  // In production, default to 0.0.0.0 so the load-balancer can reach the container.
  const host = process.env.HOST ?? (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
  const server = app.listen(PORT, host, () => {
    const address = server.address();
    const actualPort = typeof address === "string" ? PORT : address?.port;
    console.log(`Server running on http://${host}:${actualPort}`);
  });
}

startServer();
