import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const client = postgres({
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  database: process.env.SQL_DB_NAME || "cloud_sql_development_database",
  host: process.env.SQL_HOST,
});

export const db = drizzle(client, { schema });
