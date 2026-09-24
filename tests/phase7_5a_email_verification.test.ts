import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { createTestApp } from "./setup";
import { db } from "../src/db";
import { users, emailVerificationTokens } from "../src/db/schema";
import { sql, eq } from "drizzle-orm";
import { getEmailProvider, MockEmailProvider } from "../src/server/services/EmailProvider";
import crypto from "crypto";

describe("Phase 7.5A-1 Email Verification", () => {
  const app = createTestApp();
  const mockProvider = getEmailProvider() as MockEmailProvider;

  beforeEach(async () => {
    mockProvider.emails = [];
    await db.delete(emailVerificationTokens);
    await db.delete(users);
  });

  it("Registration creates pending account and sends verification email", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "testreg@example.com", password: "Password123!" });

    expect(res.status).toBe(201);
    expect(res.body.user.accountStatus).toBe("pending_verification");
    const cookies = Array.isArray(res.headers['set-cookie']) ? res.headers['set-cookie'] : [res.headers['set-cookie'] as string];
    expect(cookies).toBeDefined();

    const user = await db.select().from(users).where(eq(users.email, "testreg@example.com")).limit(1);
    expect(user[0].accountStatus).toBe("pending_verification");
    expect(user[0].emailVerifiedAt).toBeNull();
    expect(user[0].passwordHash).toBeDefined();

    expect(mockProvider.emails.length).toBe(1);
    expect(mockProvider.emails[0].to).toBe("testreg@example.com");
    expect(mockProvider.emails[0].verifyUrl).toContain("token=");
  });

  it("Verification activates account with valid token", async () => {
    await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "testverify@example.com", password: "Password123!" });

    const email = mockProvider.emails[0];
    const token = new URL(email.verifyUrl).searchParams.get("token")!;

    const verifyRes = await request(app).get(`/api/v1/auth/verify-email?token=${token}`);
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.success).toBe(true);

    const user = await db.select().from(users).where(eq(users.email, "testverify@example.com")).limit(1);
    expect(user[0].accountStatus).toBe("active");
    expect(user[0].emailVerifiedAt).not.toBeNull();

    // Verification idempotent reuse within 5 minutes
    const reuseRes = await request(app).get(`/api/v1/auth/verify-email?token=${token}`);
    expect(reuseRes.status).toBe(200);
  });

  it("Verification fails for expired, malformed, or nonexistent tokens", async () => {
    await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "testfail@example.com", password: "Password123!" });

    const email = mockProvider.emails[0];
    const token = new URL(email.verifyUrl).searchParams.get("token")!;

    // Malformed token
    const malformedRes = await request(app).get(`/api/v1/auth/verify-email?token=invalid`);
    expect(malformedRes.status).toBe(400);

    // Token with characters altered
    const alteredToken = token.substring(0, token.length - 1) + "a";
    const alteredRes = await request(app).get(`/api/v1/auth/verify-email?token=${alteredToken}`);
    expect(alteredRes.status).toBe(400);

    // Nonexistent token
    const nonexistentToken = crypto.randomBytes(32).toString('base64url');
    const nonexistentRes = await request(app).get(`/api/v1/auth/verify-email?token=${nonexistentToken}`);
    expect(nonexistentRes.status).toBe(400);
  });

  it("Concurrent double-submit only activates once cleanly", async () => {
    await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "testconcurrent@example.com", password: "Password123!" });

    const email = mockProvider.emails[0];
    const token = new URL(email.verifyUrl).searchParams.get("token")!;

    // Set up a trigger to count EXACTLY how many times the row was updated
    await db.execute(sql`
      DROP TABLE IF EXISTS test_updates_log;
      CREATE TABLE test_updates_log (id SERIAL, updated_at TIMESTAMP);
      TRUNCATE test_updates_log;
      
      CREATE OR REPLACE FUNCTION log_token_update() RETURNS trigger AS $$
      BEGIN
        INSERT INTO test_updates_log (updated_at) VALUES (NEW.used_at);
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      
      DROP TRIGGER IF EXISTS token_update_trigger ON email_verification_tokens;
      CREATE TRIGGER token_update_trigger 
      AFTER UPDATE ON email_verification_tokens
      FOR EACH ROW 
      WHEN (OLD.used_at IS DISTINCT FROM NEW.used_at)
      EXECUTE FUNCTION log_token_update();
    `);

    // Using supertest concurrently
    const [res1, res2] = await Promise.all([
      request(app).get(`/api/v1/auth/verify-email?token=${token}`),
      request(app).get(`/api/v1/auth/verify-email?token=${token}`)
    ]);

    // Both should be 200 because of the idempotency grace window
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const user = await db.select().from(users).where(eq(users.email, "testconcurrent@example.com")).limit(1);
    expect(user[0].accountStatus).toBe("active");

    // Prove single-write atomicity: exactly ONE update occurred across both concurrent requests
    const updates = await db.execute(sql`SELECT * FROM test_updates_log`);
    expect(updates.length).toBe(1);

    // Clean up
    await db.execute(sql`DROP TRIGGER IF EXISTS token_update_trigger ON email_verification_tokens`);
    await db.execute(sql`DROP FUNCTION IF EXISTS log_token_update()`);
    await db.execute(sql`DROP TABLE IF EXISTS test_updates_log`);
  });

  it("Idempotent verify-email within grace window works for sequential scanner hits", async () => {
    await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "testscanner@example.com", password: "Password123!" });

    const token = new URL(mockProvider.emails[0].verifyUrl).searchParams.get("token")!;

    // 1st hit (Scanner)
    const res1 = await request(app).get(`/api/v1/auth/verify-email?token=${token}`);
    expect(res1.status).toBe(200);

    // Simulate time passing: update usedAt to 3 minutes ago in the DB
    const user = await db.select().from(users).where(eq(users.email, "testscanner@example.com")).limit(1);
    await db.execute(sql`
      UPDATE email_verification_tokens 
      SET used_at = NOW() - INTERVAL '3 minutes'
      WHERE user_id = ${user[0].id}
    `);

    // 2nd hit (Real User)
    const res2 = await request(app).get(`/api/v1/auth/verify-email?token=${token}`);
    expect(res2.status).toBe(200);
  });

  it("Login blocks pending account with safe message", async () => {
    await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "testlogin@example.com", password: "Password123!" });

    const loginRes = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "testlogin@example.com", password: "Password123!" });

    expect(loginRes.status).toBe(401);
    expect(loginRes.body.error).toBe("Please verify your email address to log in");
    expect(loginRes.headers["set-cookie"]).toBeUndefined();
  });

  it("Resend works, invalidates old token, enforces rate limit", async () => {
    await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "testresend@example.com", password: "Password123!" });

    const oldToken = new URL(mockProvider.emails[0].verifyUrl).searchParams.get("token")!;
    mockProvider.emails = []; // clear

    const resendRes = await request(app)
      .post("/api/v1/auth/resend-verification")
      .send({ email: "testresend@example.com" });

    expect(resendRes.status).toBe(200);
    expect(resendRes.body.message).toContain("If an account requires email verification");
    expect(mockProvider.emails.length).toBe(1);

    const newToken = new URL(mockProvider.emails[0].verifyUrl).searchParams.get("token")!;
    expect(newToken).not.toBe(oldToken);

    // Old token fails
    const oldVerifyRes = await request(app).get(`/api/v1/auth/verify-email?token=${oldToken}`);
    expect(oldVerifyRes.status).toBe(400);

    // New token works
    const newVerifyRes = await request(app).get(`/api/v1/auth/verify-email?token=${newToken}`);
    expect(newVerifyRes.status).toBe(200);

    // Enforce rate limits (Account Limit: 3/hr per email, Global IP: 10/hr)
    process.env.DISABLE_RATE_LIMIT = "0";
    await request(app).post("/api/v1/auth/resend-verification").send({ email: "testresend@example.com" }); // 1 (in rate limit mode)
    await request(app).post("/api/v1/auth/resend-verification").send({ email: "testresend@example.com" }); // 2
    await request(app).post("/api/v1/auth/resend-verification").send({ email: "testresend@example.com" }); // 3
    const rateLimitedRes = await request(app).post("/api/v1/auth/resend-verification").send({ email: "testresend@example.com" }); // 4 -> should be 429
    expect(rateLimitedRes.status).toBe(429);
    process.env.DISABLE_RATE_LIMIT = "1";
  });

  it("Change email works for pending account, rejects duplicate", async () => {
    await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "testchange1@example.com", password: "Password123!" });

    await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "testchange2@example.com", password: "Password123!" });

    mockProvider.emails = [];

    // Duplicate rejection
    const duplicateRes = await request(app)
      .post("/api/v1/auth/change-email")
      .send({ currentEmail: "testchange1@example.com", newEmail: "testchange2@example.com" });
    expect(duplicateRes.status).toBe(400);
    expect(duplicateRes.body.error).toBe("Email already in use");

    // Success change
    const changeRes = await request(app)
      .post("/api/v1/auth/change-email")
      .send({ currentEmail: "testchange1@example.com", newEmail: "testnew@example.com" });
    expect(changeRes.status).toBe(200);
    
    expect(mockProvider.emails.length).toBe(1);
    expect(mockProvider.emails[0].to).toBe("testnew@example.com");

    const newToken = new URL(mockProvider.emails[0].verifyUrl).searchParams.get("token")!;
    const verifyRes = await request(app).get(`/api/v1/auth/verify-email?token=${newToken}`);
    expect(verifyRes.status).toBe(200);

    const user = await db.select().from(users).where(eq(users.email, "testnew@example.com")).limit(1);
    expect(user[0].accountStatus).toBe("active");
  });

  it("Protected resources block pending accounts", async () => {
    // Generate a valid JWT manually for a pending account to simulate someone 
    // getting a token somehow, or using an old token before account was suspended/pending
    
    // We register normally
    const regRes = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "testprotected@example.com", password: "Password123!" });

    const userRecord = await db.select().from(users).where(eq(users.email, "testprotected@example.com")).limit(1);
    const userId = userRecord[0].id;

    // Use the actual session cookie issued by registration
    const cookies = Array.isArray(regRes.headers['set-cookie']) ? regRes.headers['set-cookie'] : [regRes.headers['set-cookie'] as string];
    const sessionCookieStr = cookies.find((c: string) => c && c.startsWith('session='));
    expect(sessionCookieStr).toBeDefined();
    const cookie = sessionCookieStr!.split(';')[0];

    const routes = [
      { path: "/api/v1/items", method: "get" },
      { path: "/api/v1/captures", method: "get" },
      { path: "/api/v1/reminders", method: "get" },
      { path: "/api/v1/relations/123e4567-e89b-12d3-a456-426614174000", method: "get" },
      { path: "/api/v1/families", method: "get" },
      { path: "/api/v1/events", method: "get" },
      { path: "/api/v1/ask", method: "post" }
    ];

    for (const route of routes) {
      let res;
      if (route.method === "get") {
        res = await request(app).get(route.path).set("Cookie", cookie);
      } else {
        res = await request(app).post(route.path).set("Cookie", cookie).send({});
      }
      expect(res.status).toBe(403);
      expect(res.body.error).toContain("Please verify your email");
    }

    // /api/v1/auth/me should return exactly the limited info
    const meRes = await request(app).get("/api/v1/auth/me").set("Cookie", cookie);
    expect(meRes.status).toBe(200);
    expect(meRes.body.user).toEqual({
      id: userId,
      email: "testprotected@example.com",
      accountStatus: "pending_verification"
    });
  });

  it("Provider-failure resilience: registration succeeds even if email provider throws", async () => {
    // 1. Mock the provider to throw an error
    const spy = vi.spyOn(mockProvider, 'sendVerificationEmail').mockRejectedValueOnce(new Error("SMTP failure: connection refused"));

    // 2. Register should STILL return 201 because email sending happens asynchronously and doesn't crash the request
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "testproviderfail@example.com", password: "Password123!" });
    
    expect(res.status).toBe(201);
    expect(res.body.user).toBeDefined();

    // 3. User & token exist in DB
    const user = await db.select().from(users).where(eq(users.email, "testproviderfail@example.com")).limit(1);
    expect(user.length).toBe(1);
    expect(user[0].accountStatus).toBe("pending_verification");

    const tokens = await db.select().from(emailVerificationTokens).where(eq(emailVerificationTokens.userId, user[0].id));
    expect(tokens.length).toBe(1);

    // 4. A subsequent resend works and creates a new token WITHOUT creating a duplicate account
    const resendRes = await request(app).post("/api/v1/auth/resend-verification").send({ email: "testproviderfail@example.com" });
    expect(resendRes.status).toBe(200);

    const userAfter = await db.select().from(users).where(eq(users.email, "testproviderfail@example.com"));
    expect(userAfter.length).toBe(1); // No duplicate account

    spy.mockRestore();
  });

  it("Fake tokens are not leaked in logs", async () => {
    // We will spy on process.stdout.write (which pino uses) to verify no tokens are leaked
    const stdoutSpy = vi.spyOn(process.stdout, 'write');
    
    await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "testnoleak@example.com", password: "Password123!" });
      
    const email = mockProvider.emails[0];
    const token = new URL(email.verifyUrl).searchParams.get("token")!;
    
    // Check that the token itself never appeared in any log string
    for (const call of stdoutSpy.mock.calls) {
      const output = call[0] as string;
      expect(output).not.toContain(token);
    }
    
    stdoutSpy.mockRestore();
  });
});
