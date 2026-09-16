import dotenv from "dotenv";
dotenv.config();

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const isTest = process.env.NODE_ENV === "test";
let connectionString = (isTest && process.env.TEST_DATABASE_URL) ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL!;

if (!connectionString) {
  throw new Error("FATAL: DATABASE_URL environment variable is missing");
}

if (isTest && !process.env.TEST_DATABASE_URL) {
  // Use unpooled direct Neon connection with isolated lifeloop_test search_path
  const base = connectionString.replace("-pooler", "");
  connectionString = base.includes("?") 
    ? `${base}&options=-c%20search_path%3Dlifeloop_test%2Cpublic` 
    : `${base}?options=-c%20search_path%3Dlifeloop_test%2Cpublic`;
}

const client = postgres(connectionString, {
  max: isTest ? 3 : 10,
  idle_timeout: isTest ? 2 : 30,
  connect_timeout: 30,
  max_lifetime: isTest ? 120 : 60 * 30,
});

export const db = drizzle(client, { schema });

