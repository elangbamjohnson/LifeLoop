import { z } from "zod";

// Base User
export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  createdAt: z.date(),
});
export type User = z.infer<typeof UserSchema>;

// Source (Where data came from)
export const SourceSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(["web", "ios", "android", "email", "sms"]),
  metadata: z.record(z.string(), z.any()).optional(),
});
export type Source = z.infer<typeof SourceSchema>;

// Capture (Raw unparsed data)
export const CaptureSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  sourceId: z.string().uuid(),
  type: z.enum(["text", "image", "audio", "document"]),
  rawPayload: z.string(), // or URL if it's an asset
  status: z.enum(["pending", "processing", "processed", "failed"]),
  createdAt: z.date(),
});
export type Capture = z.infer<typeof CaptureSchema>;

// Base Item (Parsed/Structured data)
export const ItemSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  captureId: z.string().uuid().optional(),
  title: z.string(),
  description: z.string().optional(),
  type: z.enum(["task", "event", "bill", "note", "person", "document"]),
  status: z.enum(["active", "completed", "archived"]),
  metadata: z.record(z.string(), z.any()).optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Item = z.infer<typeof ItemSchema>;

// Specific Item Types
export const ReminderSchema = z.object({
  id: z.string().uuid(),
  itemId: z.string().uuid(),
  triggerAt: z.date(),
  isResolved: z.boolean().default(false),
});
export type Reminder = z.infer<typeof ReminderSchema>;

export const DocumentSchema = z.object({
  id: z.string().uuid(),
  itemId: z.string().uuid(),
  fileUrl: z.string().url(),
  mimeType: z.string(),
  summary: z.string().optional(),
});
export type Document = z.infer<typeof DocumentSchema>;

export const WaitingForSchema = z.object({
  id: z.string().uuid(),
  itemId: z.string().uuid(),
  personId: z.string().uuid().optional(),
  expectedDate: z.date().optional(),
  status: z.enum(["waiting", "received", "cancelled"]),
});
export type WaitingFor = z.infer<typeof WaitingForSchema>;

export const PersonSchema = z.object({
  id: z.string().uuid(),
  itemId: z.string().uuid(),
  name: z.string(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  relation: z.string().optional(),
});
export type Person = z.infer<typeof PersonSchema>;
