import express from "express";
import cookieParser from "cookie-parser";
import { authRouter } from "../src/server/api/v1/auth";
import { capturesRouter } from "../src/server/api/v1/captures";
import { itemsRouter } from "../src/server/api/v1/items";
import { remindersRouter } from "../src/server/api/v1/reminders";
import { askRouter } from "../src/server/api/v1/ask";
import { relationsRouter } from "../src/server/api/v1/relations";
import { familiesRouter } from "../src/server/api/v1/families";
import { errorHandler } from "../src/server/middlewares/errorHandler";

export function createTestApp(customPath?: string, customRouter?: express.Router) {
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

  const standardPaths = [
    "/api/v1/auth",
    "/api/v1/captures",
    "/api/v1/items",
    "/api/v1/reminders",
    "/api/v1/ask",
    "/api/v1/relations",
    "/api/v1/families"
  ];
  if (customPath && customRouter && !standardPaths.includes(customPath)) {
    app.use(customPath, customRouter);
  }

  app.use(errorHandler);
  return app;
}

