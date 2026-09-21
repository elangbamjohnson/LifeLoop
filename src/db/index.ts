import dotenv from "dotenv";
if (process.env.NODE_ENV === "test") {
  dotenv.config({ path: ".env.test", quiet: true });
  // In test mode, DATABASE_URL must never be reachable — delete it before any
  // other module can accidentally pick it up.
  delete process.env.DATABASE_URL;
} else {
  dotenv.config({ quiet: true });
}

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { getConnectionString } from "./config";

// getConnectionString() enforces all environment-specific guard rules and
// throws a credential-free error if any rule is violated.
const rawConnectionString = getConnectionString();

const isTest = process.env.NODE_ENV === "test";

// For test: pin to the isolated test schema.
// For dev/prod: pin to the public schema.
const testSchema = process.env.TEST_SCHEMA || "lifeloop_test";
const base = rawConnectionString.replace("-pooler", "");
const connectionString = isTest
  ? (base.includes("?")
      ? `${base}&options=-c%20search_path%3D${testSchema}`
      : `${base}?options=-c%20search_path%3D${testSchema}`)
  : (base.includes("?")
      ? `${base}&options=-c%20search_path%3Dpublic`
      : `${base}?options=-c%20search_path%3Dpublic`);

const client = postgres(connectionString, {
  max: isTest ? 3 : 10,
  idle_timeout: isTest ? 2 : 30,
  connect_timeout: 30,
  max_lifetime: isTest ? 120 : 60 * 30,
});

export const db = drizzle(client, { schema });
