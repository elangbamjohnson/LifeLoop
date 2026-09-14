import { db } from "./src/db";
import { aiProvider } from "./src/server/services/AIProvider";
import { items, users, captures } from "./src/db/schema";
import { eq } from "drizzle-orm";

async function run() {
  const [user] = await db.select().from(users).limit(1);
  console.log("User:", user.id);
  
  const [capture] = await db.insert(captures).values({
    userId: user.id,
    type: "text",
    rawPayload: "I just bought a honda city",
    processingStatus: "pending"
  }).returning();
  
  console.log("Capture:", capture.id);
  
  try {
    await aiProvider.processCapture(capture.id, user.id, capture.rawPayload, "text");
    console.log("Success");
  } catch (err) {
    console.error("FAILED:", err);
  }
}
run();
