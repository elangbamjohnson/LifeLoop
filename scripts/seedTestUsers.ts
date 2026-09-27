import "dotenv/config";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { users, items, captures } from "../src/db/schema";

async function seed() {
  console.log("Seeding test users into dev database...");

  const passwordHash = await bcrypt.hash("Password123!", 10);
  const now = new Date();

  // Test User 1
  const email1 = "testuser1@lifeloop.dev";
  let [user1] = await db.select().from(users).where(eq(users.email, email1)).limit(1);
  if (!user1) {
    [user1] = await db
      .insert(users)
      .values({
        email: email1,
        passwordHash,
        accountStatus: "active",
        emailVerifiedAt: now,
        authProvider: "local",
        isAdmin: false,
        settings: { timezone: "Asia/Kolkata" },
      })
      .returning();
    console.log(`Created user: ${email1} (${user1.id})`);
  } else {
    [user1] = await db
      .update(users)
      .set({
        passwordHash,
        accountStatus: "active",
        emailVerifiedAt: now,
        authProvider: "local",
      })
      .where(eq(users.id, user1.id))
      .returning();
    console.log(`Updated existing user: ${email1} (${user1.id})`);
  }

  // Add sample items for user1 if none exist
  const existingItems1 = await db.select().from(items).where(eq(items.userId, user1.id)).limit(1);
  if (existingItems1.length === 0) {
    const [cap1] = await db
      .insert(captures)
      .values({
        userId: user1.id,
        source: "web",
        type: "text",
        rawPayload: "Renew car insurance before end of month",
        processingStatus: "completed",
      })
      .returning();

    const in3Days = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const in7Days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const tomorrow = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000);

    await db.insert(items).values([
      {
        userId: user1.id,
        captureId: cap1.id,
        title: "Car Insurance Renewal",
        itemType: "renewal",
        dueDate: in3Days,
        status: "active",
      },
      {
        userId: user1.id,
        captureId: cap1.id,
        title: "Annual Health Checkup",
        itemType: "appointment",
        dueDate: in7Days,
        status: "active",
      },
      {
        userId: user1.id,
        captureId: cap1.id,
        title: "Pay Electricity Bill",
        itemType: "payment",
        dueDate: tomorrow,
        status: "active",
      },
    ]);
    console.log("Seeded sample items for user1");
  }

  // Test User 2
  const email2 = "testuser2@lifeloop.dev";
  let [user2] = await db.select().from(users).where(eq(users.email, email2)).limit(1);
  if (!user2) {
    [user2] = await db
      .insert(users)
      .values({
        email: email2,
        passwordHash,
        accountStatus: "active",
        emailVerifiedAt: now,
        authProvider: "local",
        isAdmin: false,
        settings: { timezone: "Asia/Kolkata" },
      })
      .returning();
    console.log(`Created user: ${email2} (${user2.id})`);
  } else {
    [user2] = await db
      .update(users)
      .set({
        passwordHash,
        accountStatus: "active",
        emailVerifiedAt: now,
        authProvider: "local",
      })
      .where(eq(users.id, user2.id))
      .returning();
    console.log(`Updated existing user: ${email2} (${user2.id})`);
  }

  // Add sample item for user2 if none exist
  const existingItems2 = await db.select().from(items).where(eq(items.userId, user2.id)).limit(1);
  if (existingItems2.length === 0) {
    const [cap2] = await db
      .insert(captures)
      .values({
        userId: user2.id,
        source: "web",
        type: "text",
        rawPayload: "Gym membership recurring payment",
        processingStatus: "completed",
      })
      .returning();

    const in5Days = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    await db.insert(items).values([
      {
        userId: user2.id,
        captureId: cap2.id,
        title: "Gym Membership Subscription",
        itemType: "subscription",
        dueDate: in5Days,
        status: "active",
      },
    ]);
    console.log("Seeded sample items for user2");
  }

  console.log("Seeding complete!");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
