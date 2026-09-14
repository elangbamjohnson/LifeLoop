import { db } from "./src/db";
import { users } from "./src/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

async function main() {
  const email = "test@example.com";
  const password = "password123";
  
  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing.length > 0) {
    console.log("Test user already exists.");
  } else {
    const passwordHash = await bcrypt.hash(password, 10);
    await db.insert(users).values({ email, passwordHash });
    console.log("Test user created successfully!");
  }
  process.exit(0);
}

main().catch(console.error);
