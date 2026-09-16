import dotenv from "dotenv";
dotenv.config();
import postgres from "postgres";

const rawConnectionString = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL!;
// Always use unpooled direct Neon connection for test schema migrations to avoid tainting the pool
const connectionString = rawConnectionString.replace("-pooler", "");

export async function setupTestSchema() {
  const sql = postgres(connectionString);

  try {
    console.log("[TestDB] Initializing isolated test schema 'lifeloop_test'...");

    // 1. Create isolated schema
    await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS lifeloop_test;`);

    // 3. Create tables in lifeloop_test
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS lifeloop_test.users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        settings JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS lifeloop_test.captures (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES lifeloop_test.users(id) ON DELETE CASCADE,
        source VARCHAR(50) NOT NULL,
        type VARCHAR(50) NOT NULL,
        raw_payload TEXT NOT NULL,
        original_filename TEXT,
        mime_type VARCHAR(100),
        processing_status VARCHAR(50) NOT NULL DEFAULT 'pending',
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS lifeloop_test.items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES lifeloop_test.users(id) ON DELETE CASCADE,
        capture_id UUID REFERENCES lifeloop_test.captures(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        item_type VARCHAR(50) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'pending_review',
        confidence_score REAL,
        due_date TIMESTAMP WITH TIME ZONE,
        snoozed_until TIMESTAMP WITH TIME ZONE,
        completed_at TIMESTAMP WITH TIME ZONE,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS lifeloop_test.reminders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES lifeloop_test.users(id) ON DELETE CASCADE,
        item_id UUID REFERENCES lifeloop_test.items(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        trigger_type VARCHAR(50) NOT NULL DEFAULT 'relative_to_deadline',
        relative_offset_days INTEGER DEFAULT 0,
        scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
        recurrence VARCHAR(50) NOT NULL DEFAULT 'none',
        channel VARCHAR(50) NOT NULL DEFAULT 'web',
        status VARCHAR(50) NOT NULL DEFAULT 'scheduled',
        sent_at TIMESTAMP WITH TIME ZONE,
        snoozed_until TIMESTAMP WITH TIME ZONE,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS lifeloop_test.item_relations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES lifeloop_test.users(id) ON DELETE CASCADE,
        source_item_id UUID NOT NULL REFERENCES lifeloop_test.items(id) ON DELETE CASCADE,
        target_item_id UUID NOT NULL REFERENCES lifeloop_test.items(id) ON DELETE CASCADE,
        relationship_type VARCHAR(100) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'pending_review',
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE(source_item_id, target_item_id, relationship_type)
      );

      CREATE TABLE IF NOT EXISTS lifeloop_test.notification_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        reminder_id UUID REFERENCES lifeloop_test.reminders(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES lifeloop_test.users(id) ON DELETE CASCADE,
        channel VARCHAR(50) NOT NULL,
        idempotency_key VARCHAR(255) NOT NULL UNIQUE,
        status VARCHAR(50) NOT NULL,
        delivered_at TIMESTAMP WITH TIME ZONE,
        payload JSONB NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS lifeloop_test.families (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        owner_id UUID NOT NULL REFERENCES lifeloop_test.users(id) ON DELETE CASCADE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS lifeloop_test.family_members (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        family_id UUID NOT NULL REFERENCES lifeloop_test.families(id) ON DELETE CASCADE,
        user_id UUID REFERENCES lifeloop_test.users(id) ON DELETE CASCADE,
        invited_email VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'member',
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        invited_by_user_id UUID REFERENCES lifeloop_test.users(id) ON DELETE SET NULL,
        invite_token TEXT UNIQUE,
        invite_expires_at TIMESTAMP WITH TIME ZONE,
        joined_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS lifeloop_test.shared_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        family_id UUID NOT NULL REFERENCES lifeloop_test.families(id) ON DELETE CASCADE,
        item_id UUID NOT NULL REFERENCES lifeloop_test.items(id) ON DELETE CASCADE,
        shared_by_user_id UUID NOT NULL REFERENCES lifeloop_test.users(id) ON DELETE CASCADE,
        category VARCHAR(100) NOT NULL,
        can_edit INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE(family_id, item_id)
      );

      CREATE TABLE IF NOT EXISTS lifeloop_test.family_notifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        family_id UUID REFERENCES lifeloop_test.families(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES lifeloop_test.users(id) ON DELETE CASCADE,
        type VARCHAR(100) NOT NULL,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        is_read INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    console.log("[TestDB] Test schema 'lifeloop_test' successfully initialized.");
  } finally {
    await sql.end();
  }
}

export async function truncateTestSchema() {
  const sql = postgres(connectionString);
  try {
    await sql.unsafe(`
      DO $$ DECLARE
        r RECORD;
      BEGIN
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'lifeloop_test') LOOP
          EXECUTE 'TRUNCATE TABLE lifeloop_test.' || quote_ident(r.tablename) || ' CASCADE';
        END LOOP;
      END $$;
    `);
    console.log("[TestDB] Test schema tables truncated.");
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
