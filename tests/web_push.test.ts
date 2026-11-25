import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import webPush from "web-push";
import { db } from "../src/db";
import { users, pushSubscriptions, reminders, items } from "../src/db/schema";
import { eq, inArray } from "drizzle-orm";
import { createTestApp } from "./setup";
import { createApp } from "../src/server/app";
import { WebNotificationProvider } from "../src/server/services/NotificationProvider";
import { reminderService } from "../src/server/services/ReminderService";

vi.mock("web-push", () => {
  const mockWebPush = {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn().mockResolvedValue({ statusCode: 201 }),
    generateVAPIDKeys: vi.fn(() => ({ publicKey: "mock-pub", privateKey: "mock-priv" })),
  };
  return {
    default: mockWebPush,
    ...mockWebPush,
  };
});

const app = createTestApp();
const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret_for_development_only";

describe("Web Push Notifications (tests/web_push.test.ts)", () => {
  let testUserId: string;
  let authCookie: string;
  const createdUserIds: string[] = [];
  const webProvider = new WebNotificationProvider();

  beforeAll(async () => {
    const [user] = await db
      .insert(users)
      .values({
        email: `push_test_${uuidv4()}@example.com`,
        passwordHash: "dummy",
        accountStatus: "active",
        settings: {
          timezone: "UTC",
          autoReminders: true,
          channels: ["web"],
        },
      })
      .returning();

    testUserId = user.id;
    createdUserIds.push(user.id);
    const token = jwt.sign({ userId: user.id }, JWT_SECRET);
    authCookie = `session=${token}`;
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.userId, createdUserIds));
      await db.delete(reminders).where(inArray(reminders.userId, createdUserIds));
      await db.delete(items).where(inArray(items.userId, createdUserIds));
      await db.delete(users).where(inArray(users.id, createdUserIds));
    }
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.VAPID_PUBLIC_KEY = "test-mock-public-key";
    process.env.VAPID_PRIVATE_KEY = "test-mock-private-key";
    process.env.VAPID_SUBJECT = "mailto:test@lifeloop.app";

    // Clean up test subscriptions before each test
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, testUserId));
  });

  // 1. Subscribe test
  it.each([
    "https://fcm.googleapis.com/fcm/send/sub-",
    "https://updates.push.services.mozilla.com/wpush/v2/sub-",
    "https://web.push.apple.com/Qsub-",
    "https://wns2-bl2p.notify.windows.com/?token=sub-",
  ])("subscribe: stores a subscription for %s", async (baseEndpoint) => {
    const endpoint = `${baseEndpoint}${uuidv4()}`;
    const res = await request(app)
      .post("/api/v1/push/subscribe")
      .set("Cookie", authCookie)
      .send({
        endpoint,
        keys: {
          p256dh: "mock_p256dh_string",
          auth: "mock_auth_string",
        },
        userAgent: "TestAgent/1.0",
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const [saved] = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, endpoint));

    expect(saved).toBeDefined();
    expect(saved.userId).toBe(testUserId);
    expect(saved.p256dh).toBe("mock_p256dh_string");
    expect(saved.auth).toBe("mock_auth_string");
  });

  it.each([
    "https://127.0.0.1/internal",
    "https://example.com/collect",
    "http://fcm.googleapis.com/fcm/send/sub",
    "https://fcm.googleapis.com:8443/fcm/send/sub",
    "https://user@fcm.googleapis.com/fcm/send/sub",
    "https://fcm.googleapis.com@127.0.0.1/internal",
    "https://web.push.apple.com.example.com/sub",
    "https://evilpush.apple.com/sub",
  ])("subscribe: rejects and does not store %s", async (endpoint) => {
    const res = await request(app)
      .post("/api/v1/push/subscribe")
      .set("Cookie", authCookie)
      .send({ endpoint, keys: { p256dh: "key", auth: "auth" } });

    expect(res.status).toBe(400);
    const saved = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
    expect(saved).toHaveLength(0);
  });

  it("subscribe: lets the owner refresh a subscription and blocks another account from overwriting it", async () => {
    const [owner] = await db.insert(users).values({
      email: `push_owner_${uuidv4()}@example.com`,
      accountStatus: "active",
    }).returning();
    createdUserIds.push(owner.id);
    const endpoint = `https://fcm.googleapis.com/fcm/send/sub-owner-${uuidv4()}`;
    await db.insert(pushSubscriptions).values({ userId: owner.id, endpoint, p256dh: "old", auth: "old" });

    const refreshed = await request(app)
      .post("/api/v1/push/subscribe")
      .set("Cookie", `session=${jwt.sign({ userId: owner.id }, JWT_SECRET)}`)
      .send({ endpoint, keys: { p256dh: "updated-key", auth: "updated-auth" } });
    expect(refreshed.status).toBe(200);

    const takeover = await request(app)
      .post("/api/v1/push/subscribe")
      .set("Cookie", authCookie)
      .send({ endpoint, keys: { p256dh: "other-key", auth: "other-auth" } });
    expect(takeover.status).toBe(409);

    const [saved] = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
    expect(saved).toMatchObject({ userId: owner.id, p256dh: "updated-key", auth: "updated-auth" });
  });

  it("status: requires authentication and only confirms the current account's subscription", async () => {
    const endpoint = `https://fcm.googleapis.com/fcm/send/status-${uuidv4()}`;
    await db.insert(pushSubscriptions).values({ userId: testUserId, endpoint, p256dh: "key", auth: "auth" });
    await request(app).post("/api/v1/push/status").send({ endpoint }).expect(401);
    const owned = await request(app).post("/api/v1/push/status").set("Cookie", authCookie).send({ endpoint });
    expect(owned.body).toEqual({ registered: true, available: true });
    const [other] = await db.insert(users).values({ email: `push_status_${uuidv4()}@example.com`, accountStatus: "active" }).returning();
    createdUserIds.push(other.id);
    const otherCookie = `session=${jwt.sign({ userId: other.id }, JWT_SECRET)}`;
    const unowned = await request(app).post("/api/v1/push/status").set("Cookie", otherCookie).send({ endpoint });
    expect(unowned.body).toEqual({ registered: false, available: true });
    const removal = await request(app).delete("/api/v1/push/subscribe").set("Cookie", otherCookie).send({ endpoint });
    expect(removal.body.removed).toBe(false);
    const [remaining] = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
    expect(remaining.userId).toBe(testUserId);
  });

  it("status: reports unavailable and withholds the public key when the private key is missing", async () => {
    delete process.env.VAPID_PRIVATE_KEY;
    const status = await request(app).post("/api/v1/push/status").set("Cookie", authCookie).send({ endpoint: "https://fcm.googleapis.com/fcm/send/missing" });
    expect(status.body).toEqual({ registered: false, available: false });
    const key = await request(app).get("/api/v1/push/public-key").set("Cookie", authCookie);
    expect(key.body.publicKey).toBe("");
  });

  // 2. Unsubscribe test
  it("unsubscribe: deletes subscription when turning off push", async () => {
    const endpoint = `https://fcm.googleapis.com/fcm/send/sub-${uuidv4()}`;
    await db.insert(pushSubscriptions).values({
      userId: testUserId,
      endpoint,
      p256dh: "key",
      auth: "auth",
    });

    const res = await request(app)
      .delete("/api/v1/push/subscribe")
      .set("Cookie", authCookie)
      .send({ endpoint });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const remaining = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, endpoint));

    expect(remaining.length).toBe(0);
  });

  // 3. Success to 2 subscriptions
  it("success to 2 subscriptions: sends push to both and returns delivered with count", async () => {
    const endpoint1 = `https://fcm.googleapis.com/fcm/send/sub-1-${uuidv4()}`;
    const endpoint2 = `https://fcm.googleapis.com/fcm/send/sub-2-${uuidv4()}`;

    await db.insert(pushSubscriptions).values([
      { userId: testUserId, endpoint: endpoint1, p256dh: "p1", auth: "a1" },
      { userId: testUserId, endpoint: endpoint2, p256dh: "p2", auth: "a2" },
    ]);

    vi.mocked(webPush.sendNotification).mockResolvedValue({ statusCode: 201 });

    const result = await webProvider.send(
      {
        reminderId: uuidv4(),
        userId: testUserId,
        title: "Test Reminder",
        body: "Don't forget",
        channel: "web",
        scheduledAt: new Date(),
        itemId: uuidv4(),
      },
      "idem-success-2"
    );

    expect(result.status).toBe("delivered");
    expect(result.success).toBe(true);
    expect(result.payload.pushed).toBe(2);
    expect(webPush.sendNotification).toHaveBeenCalledTimes(2);
  });

  it("skips unsupported subscriptions already stored in the database", async () => {
    const endpoint = `https://fcm.googleapis.com/fcm/send/sub-${uuidv4()}`;
    await db.insert(pushSubscriptions).values([
      { userId: testUserId, endpoint: "https://127.0.0.1/internal", p256dh: "old", auth: "old" },
      { userId: testUserId, endpoint, p256dh: "key", auth: "auth" },
    ]);
    vi.mocked(webPush.sendNotification).mockResolvedValue({ statusCode: 201 });

    const result = await webProvider.send({
      reminderId: uuidv4(),
      userId: testUserId,
      title: "Test Reminder",
      body: "Reminder body",
      channel: "web",
      scheduledAt: new Date(),
    }, "idem-skip-unsupported");

    expect(result.payload.pushed).toBe(1);
    expect(webPush.sendNotification).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ endpoint }),
      expect.any(String)
    );
  });

  // 4. One 410 that deletes only that subscription
  it("one 410 that deletes only that subscription: deletes expired subscription without counting as failure", async () => {
    const ep410 = `https://fcm.googleapis.com/fcm/send/sub-410-${uuidv4()}`;
    const epValid = `https://fcm.googleapis.com/fcm/send/sub-valid-${uuidv4()}`;

    await db.insert(pushSubscriptions).values([
      { userId: testUserId, endpoint: ep410, p256dh: "p410", auth: "a410" },
      { userId: testUserId, endpoint: epValid, p256dh: "pValid", auth: "aValid" },
    ]);

    vi.mocked(webPush.sendNotification).mockImplementation(async (sub: any) => {
      if (sub.endpoint === ep410) {
        const err: any = new Error("Subscription expired");
        err.statusCode = 410;
        throw err;
      }
      return { statusCode: 201 };
    });

    const result = await webProvider.send(
      {
        reminderId: uuidv4(),
        userId: testUserId,
        title: "Test 410 Reminder",
        body: "Check 410",
        channel: "web",
        scheduledAt: new Date(),
      },
      "idem-410"
    );

    expect(result.status).toBe("delivered");
    expect(result.payload.pushed).toBe(1);

    // Verify ep410 was deleted from DB
    const [sub410InDb] = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, ep410));
    expect(sub410InDb).toBeUndefined();

    // Verify epValid is still present
    const [subValidInDb] = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, epValid));
    expect(subValidInDb).toBeDefined();
  });

  // 5. All-fail returning failed (and a reminder going back to scheduled with deliveryAttempts +1)
  it("all-fail returning failed (and a reminder going back to scheduled with deliveryAttempts +1)", async () => {
    const failEp = `https://fcm.googleapis.com/fcm/send/sub-fail-${uuidv4()}`;
    await db.insert(pushSubscriptions).values({
      userId: testUserId,
      endpoint: failEp,
      p256dh: "pfail",
      auth: "afail",
    });

    vi.mocked(webPush.sendNotification).mockRejectedValue({
      statusCode: 500,
      message: "Push service temporary error",
    });

    // A. Direct provider test: returns "failed" with sanitized error
    const directResult = await webProvider.send(
      {
        reminderId: uuidv4(),
        userId: testUserId,
        title: "Failing Push",
        body: "Will fail",
        channel: "web",
        scheduledAt: new Date(),
      },
      "idem-fail-1"
    );

    expect(directResult.status).toBe("failed");
    expect(directResult.success).toBe(false);
    expect(directResult.error).toBeDefined();
    expect(directResult.error).not.toContain("test-mock-private-key");

    // B. Dispatcher test: reminder reverts to scheduled with deliveryAttempts +1
    const [item] = await db
      .insert(items)
      .values({
        userId: testUserId,
        title: "Due Item for Dispatch Test",
        itemType: "task",
        status: "active",
      })
      .returning();

    const [reminder] = await db
      .insert(reminders)
      .values({
        userId: testUserId,
        itemId: item.id,
        title: "Due Reminder Dispatch Test",
        scheduledAt: new Date(Date.now() - 5000), // In past, due now
        channel: "web",
        status: "scheduled",
        metadata: { deliveryAttempts: 0 },
      })
      .returning();

    await reminderService.dispatchDueReminders(new Date());

    const [updatedReminder] = await db
      .select()
      .from(reminders)
      .where(eq(reminders.id, reminder.id));

    expect(updatedReminder.status).toBe("scheduled");
    expect((updatedReminder.metadata as any)?.deliveryAttempts).toBe(1);
  });

  // 6. Missing keys keeping the old behavior
  it("missing keys keeping the old behavior: delivered with pushed: 0", async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;

    const result = await webProvider.send(
      {
        reminderId: uuidv4(),
        userId: testUserId,
        title: "Missing Keys Reminder",
        body: "Old behavior",
        channel: "web",
        scheduledAt: new Date(),
      },
      "idem-missing-keys"
    );

    expect(result.status).toBe("delivered");
    expect(result.success).toBe(true);
    expect(result.payload.pushed).toBe(0);
    expect(webPush.sendNotification).not.toHaveBeenCalled();
  });

  // 7. An exception that is caught
  it("an exception that is caught: provider never throws on unexpected error", async () => {
    const endpoint = `https://fcm.googleapis.com/fcm/send/sub-ex-${uuidv4()}`;
    await db.insert(pushSubscriptions).values({
      userId: testUserId,
      endpoint,
      p256dh: "pex",
      auth: "aex",
    });

    vi.mocked(webPush.setVapidDetails).mockImplementation(() => {
      throw new Error("Unexpected crash in VAPID details parser");
    });

    let threw = false;
    let result: any;
    try {
      result = await webProvider.send(
        {
          reminderId: uuidv4(),
          userId: testUserId,
          title: "Crash Reminder",
          body: "Should catch",
          channel: "web",
          scheduledAt: new Date(),
        },
        "idem-ex"
      );
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(result).toBeDefined();
    expect(result.status).toBe("failed");
    expect(result.error).toBeDefined();
  });

  // 8. Missing table must not break reminders
  it("missing table must not break reminders: loading subscriptions throws -> logs warning and returns delivered with pushed: 0", async () => {
    process.env.VAPID_PUBLIC_KEY = "test-mock-public-key";
    process.env.VAPID_PRIVATE_KEY = "test-mock-private-key";

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const origSelect = db.select.bind(db);
    const selectSpy = vi.spyOn(db, "select").mockImplementation((...args: any[]) => {
      const query = origSelect(...args);
      const origFrom = query.from.bind(query);
      query.from = (table: any) => {
        if (table === pushSubscriptions) {
          throw new Error('relation "push_subscriptions" does not exist (simulated missing table)');
        }
        return origFrom(table);
      };
      return query;
    });

    const result = await webProvider.send(
      {
        reminderId: uuidv4(),
        userId: testUserId,
        title: "Missing Table Reminder",
        body: "Should still be delivered",
        channel: "web",
        scheduledAt: new Date(),
      },
      "idem-missing-table"
    );

    expect(result.status).toBe("delivered");
    expect(result.success).toBe(true);
    expect(result.payload.pushed).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[WebNotificationProvider] Failed to load push subscriptions")
    );
    // Ensure no secrets are leaked in warning
    const warnedMsg = warnSpy.mock.calls.map((c) => c.join(" ")).join(" ");
    expect(warnedMsg).not.toContain("test-mock-private-key");

    warnSpy.mockRestore();
    selectSpy.mockRestore();
  });

  // 9. Reminder goes through dispatchDueReminders to status sent when subscription table is missing
  it("dispatchDueReminders updates reminder to status sent when subscription table is missing", async () => {
    process.env.VAPID_PUBLIC_KEY = "test-mock-public-key";
    process.env.VAPID_PRIVATE_KEY = "test-mock-private-key";

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const origSelect = db.select.bind(db);
    const selectSpy = vi.spyOn(db, "select").mockImplementation((...args: any[]) => {
      const query = origSelect(...args);
      const origFrom = query.from.bind(query);
      query.from = (table: any) => {
        if (table === pushSubscriptions) {
          throw new Error('relation "push_subscriptions" does not exist (simulated missing table)');
        }
        return origFrom(table);
      };
      return query;
    });

    const [item] = await db
      .insert(items)
      .values({
        userId: testUserId,
        title: "Item for Missing Table Test",
        itemType: "task",
        status: "active",
      })
      .returning();

    const [reminder] = await db
      .insert(reminders)
      .values({
        userId: testUserId,
        itemId: item.id,
        title: "Reminder for Missing Table Test",
        scheduledAt: new Date(Date.now() - 5000), // Due now
        channel: "web",
        status: "scheduled",
        metadata: { deliveryAttempts: 0 },
      })
      .returning();

    await reminderService.dispatchDueReminders(new Date());

    const [updatedReminder] = await db
      .select()
      .from(reminders)
      .where(eq(reminders.id, reminder.id));

    expect(updatedReminder.status).toBe("sent");
    expect(updatedReminder.sentAt).toBeDefined();

    warnSpy.mockRestore();
    selectSpy.mockRestore();
  });

  // 10. Public key route returns configured key
  it("public key route returns the configured public key", async () => {
    process.env.VAPID_PUBLIC_KEY = "test-vapid-public-key-value";
    const res = await request(app)
      .get("/api/v1/push/public-key")
      .set("Cookie", authCookie);

    expect(res.status).toBe(200);
    expect(res.body.publicKey).toBe("test-vapid-public-key-value");
  });
});

it.each(["development", "production"] as const)("hides E2E routes in %s even with mock email enabled", async (environment) => {
  vi.stubEnv("NODE_ENV", environment);
  vi.stubEnv("EMAIL_PROVIDER", "mock");
  try {
    const app = request(createApp());
    await app.post("/api/v1/test/publish-event").send({ userId: uuidv4(), event: {} }).expect(404);
    await app.get("/api/v1/test/mock-emails").expect(404);
  } finally {
    vi.unstubAllEnvs();
  }
});
