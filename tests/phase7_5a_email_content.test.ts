import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/server/app";
import { db } from "../src/db";
import { users } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { getEmailProvider } from "../src/server/services/EmailProvider";

const app = createApp();

describe("Phase 7.5A-2 Email Content Validation", () => {
  beforeAll(async () => {
    // Make sure we have a clean state in the mock provider
    const provider: any = getEmailProvider();
    if (provider.emails) {
      provider.emails = [];
    }
  });

  afterAll(async () => {
    const provider: any = getEmailProvider();
    if (provider.emails) {
      provider.emails = [];
    }
  });

  it("Validates the contents of a generated verification email", async () => {
    // 1. Register a user
    const email = `content_test_${Date.now()}@example.com`;
    const password = "Password123!";
    
    await request(app)
      .post("/api/v1/auth/register")
      .send({ email, password })
      .expect(201);

    // 2. Retrieve the email from the mock provider
    const provider: any = getEmailProvider();
    const sentEmails = provider.emails || [];
    expect(sentEmails.length).toBeGreaterThan(0);
    
    const verificationEmail = sentEmails.find((e: any) => e.to === email);
    expect(verificationEmail).toBeDefined();
    expect(verificationEmail.subject).toBe("Verify your LifeLoop email address");

    // 3. Assert on the content
    const { text, html, verifyUrl } = verificationEmail;

    // Verify link uses the frontend URL pattern (no api/v1/auth)
    expect(verifyUrl).toContain("/verify-email?token=");
    expect(verifyUrl).not.toContain("/api/v1/auth");

    // Expiration wording is present
    expect(text).toContain("expire at");
    expect(html).toContain("expire at");

    // No sensitive information is leaked
    const noSensitiveLeak = (content: string) => {
      expect(content).not.toContain(password);
      expect(content).not.toContain("hash");
      expect(content).not.toContain("session");
      // note: in sqlite this is sync? No, drizzle is async. Let's do async.
    };

    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    expect(text).not.toContain(user.id);
    expect(html).not.toContain(user.id);
    expect(text).not.toContain(password);
    expect(html).not.toContain(password);
    expect(text).not.toContain(user.passwordHash);
    expect(html).not.toContain(user.passwordHash);

    // Both text and HTML bodies exist
    expect(text.length).toBeGreaterThan(0);
    expect(html.length).toBeGreaterThan(0);
  });
});
