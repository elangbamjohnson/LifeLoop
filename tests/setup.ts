import express from "express";
import cookieParser from "cookie-parser";
import { authRouter } from "../src/server/api/v1/auth";
import { capturesRouter } from "../src/server/api/v1/captures";
import { itemsRouter } from "../src/server/api/v1/items";
import { remindersRouter } from "../src/server/api/v1/reminders";
import { askRouter } from "../src/server/api/v1/ask";
import { relationsRouter } from "../src/server/api/v1/relations";
import { familiesRouter } from "../src/server/api/v1/families";
import { eventsRouter } from "../src/server/api/v1/events";
import { healthRouter } from "../src/server/api/health";
import { errorHandler } from "../src/server/middlewares/errorHandler";

import http from "http";
import https from "https";

let nextPortOffset = 0;

export function createTestApp(customPath?: string, customRouter?: express.Router) {
  delete process.env.HTTP_PROXY;
  delete process.env.HTTPS_PROXY;
  delete process.env.http_proxy;
  delete process.env.https_proxy;
  delete process.env.ALL_PROXY;
  delete process.env.all_proxy;
  process.env.NO_PROXY = "*";
  process.env.no_proxy = "*";

  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  // Mount standard API routes once
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/captures", capturesRouter);
  app.use("/api/v1/items", itemsRouter);
  app.use("/api/v1/reminders", remindersRouter);
  app.use("/api/v1/ask", askRouter);
  app.use("/api/v1/relations", relationsRouter);
  app.use("/api/v1/families", familiesRouter);
  app.use("/api/v1/events", eventsRouter);

  const standardPaths = [
    "/api/v1/auth",
    "/api/v1/captures",
    "/api/v1/items",
    "/api/v1/reminders",
    "/api/v1/ask",
    "/api/v1/relations",
    "/api/v1/families",
    "/api/v1/events"
  ];
  if (customPath && customRouter && !standardPaths.includes(customPath)) {
    app.use(customPath, customRouter);
  }

  // Shared Health & Readiness probes
  app.use(healthRouter);

  app.use(errorHandler);

  const server = http.createServer(app);
  const poolId = parseInt(process.env.VITEST_POOL_ID || "1", 10);
  const port = 34000 + (poolId * 100) + (nextPortOffset++ % 80);
  server.listen(port, "127.0.0.1");
  server.unref();

  return server as unknown as express.Application;
}

