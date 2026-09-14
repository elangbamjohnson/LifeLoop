import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  varchar,
  integer,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  settings: jsonb("settings").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const captures = pgTable("captures", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  source: varchar("source", { length: 50 }).notNull(), // web, ios, android
  type: varchar("type", { length: 50 }).notNull(), // text, image, audio, document
  rawPayload: text("raw_payload").notNull(), // text content or URL to asset
  originalFilename: text("original_filename"),
  mimeType: varchar("mime_type", { length: 100 }),
  processingStatus: varchar("processing_status", { length: 50 }).default("pending").notNull(), // pending, processing, completed, failed
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const items = pgTable("items", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  captureId: uuid("capture_id").references(() => captures.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  itemType: varchar("item_type", { length: 50 }).notNull(), // payment, task, renewal, appointment, warranty, subscription, purchase, document, waiting_for, reminder, deadline
  status: varchar("status", { length: 50 }).default("pending_review").notNull(), // pending_review, active, completed, snoozed, archived
  confidenceScore: jsonb("confidence_score"), // number (0-1)
  dueDate: timestamp("due_date", { withTimezone: true }),
  snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  metadata: jsonb("metadata").default({}), // amounts, dates, custom fields based on type
  createdAt: timestamp("created_at").defaultNow().notNull(),
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
  status: varchar("status", { length: 50 }).default("scheduled").notNull(), // scheduled, sent, snoozed, dismissed
  sentAt: timestamp("sent_at", { withTimezone: true }),
  snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
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
});

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
});

