import express from "express";
import cookieParser from "cookie-parser";
import { authRouter } from "../src/server/api/v1/auth";
import { capturesRouter } from "../src/server/api/v1/captures";
import { itemsRouter } from "../src/server/api/v1/items";
import { remindersRouter } from "../src/server/api/v1/reminders";
import { askRouter } from "../src/server/api/v1/ask";
import { relationsRouter } from "../src/server/api/v1/relations";
import { familiesRouter } from "../src/server/api/v1/families";
import { healthRouter } from "../src/server/api/health";
import { errorHandler } from "../src/server/middlewares/errorHandler";

import http from "http";
import https from "https";

// Dedicated non-pooling agent for local loopback test traffic (no proxy symbols)
const directHttpAgent = new http.Agent({ keepAlive: false });
const directHttpsAgent = new https.Agent({ keepAlive: false });
for (const agent of [directHttpAgent, directHttpsAgent]) {
  for (const sym of Object.getOwnPropertySymbols(agent)) {
    if (sym.toString().toLowerCase().includes("proxy")) {
      delete (agent as any)[sym];
    }
  }
}

const isLoopback = (opts: any) => {
  if (!opts) return true;
  const target = String(opts.hostname || opts.host || "").toLowerCase();
  return (
    !target ||
    target.startsWith("127.0.0.1") ||
    target.startsWith("localhost") ||
    target.startsWith("::1") ||
    target.startsWith("[::1]")
  );
};

const origHttpRequest = http.request;
(http as any).request = function(...args: any[]) {
  let opts: any;
  if (typeof args[0] === "string" || args[0] instanceof URL) {
    if (typeof args[1] === "function" || args[1] === undefined) {
      opts = {};
      args.splice(1, 0, opts);
    } else {
      opts = args[1];
    }
  } else {
    opts = args[0] = args[0] || {};
  }
  opts.agent = directHttpAgent;
  return origHttpRequest.apply(this, args as any);
};

const origHttpsRequest = https.request;
(https as any).request = function(...args: any[]) {
  let opts: any;
  if (typeof args[0] === "string" || args[0] instanceof URL) {
    if (typeof args[1] === "function" || args[1] === undefined) {
      opts = {};
      args.splice(1, 0, opts);
    } else {
      opts = args[1];
    }
  } else {
    opts = args[0] = args[0] || {};
  }
  opts.agent = directHttpsAgent;
  return origHttpsRequest.apply(this, args as any);
};

const OrigClientRequest = http.ClientRequest;
(http as any).ClientRequest = function(input: any, options: any, cb: any) {
  if (typeof options === "function") {
    cb = options;
    options = {};
  } else {
    options = options || {};
  }
  options.agent = directHttpAgent;
  return new OrigClientRequest(input, options, cb);
};

http.globalAgent = directHttpAgent;
https.globalAgent = directHttpsAgent;

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

