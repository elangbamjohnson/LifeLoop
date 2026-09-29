import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  varchar,
  integer,
  real,
  unique,
  boolean,
  index,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash"), // Nullable for Google OAuth users
  googleId: text("google_id").unique(),
  authProvider: varchar("auth_provider", { length: 50 }).default("local").notNull(), // 'local' | 'google'
  isAdmin: boolean("is_admin").notNull().default(false),
  settings: jsonb("settings").default({}),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  accountStatus: varchar("account_status", { length: 50 }).default("pending_verification").notNull(), // 'pending_verification' | 'active' | 'suspended'
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
});

export const emailVerificationTokens = pgTable("email_verification_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userIdIdx: index("evt_user_id_idx").on(t.userId),
  tokenHashIdx: index("evt_token_hash_idx").on(t.tokenHash),
}));

export const captures = pgTable("captures", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  source: varchar("source", { length: 50 }).notNull(), // web, ios, android
  type: varchar("type", { length: 50 }).notNull(), // text, image, audio, document
  rawPayload: text("raw_payload").notNull(), // text content or URL to asset
  originalFilename: text("original_filename"),
  mimeType: varchar("mime_type", { length: 100 }),
  processingStatus: varchar("processing_status", { length: 50 }).default("pending").notNull(), // pending, processing, completed, failed, fallback_pending_retry
  retryCount: integer("retry_count").default(0).notNull(),
  nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
});

export const items = pgTable("items", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  captureId: uuid("capture_id").references(() => captures.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  itemType: varchar("item_type", { length: 50 }).notNull(), // payment, task, renewal, appointment, warranty, subscription, purchase, document, waiting_for, reminder, deadline
  status: varchar("status", { length: 50 }).default("pending_review").notNull(), // pending_review, active, completed, snoozed, archived
  confidenceScore: real("confidence_score"), // number (0-1)
  dueDate: timestamp("due_date", { withTimezone: true }),
  snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  metadata: jsonb("metadata").default({}), // amounts, dates, custom fields based on type
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
});

export const reminders = pgTable("reminders", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  itemId: uuid("item_id").references(() => items.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  triggerType: varchar("trigger_type", { length: 50 }).default("relative_to_deadline").notNull(), // exact_time, relative_to_deadline
  relativeOffsetDays: integer("relative_offset_days").default(0), // -30, -7, -1, 0
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  recurrence: varchar("recurrence", { length: 50 }).default("none").notNull(), // none, daily, weekly, monthly, yearly
  channel: varchar("channel", { length: 50 }).default("web").notNull(), // web, ios, android, email
  status: varchar("status", { length: 50 }).default("scheduled").notNull(), // scheduled, sent, snoozed, dismissed, cancelled
  sentAt: timestamp("sent_at", { withTimezone: true }),
  snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
});

export const itemRelations = pgTable("item_relations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  sourceItemId: uuid("source_item_id").references(() => items.id, { onDelete: "cascade" }).notNull(),
  targetItemId: uuid("target_item_id").references(() => items.id, { onDelete: "cascade" }).notNull(),
  relationshipType: varchar("relationship_type", { length: 100 }).notNull(), // "belongs_to", "related_to"
  status: varchar("status", { length: 50 }).default("pending_review").notNull(), // pending_review, active, rejected
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => ({
  unq: unique().on(t.sourceItemId, t.targetItemId, t.relationshipType)
}));

export const notificationLogs = pgTable("notification_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  reminderId: uuid("reminder_id").references(() => reminders.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id).notNull(),
  channel: varchar("channel", { length: 50 }).notNull(), // web, ios, android, email
  idempotencyKey: varchar("idempotency_key", { length: 255 }).unique().notNull(),
  status: varchar("status", { length: 50 }).notNull(), // delivered, queued, failed
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
});

// ─── Phase 7: Family ────────────────────────────────────────────────────────

export const families = pgTable("families", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  ownerId: uuid("owner_id").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
});

export const familyMembers = pgTable("family_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  familyId: uuid("family_id").references(() => families.id, { onDelete: "cascade" }).notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }), // null until accepted
  invitedEmail: varchar("invited_email", { length: 255 }).notNull(),
  role: varchar("role", { length: 50 }).notNull().default("member"), // owner, admin, member, view_only
  status: varchar("status", { length: 50 }).notNull().default("pending"), // pending, accepted, rejected
  invitedByUserId: uuid("invited_by_user_id").references(() => users.id),
  inviteToken: text("invite_token").unique(),
  inviteExpiresAt: timestamp("invite_expires_at", { withTimezone: true }),
  joinedAt: timestamp("joined_at", { withTimezone: true }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
});

export const sharedItems = pgTable("shared_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  familyId: uuid("family_id").references(() => families.id, { onDelete: "cascade" }).notNull(),
  itemId: uuid("item_id").references(() => items.id, { onDelete: "cascade" }).notNull(),
  sharedByUserId: uuid("shared_by_user_id").references(() => users.id).notNull(),
  category: varchar("category", { length: 100 }).notNull(), // bills, school_events, appointments, shopping, documents, reminders, vehicle
  canEdit: integer("can_edit").notNull().default(0), // 0=view only, 1=can edit
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => ({
  unq: unique().on(t.familyId, t.itemId),
}));

export const familyNotifications = pgTable("family_notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  familyId: uuid("family_id").references(() => families.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  type: varchar("type", { length: 100 }).notNull(), // item_shared, member_joined, invite_received, item_updated
  payload: jsonb("payload").notNull().default({}),
  isRead: integer("is_read").notNull().default(0), // 0=unread, 1=read
  createdAt: timestamp("created_at").defaultNow().notNull(),
});


