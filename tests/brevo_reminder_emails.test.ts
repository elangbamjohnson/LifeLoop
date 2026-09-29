import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { db } from "../src/db";
import { users, reminders, notificationLogs } from "../src/db/schema";
import { eq, inArray, and } from "drizzle-orm";
import { reminderService } from "../src/server/services/ReminderService";
import {
  BrevoMailSender,
  MockMailSender,
  getMailSender,
  setMailSender,
  getAppUrl,
} from "../src/server/services/MailSender";
import {
  EmailNotificationProvider,
  notificationDispatcher,
} from "../src/server/services/NotificationProvider";

describe("Brevo Reminder Emails & MailSender Integration", () => {
  const testUserIds: string[] = [];
  let mockSender: MockMailSender;

  beforeAll(() => {
    mockSender = new MockMailSender();
    setMailSender(mockSender);
  });

  afterAll(async () => {
    if (testUserIds.length > 0) {
      await db.delete(notificationLogs).where(inArray(notificationLogs.userId, testUserIds));
      await db.delete(reminders).where(inArray(reminders.userId, testUserIds));
      await db.delete(users).where(inArray(users.id, testUserIds));
    }
  });

  beforeEach(() => {
    mockSender.emails = [];
    mockSender.setForceFailure(null);
  });

  async function createTestUser(opts: {
    emailVerified?: boolean;
    emailReminders?: boolean;
    timezone?: string;
  }) {
    const email = `test_user_${uuidv4()}@example.com`;
    const [user] = await db
      .insert(users)
      .values({
        email,
        passwordHash: "dummy",
        emailVerifiedAt: opts.emailVerified ? new Date() : null,
        accountStatus: opts.emailVerified ? "active" : "pending_verification",
        settings: {
          timezone: opts.timezone || "America/New_York",
          autoReminders: false,
          emailReminders: opts.emailReminders ?? false,
          channels: ["web"],
        },
      })
      .returning();

    testUserIds.push(user.id);
    return user;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // A. BrevoMailSender Unit Tests
  // ──────────────────────────────────────────────────────────────────────────
  describe("BrevoMailSender Unit Tests", () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      process.env.BREVO_API_KEY = "test-secret-key-12345";
      process.env.EMAIL_FROM_ADDRESS = "reminders@testdomain.com";
      process.env.EMAIL_FROM_NAME = "LifeLoop Test";
    });

    afterAll(() => {
      process.env = originalEnv;
    });

    it("sends correct URL, headers, and body shape to Brevo API", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({ messageId: "<brevo-msg-123@smtp-relay.mailin.fr>" }),
      });
      vi.stubGlobal("fetch", fetchSpy);

      const sender = new BrevoMailSender();
      const res = await sender.send({
        to: "recipient@example.com",
        subject: "Test Subject",
        text: "Plain text",
        html: "<p>HTML text</p>",
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://api.brevo.com/v3/smtp/email");
      expect(options.method).toBe("POST");
      expect(options.headers).toEqual({
        "api-key": "test-secret-key-12345",
        "content-type": "application/json",
        accept: "application/json",
      });

      const body = JSON.parse(options.body);
      expect(body).toEqual({
        sender: {
          name: "LifeLoop Test",
          email: "reminders@testdomain.com",
        },
        to: [{ email: "recipient@example.com" }],
        subject: "Test Subject",
        htmlContent: "<p>HTML text</p>",
        textContent: "Plain text",
      });

      expect(res).toEqual({
        ok: true,
        messageId: "<brevo-msg-123@smtp-relay.mailin.fr>",
      });

      vi.unstubAllGlobals();
    });

    it("returns ok: false on 400 response with truncated error message", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => "Invalid email address or unverified domain in sender field",
      });
      vi.stubGlobal("fetch", fetchSpy);

      const sender = new BrevoMailSender();
      const res = await sender.send({
        to: "bad-email",
        subject: "Test",
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toContain("Brevo API error (400): Invalid email address");
      }

      vi.unstubAllGlobals();
    });

    it("handles network error gracefully without throwing", async () => {
      const fetchSpy = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED 1.2.3.4:443"));
      vi.stubGlobal("fetch", fetchSpy);

      const sender = new BrevoMailSender();
      let threw = false;
      let res: any;
      try {
        res = await sender.send({ to: "test@example.com", subject: "Test" });
      } catch {
        threw = true;
      }

      expect(threw).toBe(false);
      expect(res.ok).toBe(false);
      expect(res.error).toContain("ECONNREFUSED");

      vi.unstubAllGlobals();
    });

    it("handles timeout error gracefully without throwing", async () => {
      const timeoutErr = new Error("The operation was aborted due to timeout");
      timeoutErr.name = "TimeoutError";
      const fetchSpy = vi.fn().mockRejectedValue(timeoutErr);
      vi.stubGlobal("fetch", fetchSpy);

      const sender = new BrevoMailSender();
      const res = await sender.send({ to: "test@example.com", subject: "Test" });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBe("Request timed out");
      }

      vi.unstubAllGlobals();
    });

    it("never includes API key in error messages or results", async () => {
      const secretKey = "super-secret-brevo-api-key-99999";
      process.env.BREVO_API_KEY = secretKey;

      const fetchSpy = vi.fn().mockRejectedValue(new Error("Unauthorized: token was invalid"));
      vi.stubGlobal("fetch", fetchSpy);

      const sender = new BrevoMailSender();
      const res = await sender.send({ to: "test@example.com", subject: "Test" });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).not.toContain(secretKey);
      }

      vi.unstubAllGlobals();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // B. EmailNotificationProvider HTML Escaping & Validation
  // ──────────────────────────────────────────────────────────────────────────
  describe("EmailNotificationProvider Unit Tests", () => {
    it("escapes HTML in title and body (e.g. <script> & ampersands)", async () => {
      const provider = new EmailNotificationProvider();
      const payload = {
        reminderId: uuidv4(),
        userId: uuidv4(),
        title: 'Review "Taxes" & Budget <script>alert("xss")</script>',
        body: 'Check 401(k) & Roth IRA <img src=x onerror=alert(1)>',
        channel: "email" as const,
        scheduledAt: new Date("2026-10-15T15:30:00Z"),
        metadata: {
          userEmail: "safe@example.com",
          timezone: "UTC",
        },
      };

      const result = await provider.send(payload, "test_key_1");
      expect(result.status).toBe("delivered");
      expect(mockSender.emails.length).toBe(1);

      const sentEmail = mockSender.emails[0];
      expect(sentEmail.html).toBeDefined();
      expect(sentEmail.html).not.toContain('<script>alert("xss")</script>');
      expect(sentEmail.html).toContain("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;");
      expect(sentEmail.html).toContain("&amp;");
      expect(sentEmail.html).not.toContain('<img src=x onerror=alert(1)>');
      expect(sentEmail.html).toContain("&lt;img src=x onerror=alert(1)&gt;");

      // Verify subject is sanitized on single line
      expect(sentEmail.subject).not.toContain("\n");
      expect(sentEmail.subject.length).toBeLessThanOrEqual(120);
    });

    it("returns status 'failed' with error 'no recipient' when userEmail is missing", async () => {
      const provider = new EmailNotificationProvider();
      const payload = {
        reminderId: uuidv4(),
        userId: uuidv4(),
        title: "No Email Reminder",
        body: "Missing email in metadata",
        channel: "email" as const,
        scheduledAt: new Date(),
        metadata: {}, // Missing userEmail
      };

      const result = await provider.send(payload, "test_key_2");
      expect(result.success).toBe(false);
      expect(result.status).toBe("failed");
      expect(result.error).toBe("no recipient");
      expect(mockSender.emails.length).toBe(0); // Nothing sent
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // C. Integration Tests: dispatchDueReminders with emailReminders
  // ──────────────────────────────────────────────────────────────────────────
  describe("dispatchDueReminders with emailReminders", () => {
    it("sends email when emailReminders is on and user email is verified", async () => {
      const user = await createTestUser({
        emailVerified: true,
        emailReminders: true,
      });

      const now = new Date("2026-10-15T10:00:00Z");
      const [reminder] = await db
        .insert(reminders)
        .values({
          userId: user.id,
          title: "Doctor Appointment",
          scheduledAt: new Date("2026-10-15T09:30:00Z"),
          status: "scheduled",
          channel: "web",
        })
        .returning();

      const results = await reminderService.dispatchDueReminders(now);

      // Web + Email results
      expect(results.length).toBe(2);
      expect(mockSender.emails.length).toBe(1);
      expect(mockSender.emails[0].to).toBe(user.email);
      expect(mockSender.emails[0].subject).toContain("Doctor Appointment");

      const [dbReminder] = await db.select().from(reminders).where(eq(reminders.id, reminder.id));
      expect(dbReminder.status).toBe("sent");
    });

    it("does NOT send email when emailReminders is off", async () => {
      const user = await createTestUser({
        emailVerified: true,
        emailReminders: false,
      });

      const now = new Date("2026-10-15T10:00:00Z");
      await db.insert(reminders).values({
        userId: user.id,
        title: "Web Only Reminder",
        scheduledAt: new Date("2026-10-15T09:30:00Z"),
        status: "scheduled",
        channel: "web",
      });

      await reminderService.dispatchDueReminders(now);
      expect(mockSender.emails.length).toBe(0);
    });

    it("does NOT send email when user email is unverified", async () => {
      const user = await createTestUser({
        emailVerified: false, // Unverified
        emailReminders: true,
      });

      const now = new Date("2026-10-15T10:00:00Z");
      await db.insert(reminders).values({
        userId: user.id,
        title: "Unverified User Reminder",
        scheduledAt: new Date("2026-10-15T09:30:00Z"),
        status: "scheduled",
        channel: "web",
      });

      await reminderService.dispatchDueReminders(now);
      expect(mockSender.emails.length).toBe(0);
    });

    it("never sends two emails for one reminder when primary channel is 'email'", async () => {
      const user = await createTestUser({
        emailVerified: true,
        emailReminders: true,
      });

      const now = new Date("2026-10-15T10:00:00Z");
      await db.insert(reminders).values({
        userId: user.id,
        title: "Direct Email Reminder",
        scheduledAt: new Date("2026-10-15T09:30:00Z"),
        status: "scheduled",
        channel: "email",
      });

      await reminderService.dispatchDueReminders(now);
      expect(mockSender.emails.length).toBe(1);
    });

    it("retries failed email dispatch on next run, incrementing deliveryAttempts", async () => {
      const user = await createTestUser({
        emailVerified: true,
        emailReminders: true,
      });

      const now = new Date("2026-10-15T10:00:00Z");
      const [reminder] = await db
        .insert(reminders)
        .values({
          userId: user.id,
          title: "Flaky Network Reminder",
          scheduledAt: new Date("2026-10-15T09:30:00Z"),
          status: "scheduled",
          channel: "email",
        })
        .returning();

      // 1. Force failure on first attempt
      mockSender.setForceFailure("Simulated Brevo 500 error");
      const results1 = await reminderService.dispatchDueReminders(now);
      expect(results1.some((r) => r.status === "failed")).toBe(true);

      // Verify reminder was NOT marked sent and deliveryAttempts was incremented
      const [afterFail] = await db.select().from(reminders).where(eq(reminders.id, reminder.id));
      expect(afterFail.status).toBe("scheduled");
      expect((afterFail.metadata as any)?.deliveryAttempts).toBe(1);

      // 2. Clear failure for second run
      mockSender.setForceFailure(null);
      const results2 = await reminderService.dispatchDueReminders(now);
      expect(results2.some((r) => r.status === "delivered")).toBe(true);

      const [afterSuccess] = await db.select().from(reminders).where(eq(reminders.id, reminder.id));
      expect(afterSuccess.status).toBe("sent");
    });

    it("sets deliveryFailed=true after 5 consecutive failures and marks sent", async () => {
      const user = await createTestUser({
        emailVerified: true,
        emailReminders: true,
      });

      const now = new Date("2026-10-15T10:00:00Z");
      const [reminder] = await db
        .insert(reminders)
        .values({
          userId: user.id,
          title: "Persistent Failure Reminder",
          scheduledAt: new Date("2026-10-15T09:30:00Z"),
          status: "scheduled",
          channel: "email",
          metadata: { deliveryAttempts: 4 }, // 4 attempts already
        })
        .returning();

      // 5th attempt fails
      mockSender.setForceFailure("Persistent Outage");
      await reminderService.dispatchDueReminders(now);

      const [afterFifth] = await db.select().from(reminders).where(eq(reminders.id, reminder.id));
      expect(afterFifth.status).toBe("sent");
      expect((afterFifth.metadata as any)?.deliveryFailed).toBe(true);
      expect((afterFifth.metadata as any)?.deliveryAttempts).toBe(5);

      // Clear force failure and verify subsequent run does not pick it up (status is sent)
      mockSender.setForceFailure(null);
      const subsequentResults = await reminderService.dispatchDueReminders(now);
      const pickedUp = subsequentResults.find((r) => r.idempotencyKey?.includes(reminder.id));
      expect(pickedUp).toBeUndefined();
    });

    it("resets deliveryAttempts to 0 when a recurring reminder advances", async () => {
      const user = await createTestUser({
        emailVerified: true,
        emailReminders: true,
      });

      const now = new Date("2026-10-15T10:00:00Z");
      const [reminder] = await db
        .insert(reminders)
        .values({
          userId: user.id,
          title: "Daily Standup Reminder",
          scheduledAt: new Date("2026-10-15T09:00:00Z"),
          status: "scheduled",
          recurrence: "daily",
          channel: "web",
          metadata: { deliveryAttempts: 3 },
        })
        .returning();

      await reminderService.dispatchDueReminders(now);

      const [updated] = await db.select().from(reminders).where(eq(reminders.id, reminder.id));
      expect(updated.status).toBe("scheduled");
      expect(new Date(updated.scheduledAt).getTime()).toBeGreaterThan(now.getTime());
      expect((updated.metadata as any)?.deliveryAttempts).toBe(0);
    });

    it("sends exactly one email during two overlapping concurrent dispatch calls", async () => {
      const user = await createTestUser({
        emailVerified: true,
        emailReminders: true,
      });

      const now = new Date("2026-10-15T10:00:00Z");
      const [reminder] = await db
        .insert(reminders)
        .values({
          userId: user.id,
          title: "Concurrent Email Reminder",
          scheduledAt: new Date("2026-10-15T09:55:00Z"),
          status: "scheduled",
          channel: "web",
        })
        .returning();

      // Execute two simultaneous dispatch passes
      await Promise.all([
        reminderService.dispatchDueReminders(now),
        reminderService.dispatchDueReminders(now),
      ]);

      // Exactly 1 email sent in total
      const emailsForReminder = mockSender.emails.filter((e) =>
        e.subject.includes(reminder.title)
      );
      expect(emailsForReminder.length).toBe(1);

      // Verify logs table has 1 delivery record for channel "email"
      const emailLogs = await db
        .select()
        .from(notificationLogs)
        .where(
          and(
            eq(notificationLogs.reminderId, reminder.id),
            eq(notificationLogs.channel, "email")
          )
        );
      expect(emailLogs.length).toBe(1);
      expect(emailLogs[0].status).toBe("delivered");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // D. MailSender configuration, getAppUrl, and provider selection (Items 1 to 3)
  // ──────────────────────────────────────────────────────────────────────────
  describe("MailSender configuration, getAppUrl, and provider selection (Items 1 to 3)", () => {
    it("getAppUrl returns APP_URL when set, falls back to RENDER_EXTERNAL_URL, or returns empty string", () => {
      const origApp = process.env.APP_URL;
      const origRender = process.env.RENDER_EXTERNAL_URL;

      process.env.APP_URL = "https://myapp.com";
      expect(getAppUrl()).toBe("https://myapp.com");

      delete process.env.APP_URL;
      process.env.RENDER_EXTERNAL_URL = "https://renderapp.com";
      expect(getAppUrl()).toBe("https://renderapp.com");

      delete process.env.RENDER_EXTERNAL_URL;
      expect(getAppUrl()).toBe("");

      process.env.APP_URL = origApp;
      process.env.RENDER_EXTERNAL_URL = origRender;
    });

    it("getMailSender initializes MockMailSender when MAIL_PROVIDER=mock or unset, ignoring EMAIL_PROVIDER", () => {
      const origMail = process.env.MAIL_PROVIDER;
      const origEmail = process.env.EMAIL_PROVIDER;
      const origNodeEnv = process.env.NODE_ENV;

      process.env.NODE_ENV = "development";
      process.env.EMAIL_PROVIDER = "brevo"; // Should be completely ignored by MailSender
      process.env.MAIL_PROVIDER = "mock";
      setMailSender(null);

      const sender = getMailSender();
      expect(sender).toBeInstanceOf(MockMailSender);

      process.env.MAIL_PROVIDER = origMail;
      process.env.EMAIL_PROVIDER = origEmail;
      process.env.NODE_ENV = origNodeEnv;
      setMailSender(mockSender);
    });

    it("getMailSender initializes BrevoMailSender when MAIL_PROVIDER=brevo", () => {
      const origMail = process.env.MAIL_PROVIDER;
      const origNodeEnv = process.env.NODE_ENV;

      process.env.NODE_ENV = "development";
      process.env.MAIL_PROVIDER = "brevo";
      setMailSender(null);

      const sender = getMailSender();
      expect(sender).toBeInstanceOf(BrevoMailSender);

      process.env.MAIL_PROVIDER = origMail;
      process.env.NODE_ENV = origNodeEnv;
      setMailSender(mockSender);
    });

    it("getMailSender throws FATAL error in production when MAIL_PROVIDER is invalid", () => {
      const origMail = process.env.MAIL_PROVIDER;
      const origNodeEnv = process.env.NODE_ENV;

      process.env.NODE_ENV = "production";
      process.env.MAIL_PROVIDER = "invalid_provider";
      setMailSender(null);

      expect(() => getMailSender()).toThrowError(/FATAL: Invalid MAIL_PROVIDER 'invalid_provider'/);

      process.env.MAIL_PROVIDER = origMail;
      process.env.NODE_ENV = origNodeEnv;
      setMailSender(mockSender);
    });

    it("getMailSender logs a warning and falls back to mock outside production when MAIL_PROVIDER is invalid", () => {
      const origMail = process.env.MAIL_PROVIDER;
      const origNodeEnv = process.env.NODE_ENV;
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      process.env.NODE_ENV = "development";
      process.env.MAIL_PROVIDER = "invalid_provider";
      setMailSender(null);

      const sender = getMailSender();
      expect(sender).toBeInstanceOf(MockMailSender);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown MAIL_PROVIDER 'invalid_provider'"));

      warnSpy.mockRestore();
      process.env.MAIL_PROVIDER = origMail;
      process.env.NODE_ENV = origNodeEnv;
      setMailSender(mockSender);
    });

    it("logs one line at startup with the active provider name, without keys or addresses", () => {
      const origMail = process.env.MAIL_PROVIDER;
      const origNodeEnv = process.env.NODE_ENV;
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      process.env.NODE_ENV = "development";
      process.env.MAIL_PROVIDER = "brevo";
      process.env.BREVO_API_KEY = "sensitive_key_xyz";
      process.env.EMAIL_FROM_ADDRESS = "sensitive_addr@test.com";
      setMailSender(null);

      getMailSender();
      expect(logSpy).toHaveBeenCalledWith("[MailSender] Active mail provider: brevo");
      const allLogCalls = logSpy.mock.calls.map((c) => c.join(" ")).join(" ");
      expect(allLogCalls).not.toContain("sensitive_key_xyz");
      expect(allLogCalls).not.toContain("sensitive_addr@test.com");

      logSpy.mockRestore();
      process.env.MAIL_PROVIDER = origMail;
      process.env.NODE_ENV = origNodeEnv;
      setMailSender(mockSender);
    });
  });
});
