import dotenv from "dotenv";
if (process.env.NODE_ENV === "test") {
  dotenv.config({ path: ".env.test", quiet: true });
  delete process.env.DATABASE_URL;
} else {
  dotenv.config({ quiet: true });
}

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const isTest = process.env.NODE_ENV === "test";

if (isTest) {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error("FATAL: TEST_DATABASE_URL environment variable is required for tests. No fallback allowed.");
  }
  
  if (process.env.DATABASE_URL) {
    const testUrl = new URL(process.env.TEST_DATABASE_URL);
    const prodUrl = new URL(process.env.DATABASE_URL);
    if (testUrl.host === prodUrl.host && testUrl.pathname === prodUrl.pathname) {
      throw new Error("FATAL: TEST_DATABASE_URL cannot point to the same host and database as DATABASE_URL.");
    }
  }
}

let connectionString = isTest ? process.env.TEST_DATABASE_URL! : process.env.DATABASE_URL!;

if (!connectionString) {
  throw new Error("FATAL: DATABASE_URL environment variable is missing");
}

if (isTest) {
  // Workers use <runId>_w<POOL_ID> schema if running in Vitest.
  // We assume TEST_SCHEMA is passed by the test runner (e.g. vitest globalSetup -> worker setup).
  const testSchema = process.env.TEST_SCHEMA || "lifeloop_test";
  const base = connectionString.replace("-pooler", "");
  connectionString = base.includes("?") 
    ? `${base}&options=-c%20search_path%3D${testSchema}` 
    : `${base}?options=-c%20search_path%3D${testSchema}`;
} else {
  // Use unpooled direct connection with strictly enforced public schema
  const base = connectionString.replace("-pooler", "");
  connectionString = base.includes("?") 
    ? `${base}&options=-c%20search_path%3Dpublic` 
    : `${base}?options=-c%20search_path%3Dpublic`;
}

const client = postgres(connectionString, {
  max: isTest ? 3 : 10,
  idle_timeout: isTest ? 2 : 30,
  connect_timeout: 30,
  max_lifetime: isTest ? 120 : 60 * 30,
});

export const db = drizzle(client, { schema });

