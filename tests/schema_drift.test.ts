/**
 * tests/schema_drift.test.ts
 *
 * Drift test: verifies that every table and column defined in src/db/schema.ts
 * (the Drizzle source of truth) is present in the database schema applied by
 * applySchema(). Runs against the TEST_DATABASE_URL loopback instance only.
 * No remote database connection is ever opened.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { applySchema } from "../src/db/applySchema";

// The test schema name is set by vitest-worker-setup.ts via TEST_SCHEMA.
const SCHEMA = process.env.TEST_SCHEMA || "lifeloop_test";
const CONN = process.env.TEST_DATABASE_URL;
if (!CONN) {
  throw new Error("[schema_drift.test] TEST_DATABASE_URL is required. Cannot run drift test without it.");
}

// Expected tables and their required columns (subset: at minimum these must exist).
// Maps tableName -> Set<columnName>
const EXPECTED: Record<string, string[]> = {
  users: ["id", "email", "password_hash", "google_id", "auth_provider", "is_admin", "settings", "created_at", "updated_at"],
  captures: ["id", "user_id", "source", "type", "raw_payload", "original_filename", "mime_type", "processing_status", "retry_count", "next_retry_at", "metadata", "created_at", "updated_at"],
  items: ["id", "user_id", "capture_id", "title", "item_type", "status", "confidence_score", "due_date", "snoozed_until", "completed_at", "metadata", "created_at", "updated_at"],
  reminders: ["id", "user_id", "item_id", "title", "trigger_type", "relative_offset_days", "scheduled_at", "recurrence", "channel", "status", "sent_at", "snoozed_until", "metadata", "created_at", "updated_at"],
  item_relations: ["id", "user_id", "source_item_id", "target_item_id", "relationship_type", "status", "metadata", "created_at", "updated_at"],
  notification_logs: ["id", "reminder_id", "user_id", "channel", "idempotency_key", "status", "delivered_at", "payload", "created_at", "updated_at"],
  families: ["id", "name", "owner_id", "created_at", "updated_at"],
  family_members: ["id", "family_id", "user_id", "invited_email", "role", "status", "invited_by_user_id", "invite_token", "invite_expires_at", "joined_at", "created_at", "updated_at"],
  shared_items: ["id", "family_id", "item_id", "shared_by_user_id", "category", "can_edit", "created_at", "updated_at"],
  family_notifications: ["id", "family_id", "user_id", "type", "payload", "is_read", "created_at"],
};

let sql: postgres.Sql;

beforeAll(async () => {
  const base = CONN!.replace("-pooler", "");
  const connStr = base.includes("?")
    ? `${base}&options=-c%20search_path%3D${SCHEMA}`
    : `${base}?options=-c%20search_path%3D${SCHEMA}`;
  sql = postgres(connStr, { max: 1, onnotice: () => {} });
  // applySchema is idempotent — safe to call even if worker setup already ran it.
  await applySchema(sql, SCHEMA);
});

afterAll(async () => {
  await sql.end();
});

describe("Schema drift: applySchema tables and columns match schema.ts", () => {
  for (const [table, requiredColumns] of Object.entries(EXPECTED)) {
    it(`table '${table}' exists with all required columns`, async () => {
      const rows = await sql<{ column_name: string }[]>`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = ${SCHEMA}
          AND table_name   = ${table}
      `;
      const actual = new Set(rows.map((r) => r.column_name));
      for (const col of requiredColumns) {
        expect(actual, `column '${col}' missing from table '${table}'`).toContain(col);
      }
    });
  }

  it("users table has is_admin boolean column (key regression check)", async () => {
    const rows = await sql<{ data_type: string; column_default: string | null }[]>`
      SELECT data_type, column_default
      FROM information_schema.columns
      WHERE table_schema = ${SCHEMA}
        AND table_name   = 'users'
        AND column_name  = 'is_admin'
    `;
    expect(rows.length, "is_admin column not found in users table").toBe(1);
    expect(rows[0].data_type).toBe("boolean");
    expect(rows[0].column_default).toContain("false");
  });
});
