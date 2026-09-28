import "dotenv/config";
import { v4 as uuidv4 } from "uuid";
import { db } from "../src/db";
import { users, captures, items, reminders } from "../src/db/schema";
import { eq, inArray } from "drizzle-orm";
import { GeminiAIProvider, buildExtractionPrompt, GEMINI_MODEL } from "../src/server/services/AIProvider";

// Ensure we run the real Gemini provider, not the test mock
process.env.NODE_ENV = "development";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("GEMINI_API_KEY not found in environment");
  process.exit(1);
}

const provider = new GeminiAIProvider(apiKey);

const tenPhrases = [
  "Pay rent on Oct 5",
  "Dentist Oct 5 at 4:30 pm",
  "Remind me in 2 minutes to check the oven",
  "Car insurance renewal due next Friday",
  "Call mom tomorrow at 10 am",
  "Electricity bill due the 18th",
  "Submit report by end of month",
  "Gym at 6",
  "Passport expires March 2027",
  "Meeting with Henderson tomorrow",
];

const newYorkPhrases = [
  "Dentist Oct 5 at 4:30 pm",
  "Call mom tomorrow at 10 am",
  "Pay rent on Oct 5",
];

async function runPhrasesForTimezone(phrases: string[], timezone: string) {
  // 1. Create a user with specified timezone in local dev DB
  const [user] = await db
    .insert(users)
    .values({
      email: `verify_${timezone.replace(/[^a-zA-Z0-9]/g, "_")}_${uuidv4()}@example.com`,
      passwordHash: "dummy",
      settings: {
        timezone,
        autoReminders: true,
      },
    })
    .returning();

  const results = [];

  for (const phrase of phrases) {
    // 2. Insert capture record
    const [capture] = await db
      .insert(captures)
      .values({
        userId: user.id,
        source: "web",
        type: "text",
        rawPayload: phrase,
        processingStatus: "pending",
      })
      .returning();

    // 3. Process capture through real GeminiAIProvider
    await provider.processCapture(capture.id, user.id, phrase, "text", timezone);

    // 4. Fetch extracted item and created reminders from DB
    const [extractedItem] = await db.select().from(items).where(eq(items.captureId, capture.id)).limit(1);
    const itemReminders = extractedItem
      ? await db.select().from(reminders).where(eq(reminders.itemId, extractedItem.id))
      : [];

    results.push({
      input: phrase,
      item: extractedItem
        ? {
            title: extractedItem.title,
            itemType: extractedItem.itemType,
            dueDate: extractedItem.dueDate,
            hasExplicitTime: (extractedItem.metadata as any)?.hasExplicitTime ?? false,
          }
        : null,
      remindersCount: itemReminders.length,
      reminderDetails: itemReminders.map((r) => ({
        id: r.id,
        triggerType: r.triggerType,
        scheduledAt: r.scheduledAt,
        relativeOffsetDays: r.relativeOffsetDays,
        status: r.status,
      })),
    });

    // Gentle pacing for LLM API rate limits
    await new Promise((resolve) => setTimeout(resolve, 600));
  }

  // Cleanup test user and associated records
  await db.delete(reminders).where(eq(reminders.userId, user.id));
  await db.delete(items).where(eq(items.userId, user.id));
  await db.delete(captures).where(eq(captures.userId, user.id));
  await db.delete(users).where(eq(users.id, user.id));

  return results;
}

async function main() {
  const dbUrlStr = process.env.DATABASE_URL || "postgres://postgres:password@127.0.0.1:5433/lifeloop_dev_db";
  const dbUrl = new URL(dbUrlStr);
  const redactedUrl = `${dbUrl.protocol}//${dbUrl.username}:***@${dbUrl.host}${dbUrl.pathname}`;
  console.log(`Database connected: ${redactedUrl} (host: ${dbUrl.host})`);
  console.log(`Using GEMINI_MODEL: ${GEMINI_MODEL}`);
  
  console.log("\n=== 1. TEN PHRASES (Asia/Kolkata) ===");
  const kolkataResults = await runPhrasesForTimezone(tenPhrases, "Asia/Kolkata");
  console.log(JSON.stringify(kolkataResults, null, 2));

  console.log("\n=== 2. THREE PHRASES (America/New_York) ===");
  const newYorkResults = await runPhrasesForTimezone(newYorkPhrases, "America/New_York");
  console.log(JSON.stringify(newYorkResults, null, 2));

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
