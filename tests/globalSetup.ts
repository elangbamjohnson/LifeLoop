import dotenv from "dotenv";
dotenv.config({ path: ".env.test", quiet: true });
delete process.env.DATABASE_URL;
delete process.env.HTTP_PROXY;
delete process.env.HTTPS_PROXY;
delete process.env.http_proxy;
delete process.env.https_proxy;
process.env.NO_PROXY = "*";
process.env.no_proxy = "*";

import http from "http";
import https from "https";
for (const agent of [http.globalAgent, https.globalAgent]) {
  if (agent) {
    if ((agent as any).options) {
      (agent as any).options.proxyEnv = undefined;
    }
    for (const sym of Object.getOwnPropertySymbols(agent)) {
      if (sym.toString().includes("Proxy")) {
        (agent as any)[sym] = null;
      }
    }
  }
}

import { setupTestSchema, truncateTestSchema } from '../src/db/migrateTestSchema';
import { assertTestDatabaseGuard } from '../src/db/testDatabaseGuard';
import postgres from 'postgres';

let currentRunId = '';

export async function setup({ provide }: any) {
  assertTestDatabaseGuard();
  
  // 1. Generate runId and share with workers (timestamp + random 6 char suffix)
  const runId = Date.now().toString() + '_' + Math.random().toString(36).substring(2, 8);
  currentRunId = runId;
  provide('runId', runId); // workers can use inject('runId')

  const baseSchema = `lifeloop_test_${runId}`;
  
  // 2. Connect to TEST_DATABASE_URL
  const rawConnectionString = process.env.TEST_DATABASE_URL!;
  const sql = postgres(rawConnectionString, { max: 1, onnotice: () => {} });
  
  try {
    // 3. Drop orphans older than 1 hour using exact regex
    const oneHourAgo = Date.now() - 3600000;
    const oldSchemas = await sql`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name ~ '^lifeloop_test_[0-9]+_[a-z0-9]{6}(_w[0-9]+)?$'
    `;
    
    for (const row of oldSchemas) {
      const parts = row.schema_name.split('_');
      const tsStr = parts[2]; // lifeloop_test_<ts>...
      if (tsStr && !isNaN(Number(tsStr)) && Number(tsStr) < oneHourAgo) {
        console.log(`[Vitest GlobalSetup] Dropping orphaned test schema: ${row.schema_name}`);
        await sql.unsafe(`DROP SCHEMA IF EXISTS "${row.schema_name}" CASCADE`);
      }
    }
  } catch (err) {
    console.warn("[Vitest GlobalSetup] Orphan cleanup failed:", err);
  } finally {
    await sql.end();
  }

  console.log(`[Vitest GlobalSetup] Database safety guard verified: isolated test schemas for run ${runId} will be created by workers.`);
}

import fs from 'fs';
import path from 'path';

export async function teardown() {
  if (!currentRunId) return;
  const rawConnectionString = process.env.TEST_DATABASE_URL;
  if (!rawConnectionString) return;

  const trackerFile = path.join(process.cwd(), `.run_schemas_${currentRunId}.json`);
  let exactSchemas: string[] = [];
  if (fs.existsSync(trackerFile)) {
    try {
      exactSchemas = JSON.parse(fs.readFileSync(trackerFile, 'utf8'));
    } catch {} finally {
      try {
        fs.unlinkSync(trackerFile);
      } catch {}
    }
  }
  if (exactSchemas.length === 0) {
    exactSchemas = [`lifeloop_test_${currentRunId}_w1`];
  }

  const sql = postgres(rawConnectionString, { max: 1, onnotice: () => {} });
  try {
    for (const exactSchema of exactSchemas) {
      console.log(`[Vitest GlobalTeardown] Dropping worker schema by exact name: ${exactSchema}`);
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${exactSchema}" CASCADE`);
    }
  } catch (err) {
    console.warn("[Vitest GlobalTeardown] Error dropping schemas:", err);
  } finally {
    await sql.end();
  }
}
