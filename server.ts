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
import { errorHandler } from "./src/server/middlewares/errorHandler";

async function startServer() {
  const app = express();
  
  // Trust the proxy to correctly resolve client IP for rate limiting behind Cloud Run / AI Studio infrastructure
  app.set("trust proxy", 1);
  
  const PORT = 3000;

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
  
  app.get("/api/v1/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
