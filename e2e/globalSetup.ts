import dotenv from "dotenv";
dotenv.config({ path: ".env.test", quiet: true });
delete process.env.DATABASE_URL;

import { setupTestSchema, truncateTestSchema } from '../src/db/migrateTestSchema';
import { assertTestDatabaseGuard, assertTestDatabaseLiveGuard } from '../src/db/testDatabaseGuard';
import postgres from 'postgres';

export default async function globalSetup() {
  assertTestDatabaseGuard();
  const schemaName = process.env.TEST_SCHEMA || 'lifeloop_test_e2e';
  console.log(`[Playwright GlobalSetup] Ensuring isolated test database schema '${schemaName}' is ready...`);
  await setupTestSchema(schemaName);

  // Live query verification that the connection strictly resolves to test schema
  const rawConnectionString = process.env.TEST_DATABASE_URL!;
  const base = rawConnectionString.replace("-pooler", "");
  const connStr = base.includes("?")
    ? `${base}&options=-c%20search_path%3D${schemaName}`
    : `${base}?options=-c%20search_path%3D${schemaName}`;
  const sql = postgres(connStr, { max: 1, onnotice: () => {} });
  try {
    await assertTestDatabaseLiveGuard(sql, schemaName);
  } finally {
    await sql.end();
  }

  await truncateTestSchema(schemaName);
  console.log(`[Playwright GlobalSetup] Database safety guard verified: isolated test schema '${schemaName}' reset and ready.`);
}

