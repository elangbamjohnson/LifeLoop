/**
 * src/db/applySchema.ts
 *
 * Shared DDL: creates (or ensures) all LifeLoop tables in the given PostgreSQL
 * schema. Used by both the test migration path (any isolated schema) and the
 * dev migration script (public schema of a local database).
 *
 * This module does NOT read DATABASE_URL or TEST_DATABASE_URL. The caller
 * must supply the already-validated connection string via the `sql` parameter.
 */
import postgres from "postgres";

/**
 * Applies the full LifeLoop schema DDL to `targetSchema` using the provided
 * postgres.js client. Idempotent — uses CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
 *
 * @param sql          An already-connected postgres.js client.
 * @param targetSchema The Postgres schema name to create tables in.
 */
export async function applySchema(sql: postgres.Sql, targetSchema: string): Promise<void> {
  console.log(`[DB:applySchema] Initializing schema '${targetSchema}'...`);

  await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS ${targetSchema};`);

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ${targetSchema}.users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash TEXT,
      google_id TEXT,
      auth_provider VARCHAR(50) NOT NULL DEFAULT 'local',
      is_admin BOOLEAN NOT NULL DEFAULT false,
      settings JSONB DEFAULT '{}'::jsonb,
      email_verified_at TIMESTAMP WITH TIME ZONE,
      account_status VARCHAR(50) NOT NULL DEFAULT 'pending_verification',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    ALTER TABLE ${targetSchema}.users ALTER COLUMN password_hash DROP NOT NULL;
    ALTER TABLE ${targetSchema}.users ADD COLUMN IF NOT EXISTS google_id TEXT;
    ALTER TABLE ${targetSchema}.users ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(50) NOT NULL DEFAULT 'local';
    CREATE UNIQUE INDEX IF NOT EXISTS users_google_id_idx ON ${targetSchema}.users(google_id);
    ALTER TABLE ${targetSchema}.users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE ${targetSchema}.users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP WITH TIME ZONE;
    ALTER TABLE ${targetSchema}.users ADD COLUMN IF NOT EXISTS account_status VARCHAR(50) NOT NULL DEFAULT 'pending_verification';

    ${process.env.NODE_ENV === 'test' ? `ALTER TABLE ${targetSchema}.users ALTER COLUMN account_status SET DEFAULT 'active';` : ''}

    CREATE TABLE IF NOT EXISTS ${targetSchema}.email_verification_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES ${targetSchema}.users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      used_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS evt_user_id_idx ON ${targetSchema}.email_verification_tokens(user_id);
    CREATE INDEX IF NOT EXISTS evt_token_hash_idx ON ${targetSchema}.email_verification_tokens(token_hash);


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

  console.log(`[DB:applySchema] Schema '${targetSchema}' ready.`);
}
