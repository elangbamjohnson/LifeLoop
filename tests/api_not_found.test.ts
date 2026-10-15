import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { buildApp } from "../server";

describe("API 404 Fallthrough Guard", () => {
  let app: any;

  beforeAll(async () => {
    process.env.DISABLE_HMR = "true";
    app = await buildApp();
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
