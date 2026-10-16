import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/server/app";
import { createServer as createViteServer } from "vite";
import { apiNotFound } from "../src/server/middlewares/apiNotFound";
import { errorHandler } from "../src/server/middlewares/errorHandler";

describe("API 404 Fallthrough Guard", () => {
  let app: any;

  beforeAll(async () => {
    app = createApp();

    // Stop /api/* falling through to the app using the real guard middleware
    app.all("/api/*", apiNotFound);

    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: "spa",
    });
    app.use(vite.middlewares);
    app.use(errorHandler);
  });

  it("returns 404 with JSON for unmatched /api/* route and HTML for app root", async () => {
    // 1. Unmatched /api/* path must return 404 with JSON and never index.html
    const apiRes = await request(app).get("/api/v1/does-not-exist");
    expect(apiRes.status).toBe(404);
    expect(apiRes.headers["content-type"]).toMatch(/application\/json/);
    expect(apiRes.body).toEqual({ error: "Not found" });

    // 2. Request to the app root still returns HTML
    const rootRes = await request(app).get("/");
    expect(rootRes.status).toBe(200);
    expect(rootRes.headers["content-type"]).toMatch(/text\/html/);
  });
});
