/**
 * scripts/migrateDevDb.ts
 *
 * Applies the LifeLoop schema to the "public" schema of the local development
 * database. Reads DATABASE_URL via getConnectionString(), which enforces the
 * dev-DB guard: the host MUST be a loopback address (or listed in
 * DEV_DB_ALLOWED_HOSTS). Refuses with a clear message if it looks like a
 * production database is targeted (PROD_DB_HOST match). No override flag.
 *
 * Usage:
 *   npm run db:migrate:dev
 *
 * Pre-requisite: create the local database first, e.g.:
 *   createdb -h 127.0.0.1 -p 5433 -U postgres lifeloop_dev_db
 */
import "dotenv/config";
import postgres from "postgres";
import { getConnectionString, logDbStartup, normalizeHost } from "../src/db/config";
import { applySchema } from "../src/db/applySchema";

async function main() {
  // getConnectionString() will throw a credential-free error if DATABASE_URL
  // points to a non-loopback / production host.
  const url = getConnectionString();
  logDbStartup(url);

  // Verify the resolved host is loopback. getConnectionString() already enforces
  // this for NODE_ENV != production/test, but we add an explicit runtime check
  // here as a second line of defence for the migration script.
  const parsed = new URL(url);
  const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);
  if (!LOOPBACK.has(normalizeHost(parsed.hostname))) {
    // Should not reach here if config.ts is working correctly, but be safe.
    console.error(
      "[db:migrate:dev] REFUSED: resolved database host is not a loopback address. " +
      "This script may only run against a local database."
    );
    process.exit(1);
  }

  const base = url.replace("-pooler", "");
  const connectionString = base.includes("?")
    ? `${base}&options=-c%20search_path%3Dpublic`
    : `${base}?options=-c%20search_path%3Dpublic`;

  const sql = postgres(connectionString, { max: 1, onnotice: () => {} });
  try {
    await applySchema(sql, "public");
    console.log("[db:migrate:dev] Done. All tables are ready in the 'public' schema.");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("[db:migrate:dev] FAILED:", err.message);
  process.exit(1);
});
