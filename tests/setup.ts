import { createApp } from "../src/server/app";
import type express from "express";
import http from "http";

export function createTestApp(customPath?: string, customRouter?: express.Router) {
  delete process.env.HTTP_PROXY;
  delete process.env.HTTPS_PROXY;
  delete process.env.http_proxy;
  delete process.env.https_proxy;
  delete process.env.ALL_PROXY;
  delete process.env.all_proxy;
  process.env.NO_PROXY = "*";
  process.env.no_proxy = "*";

  const app = createApp({ customPath, customRouter });

  const server = http.createServer(app);
  // Port 0 → OS picks a free ephemeral port; eliminates EADDRINUSE across files
  server.listen(0, "127.0.0.1");
  server.unref();

  return server as unknown as express.Application;
}

