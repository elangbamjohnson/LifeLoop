/**
 * src/db/migrateTestSchema.ts
 *
 * Test-only entry point. Delegates the actual DDL to the shared applySchema()
 * function in applySchema.ts. Reads TEST_DATABASE_URL exclusively — never
 * DATABASE_URL. Never touches a remote or production database.
 */
import dotenv from "dotenv";
if (process.env.NODE_ENV === "test") {
  dotenv.config({ path: ".env.test", quiet: true });
  delete process.env.DATABASE_URL;
} else {
  dotenv.config({ quiet: true });
}
import postgres from "postgres";
import { applySchema } from "./applySchema";

const rawConnectionString = process.env.TEST_DATABASE_URL;
if (!rawConnectionString) {
  throw new Error(
    "TEST_DATABASE_URL is required for test migrations. DATABASE_URL fallback is strictly forbidden."
  );
}
const connectionString = rawConnectionString.replace("-pooler", "");

export async function setupTestSchema(
  targetSchema: string = process.env.TEST_SCHEMA || "lifeloop_test"
): Promise<void> {
  const sql = postgres(connectionString, { onnotice: () => {} });
  try {
    await applySchema(sql, targetSchema);
  } finally {
    await sql.end();
  }
}

export async function truncateTestSchema(
  targetSchema: string = process.env.TEST_SCHEMA || "lifeloop_test"
): Promise<void> {
  const sql = postgres(connectionString, { onnotice: () => {} });
  try {
    await sql.unsafe(`
      DO $$ DECLARE
        r RECORD;
      BEGIN
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = '${targetSchema}') LOOP
          EXECUTE 'TRUNCATE TABLE ${targetSchema}.' || quote_ident(r.tablename) || ' CASCADE';
        END LOOP;
      END $$;
    `);
    console.log(`[TestDB] Test schema '${targetSchema}' tables truncated.`);
  } finally {
    await sql.end();
  }
}

if (process.argv[1]?.endsWith("migrateTestSchema.ts")) {
  setupTestSchema()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[TestDB] Error setting up test schema:", err);
      process.exit(1);
    });
}
