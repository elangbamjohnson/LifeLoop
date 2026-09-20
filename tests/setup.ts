import { createApp } from "../src/server/app";
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

  const app = createApp({ customPath, customRouter });

  const server = http.createServer(app);
  const poolId = parseInt(process.env.VITEST_POOL_ID || "1", 10);
  const port = 34000 + (poolId * 100) + (nextPortOffset++ % 80);
  server.listen(port, "127.0.0.1");
  server.unref();

  return server as unknown as express.Application;
}

