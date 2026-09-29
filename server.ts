import "dotenv/config";
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";

import { createApp } from "./src/server/app";
import { errorHandler } from "./src/server/middlewares/errorHandler";
import { db } from "./src/db";
import { users } from "./src/db/schema";
import { getConnectionString, logDbStartup } from "./src/db/config";
import { reminderService } from "./src/server/services/ReminderService";
import { captureRetryService } from "./src/server/services/CaptureRetryService";

// Log once: env=<NODE_ENV> db=<host>:<port>/<dbname> (no credentials).
// getConnectionString() has already enforced the dev-DB guard inside src/db/index.ts.
logDbStartup(getConnectionString());

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
    if (process.env.EMAIL_PROVIDER === "brevo") {
      const missingBrevoVars: string[] = [];
      if (!process.env.BREVO_API_KEY) missingBrevoVars.push("BREVO_API_KEY");
      if (!process.env.EMAIL_FROM_ADDRESS) missingBrevoVars.push("EMAIL_FROM_ADDRESS");
      if (!process.env.APP_URL) missingBrevoVars.push("APP_URL");
      if (missingBrevoVars.length > 0) {
        throw new Error(
          `FATAL: Missing required Brevo environment variable(s) in production: ${missingBrevoVars.join(", ")}. Fix: Set ${missingBrevoVars.join(", ")} in your production environment variables.`
        );
      }
    }
  }

  const app = createApp();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;


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

    // Start in-process background schedulers
    if (process.env.NODE_ENV !== "test") {
      reminderService.startScheduler(60000);
      console.log("[ReminderScheduler] Background reminder scheduler active (interval: 60s)");
      captureRetryService.startScheduler(60000);
      console.log("[CaptureRetryScheduler] Background capture retry scheduler active (interval: 60s)");
    }
  });
}

startServer();
