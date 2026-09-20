import dotenv from "dotenv";
if (process.env.NODE_ENV === "test") {
  dotenv.config({ path: ".env.test", quiet: true });
  delete process.env.DATABASE_URL;
} else {
  dotenv.config({ quiet: true });
}
import postgres from "postgres";

const rawConnectionString = process.env.TEST_DATABASE_URL;
if (!rawConnectionString) {
  throw new Error("TEST_DATABASE_URL is required for test migrations. DATABASE_URL fallback is strictly forbidden.");
}
const connectionString = rawConnectionString.replace("-pooler", "");

export async function setupTestSchema(targetSchema: string = process.env.TEST_SCHEMA || "lifeloop_test") {
  const sql = postgres(connectionString, { onnotice: () => {} });

  try {
    console.log(`[TestDB] Initializing isolated test schema '${targetSchema}'...`);

    // 1. Create isolated schema
    await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS ${targetSchema};`);

    // 3. Create tables in targetSchema
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS ${targetSchema}.users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        settings JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS ${targetSchema}.captures (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES ${targetSchema}.users(id) ON DELETE CASCADE,
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

      CREATE TABLE IF NOT EXISTS ${targetSchema}.items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES ${targetSchema}.users(id) ON DELETE CASCADE,
        capture_id UUID REFERENCES ${targetSchema}.captures(id) ON DELETE CASCADE,
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

      CREATE TABLE IF NOT EXISTS ${targetSchema}.reminders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES ${targetSchema}.users(id) ON DELETE CASCADE,
        item_id UUID REFERENCES ${targetSchema}.items(id) ON DELETE CASCADE,
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

      CREATE TABLE IF NOT EXISTS ${targetSchema}.item_relations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES ${targetSchema}.users(id) ON DELETE CASCADE,
        source_item_id UUID NOT NULL REFERENCES ${targetSchema}.items(id) ON DELETE CASCADE,
        target_item_id UUID NOT NULL REFERENCES ${targetSchema}.items(id) ON DELETE CASCADE,
        relationship_type VARCHAR(100) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'pending_review',
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE(source_item_id, target_item_id, relationship_type)
      );

      CREATE TABLE IF NOT EXISTS ${targetSchema}.notification_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        reminder_id UUID REFERENCES ${targetSchema}.reminders(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES ${targetSchema}.users(id) ON DELETE CASCADE,
        channel VARCHAR(50) NOT NULL,
        idempotency_key VARCHAR(255) NOT NULL UNIQUE,
        status VARCHAR(50) NOT NULL,
        delivered_at TIMESTAMP WITH TIME ZONE,
        payload JSONB NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS ${targetSchema}.families (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        owner_id UUID NOT NULL REFERENCES ${targetSchema}.users(id) ON DELETE CASCADE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS ${targetSchema}.family_members (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        family_id UUID NOT NULL REFERENCES ${targetSchema}.families(id) ON DELETE CASCADE,
        user_id UUID REFERENCES ${targetSchema}.users(id) ON DELETE CASCADE,
        invited_email VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'member',
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        invited_by_user_id UUID REFERENCES ${targetSchema}.users(id) ON DELETE SET NULL,
        invite_token TEXT UNIQUE,
        invite_expires_at TIMESTAMP WITH TIME ZONE,
        joined_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS ${targetSchema}.shared_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        family_id UUID NOT NULL REFERENCES ${targetSchema}.families(id) ON DELETE CASCADE,
        item_id UUID NOT NULL REFERENCES ${targetSchema}.items(id) ON DELETE CASCADE,
        shared_by_user_id UUID NOT NULL REFERENCES ${targetSchema}.users(id) ON DELETE CASCADE,
        category VARCHAR(100) NOT NULL,
        can_edit INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE(family_id, item_id)
      );

      CREATE TABLE IF NOT EXISTS ${targetSchema}.family_notifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        family_id UUID REFERENCES ${targetSchema}.families(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES ${targetSchema}.users(id) ON DELETE CASCADE,
        type VARCHAR(100) NOT NULL,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        is_read INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    console.log(`[TestDB] Test schema '${targetSchema}' successfully initialized.`);
  } finally {
    await sql.end();
  }
}

export async function truncateTestSchema(targetSchema: string = process.env.TEST_SCHEMA || "lifeloop_test") {
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
