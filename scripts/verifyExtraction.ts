import "dotenv/config";
import { v4 as uuidv4 } from "uuid";
import { db } from "../src/db";
import { users, captures, items, reminders } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { GEMINI_MODEL, GeminiAIProvider, buildExtractionPrompt } from "../src/server/services/AIProvider";
import { getConnectionString } from "../src/db/config";

// Ensure we run the real Gemini provider, not the test mock
process.env.NODE_ENV = "development";
process.env.DEBUG_AI = "1";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("GEMINI_API_KEY not found in environment");
  process.exit(1);
}

const provider = new GeminiAIProvider(apiKey);

// Demonstrate and verify that the production prompt builder is imported and injects timezone and current time
const samplePrompt = buildExtractionPrompt("Sample task", "text", "Asia/Kolkata", new Date());
console.log(`[Imported Production Prompt Builder Verification]: Prompt contains timezone: ${samplePrompt.includes("Asia/Kolkata")}`);

const phrases = [
  "Remind me in 2 minutes to check the oven",
  "Dentist Oct 5 at 4:30 pm",
  "Pay rent on Oct 5",
];

async function runVerification() {
  const timezone = "Asia/Kolkata";
  console.log(`\n=== Running Live Gemini Verification for user in ${timezone} ===`);
  const captureTime = new Date();
  console.log(`Capture reference time: ${captureTime.toISOString()}`);

  // 1. Create test user in local dev DB with Asia/Kolkata timezone
  const [user] = await db
    .insert(users)
    .values({
      email: `verify_${uuidv4()}@example.com`,
      passwordHash: "dummy",
      settings: {
        timezone,
        autoReminders: true,
      },
    })
    .returning();

  for (const phrase of phrases) {
    console.log(`\n--------------------------------------------------`);
    console.log(`INPUT PHRASE: "${phrase}"`);
    console.log(`--------------------------------------------------`);

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

    // 4. Fetch stored item and reminders from local dev DB
    const [storedItem] = await db.select().from(items).where(eq(items.captureId, capture.id)).limit(1);
    const storedReminders = storedItem
      ? await db.select().from(reminders).where(eq(reminders.itemId, storedItem.id))
      : [];

    console.log(`\nSTORED ITEM:`);
    if (storedItem) {
      console.log(`  id: ${storedItem.id}`);
      console.log(`  title: ${storedItem.title}`);
      console.log(`  itemType: ${storedItem.itemType}`);
      console.log(`  dueDate (UTC): ${storedItem.dueDate ? new Date(storedItem.dueDate).toISOString() : null}`);
      console.log(`  hasExplicitTime: ${(storedItem.metadata as any)?.hasExplicitTime}`);
    } else {
      console.log(`  No item found in DB`);
    }

    console.log(`\nSTORED REMINDERS (${storedReminders.length}):`);
    for (const r of storedReminders) {
      console.log(`  - id: ${r.id}`);
      console.log(`    triggerType: ${r.triggerType}`);
      console.log(`    scheduledAt (UTC): ${new Date(r.scheduledAt).toISOString()}`);
      console.log(`    relativeOffsetDays: ${r.relativeOffsetDays}`);
      console.log(`    status: ${r.status}`);
    }

    // Pacing for API rate limits
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  // Cleanup test user and associated records
  await db.delete(reminders).where(eq(reminders.userId, user.id));
  await db.delete(items).where(eq(items.userId, user.id));
  await db.delete(captures).where(eq(captures.userId, user.id));
  await db.delete(users).where(eq(users.id, user.id));
  console.log(`\nCleaned up test user ${user.id}.`);
}

async function main() {
  const dbUrlStr = getConnectionString();
  const dbUrl = new URL(dbUrlStr);
  const redactedUrl = `${dbUrl.protocol}//${dbUrl.username}:***@${dbUrl.host}${dbUrl.pathname}`;
  console.log(`Database connected: ${redactedUrl} (host: ${dbUrl.host})`);
  console.log(`Using GEMINI_MODEL: ${GEMINI_MODEL}`);

  await runVerification();
  process.exit(0);
}

main().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
