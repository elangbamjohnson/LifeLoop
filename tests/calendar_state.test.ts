/**
 * tests/calendar_state.test.ts
 *
 * Integration tests for:
 *   POST   /api/v1/items/:id/calendar-added
 *   DELETE /api/v1/items/:id/calendar-added
 *
 * Expected coverage:
 *   - save (POST saves metadata.calendarAdded with at, dueDate, hasExplicitTime)
 *   - clear (DELETE removes metadata.calendarAdded)
 *   - 401 (without session)
 *   - 404 (for another user's item or missing item)
 *   - other metadata keys are kept (merges cleanly, never overwrites other keys)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { itemsRouter } from "../src/server/api/v1/items";
import { db } from "../src/db";
import { users, items } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { createTestApp } from "./setup";

const app = createTestApp("/api/v1/items", itemsRouter);
const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret_for_development_only";

describe("Calendar Added State API", () => {
  let userAId: string;
  let authCookieA: string;
  let userBId: string;
  let authCookieB: string;

  let itemAId: string;
  let itemBId: string;

  beforeAll(async () => {
    userAId = uuidv4();
    userBId = uuidv4();

    await db.insert(users).values([
      {
        id: userAId,
        email: `cal_state_user_a_${userAId}@lifeloop.test`,
        passwordHash: "dummy",
        accountStatus: "active",
      },
      {
        id: userBId,
        email: `cal_state_user_b_${userBId}@lifeloop.test`,
        passwordHash: "dummy",
        accountStatus: "active",
      },
    ]);

    authCookieA = `session=${jwt.sign({ userId: userAId }, JWT_SECRET)}`;
    authCookieB = `session=${jwt.sign({ userId: userBId }, JWT_SECRET)}`;

    // Create item for user A with custom metadata
    const [itemA] = await db
      .insert(items)
      .values({
        userId: userAId,
        title: "Dentist Visit",
        itemType: "task",
        status: "active",
        dueDate: new Date("2026-11-20T14:30:00.000Z"),
        metadata: {
          hasExplicitTime: true,
          vendor: "Dental Care Clinic",
          cost: 150,
          notes: "Routine checkup",
        },
      })
      .returning();
    itemAId = itemA.id;

    // Create item for user B
    const [itemB] = await db
      .insert(items)
      .values({
        userId: userBId,
        title: "User B Task",
        itemType: "task",
        status: "active",
        dueDate: new Date("2026-11-25T10:00:00.000Z"),
        metadata: {},
      })
      .returning();
    itemBId = itemB.id;
  });

  afterAll(async () => {
    await db.delete(items).where(eq(items.userId, userAId));
    await db.delete(items).where(eq(items.userId, userBId));
    await db.delete(users).where(eq(users.id, userAId));
    await db.delete(users).where(eq(users.id, userBId));
  });

  it("save: POST saves metadata.calendarAdded with at, dueDate, and hasExplicitTime", async () => {
    const res = await request(app)
      .post(`/api/v1/items/${itemAId}/calendar-added`)
      .set("Cookie", authCookieA)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.item).toBeDefined();

    const calAdded = res.body.item.metadata?.calendarAdded;
    expect(calAdded).toBeDefined();
    expect(calAdded.dueDate).toBe("2026-11-20T14:30:00.000Z");
    expect(calAdded.hasExplicitTime).toBe(true);
    expect(typeof calAdded.at).toBe("string");
    expect(isNaN(new Date(calAdded.at).getTime())).toBe(false);
  });

  it("other metadata keys are kept when saving and clearing calendarAdded", async () => {
    // 1. Verify custom metadata was preserved after the save above
    const [freshItem] = await db
      .select()
      .from(items)
      .where(eq(items.id, itemAId))
      .limit(1);

    expect(freshItem.metadata).toMatchObject({
      hasExplicitTime: true,
      vendor: "Dental Care Clinic",
      cost: 150,
      notes: "Routine checkup",
    });
    expect((freshItem.metadata as any).calendarAdded).toBeDefined();

    // 2. Call DELETE and verify other metadata keys remain intact
    const delRes = await request(app)
      .delete(`/api/v1/items/${itemAId}/calendar-added`)
      .set("Cookie", authCookieA);

    expect(delRes.status).toBe(200);
    expect(delRes.body.item.metadata.vendor).toBe("Dental Care Clinic");
    expect(delRes.body.item.metadata.cost).toBe(150);
    expect(delRes.body.item.metadata.notes).toBe("Routine checkup");
    expect(delRes.body.item.metadata.calendarAdded).toBeUndefined();

    // Re-save for following tests
    await request(app)
      .post(`/api/v1/items/${itemAId}/calendar-added`)
      .set("Cookie", authCookieA)
      .send();
  });

  it("clear: DELETE removes metadata.calendarAdded", async () => {
    const res = await request(app)
      .delete(`/api/v1/items/${itemAId}/calendar-added`)
      .set("Cookie", authCookieA);

    expect(res.status).toBe(200);
    expect(res.body.item.metadata?.calendarAdded).toBeUndefined();

    const [dbItem] = await db
      .select()
      .from(items)
      .where(eq(items.id, itemAId))
      .limit(1);
    expect((dbItem.metadata as any)?.calendarAdded).toBeUndefined();
  });

  it("401 without a session", async () => {
    const postRes = await request(app).post(`/api/v1/items/${itemAId}/calendar-added`);
    expect(postRes.status).toBe(401);

    const delRes = await request(app).delete(`/api/v1/items/${itemAId}/calendar-added`);
    expect(delRes.status).toBe(401);
  });

  it("404 for another user's item", async () => {
    // User A attempts to mutate User B's item
    const postRes = await request(app)
      .post(`/api/v1/items/${itemBId}/calendar-added`)
      .set("Cookie", authCookieA);
    expect(postRes.status).toBe(404);

    const delRes = await request(app)
      .delete(`/api/v1/items/${itemBId}/calendar-added`)
      .set("Cookie", authCookieA);
    expect(delRes.status).toBe(404);
  });
});
