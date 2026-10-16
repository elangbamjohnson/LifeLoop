import express from "express";
import path from "path";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";

import { authRouter } from "./api/v1/auth";
import { capturesRouter } from "./api/v1/captures";
import { itemsRouter } from "./api/v1/items";
import { remindersRouter } from "./api/v1/reminders";
import { askRouter } from "./api/v1/ask";
import { relationsRouter } from "./api/v1/relations";
import { familiesRouter } from "./api/v1/families";
import { eventsRouter } from "./api/v1/events";
import { pushRouter } from "./api/v1/push";
import { healthRouter } from "./api/health";
import { errorHandler } from "./middlewares/errorHandler";

export interface CreateAppOptions {
  customPath?: string;
  customRouter?: express.Router;
}

export function createApp(options: CreateAppOptions = {}): express.Application {
  const app = express();

  // Trust proxy for IP rate limiting behind reverse proxies
  app.set("trust proxy", 1);

  // Logging middleware
  app.use(
    pinoHttp({
      level: process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug"),
      redact: ["req.headers.cookie", "req.headers.authorization", "req.body.password"],
      customLogLevel: (req, res, err) => {
        // SSE connections and aborts logged at debug only
        if (req.url && req.url.startsWith("/api/v1/events")) {
          return "debug";
        }
        if (res.statusCode >= 500 || err) return "error";
        if (res.statusCode >= 400) return "warn";
        return "info";
      },
    })
  );

  app.use(express.json());
  app.use(cookieParser());

  // Static uploads
  app.use("/uploads", express.static(path.join(process.cwd(), "public", "uploads")));

  // Standard API Routes
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/captures", capturesRouter);
  app.use("/api/v1/items", itemsRouter);
  app.use("/api/v1/reminders", remindersRouter);
  app.use("/api/v1/ask", askRouter);
  app.use("/api/v1/relations", relationsRouter);
  app.use("/api/v1/families", familiesRouter);
  app.use("/api/v1/events", eventsRouter);
  app.use("/api/v1/push", pushRouter);

  // Custom route overrides for tests
  const standardPaths = [
    "/api/v1/auth",
    "/api/v1/captures",
    "/api/v1/items",
    "/api/v1/reminders",
    "/api/v1/ask",
    "/api/v1/relations",
    "/api/v1/families",
    "/api/v1/events",
    "/api/v1/push",
  ];
  if (options.customPath && options.customRouter && !standardPaths.includes(options.customPath)) {
    app.use(options.customPath, options.customRouter);
  }

  // E2E Test utilities
  if (process.env.EMAIL_PROVIDER === 'mock' || process.env.NODE_ENV === 'test') {
    app.get("/api/v1/test/mock-emails", async (req, res) => {
      const { getEmailProvider } = await import("./services/EmailProvider");
      const provider: any = getEmailProvider();
      res.json(provider.emails || []);
    });
    app.delete("/api/v1/test/mock-emails", async (req, res) => {
      const { getEmailProvider } = await import("./services/EmailProvider");
      const provider: any = getEmailProvider();
      provider.emails = [];
      res.json({ success: true });
    });
    app.post("/api/v1/test/publish-event", async (req, res) => {
      const { userId, event } = req.body;
      const { eventBus } = await import("./services/EventBus");
      eventBus.publish(userId, event);
      res.json({ success: true });
    });
  }

  // Health & Readiness probes
  app.use(healthRouter);

  // Error handler (must be last before listen)
  app.use(errorHandler);

  return app;
}
