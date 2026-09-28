import { db } from "../../db";
import { items, captures, users, itemRelations } from "../../db/schema";
import { eq, and, or } from "drizzle-orm";
import { reminderService } from "./ReminderService";
import { GoogleGenAI } from "@google/genai";

export interface AIProvider {
  processCapture(captureId: string, userId: string, rawPayload: string, type: string, clientTimezone?: string): Promise<void>;
}

/**
 * Shared helper to save extracted items and automatically compute relation suggestions and reminders.
 */
export async function saveExtractedItems(
  userId: string,
  captureId: string,
  parsedItems: any[],
  rawPayload: string,
  autoRemindersEnabled: boolean,
  userTimezone: string
): Promise<void> {
  const lower = rawPayload.toLowerCase();

  // Query existing user entities for relation suggestions (Phase 6)
  const userEntities = await db.select().from(items).where(
    and(
      eq(items.userId, userId),
      or(
        eq(items.itemType, "vehicle"),
        eq(items.itemType, "home"),
        eq(items.itemType, "person"),
        eq(items.itemType, "subscription")
      )
    )
  ).limit(50);

  for (const item of parsedItems) {
    const isHighConfidence = (item.confidenceScore ?? 0.7) >= 0.8;
    const status = isHighConfidence ? "active" : "pending_review";

    // AI Relation Suggestion Logic
    let suggestedRelationTargetId: string | null = null;
    let suggestedRelationTitle: string | null = null;

    for (const entity of userEntities) {
      if (entity.id === item.id) continue;
      const entityTitleLower = entity.title.toLowerCase();
      const meta = (entity.metadata as any) || {};
      const make = (meta.make || "").toLowerCase();
      const model = (meta.model || "").toLowerCase();
      const keywords: string[] = meta.keywords || [];

      // 1. Full title substring
      let matched = lower.includes(entityTitleLower) || entityTitleLower.includes(lower);

      // 2. Token / word matching (e.g. "honda civic" in "Honda Civic Sport Vehicle Information")
      if (!matched) {
        const stopWords = new Set([
          "the", "a", "an", "for", "in", "on", "my", "of", "and", "vehicle", "information",
          "record", "details", "info", "entity", "sport", "sedan", "suv", "car", "edition"
        ]);
        const tokens = entityTitleLower
          .split(/[\s,._-]+/)
          .filter((w: string) => w.length > 2 && !stopWords.has(w));
        
        if (tokens.length > 0) {
          const matchedCount = tokens.filter((t: string) => lower.includes(t)).length;
          if (tokens.length <= 2 && matchedCount === tokens.length) matched = true;
          else if (tokens.length > 2 && matchedCount >= 2) matched = true;
        }
      }

      // 3. Make and model matching
      if (!matched && make && lower.includes(make)) {
        if (!model || lower.includes(model.split(" ")[0])) {
          matched = true;
        }
      }

      // 4. Custom keywords matching
      if (!matched && keywords.some((k: string) => k.length > 2 && lower.includes(k.toLowerCase()))) {
        matched = true;
      }

      if (matched) {
        suggestedRelationTargetId = entity.id;
        suggestedRelationTitle = entity.title;
        break;
      }
    }

    const hasExplicitTime =
      item.hasExplicitTime === true ||
      (item.metadata && item.metadata.hasExplicitTime === true);

    const metadataToSave = {
      ...(item.metadata || {}),
      hasExplicitTime,
      ...(suggestedRelationTargetId ? {
        suggestedRelationTargetId,
        suggestedRelationTitle,
        relationPrompt: `This ${item.itemType} appears to belong to your ${suggestedRelationTitle}.`
      } : {})
    };

    let parsedDueDate: Date | null = null;
    if (item.dueDate) {
      parsedDueDate = convertLocalWallClockToUTC(item.dueDate, userTimezone);
    }

    const [createdItem] = await db.insert(items).values({
      userId,
      captureId,
      title: item.title,
      itemType: item.itemType || "task",
      dueDate: parsedDueDate,
      confidenceScore: typeof item.confidenceScore === "number" ? item.confidenceScore : 0.85,
      metadata: metadataToSave,
      status,
    }).returning();

    // Automatically create relationship in itemRelations if an entity was matched
    if (suggestedRelationTargetId) {
      try {
        const relType = createdItem.itemType === "document" ? "service_record" : "belongs_to";
        await db.insert(itemRelations).values({
          userId,
          sourceItemId: createdItem.id,
          targetItemId: suggestedRelationTargetId,
          relationshipType: relType,
          status: "active",
          metadata: {
            autoDetected: true,
            targetTitle: suggestedRelationTitle,
          }
        }).onConflictDoNothing();
      } catch (relErr) {
        console.warn(`[AI Provider] Could not auto-insert relation:`, relErr);
      }
    }

    // Create reminders if autoReminders is enabled and item has a valid dueDate
    if (autoRemindersEnabled && isHighConfidence && createdItem.dueDate) {
      await reminderService.createRemindersForItem(
        createdItem.id,
        userId,
        createdItem.title,
        createdItem.dueDate,
        hasExplicitTime,
        userTimezone
      );
    }
  }
}

/**
 * Live Google Gemini AI Provider for real natural language extraction.
 */
export const GEMINI_MODEL = "gemini-3.5-flash-lite";

export function convertLocalWallClockToUTC(
  dateInput: string | Date | null | undefined,
  userTimezone: string = "UTC"
): Date | null {
  if (!dateInput) return null;
  if (dateInput instanceof Date) {
    if (isNaN(dateInput.getTime())) return null;
    return dateInput;
  }

  const str = String(dateInput).trim();
  if (!str) return null;

  // Match YYYY-MM-DD and optional THH:mm[:ss]
  // Note: we intentionally disregard any trailing timezone offset or 'Z' returned by the model
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) {
    const fallback = new Date(str);
    return isNaN(fallback.getTime()) ? null : fallback;
  }

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  const hour = match[4] !== undefined ? parseInt(match[4], 10) : 9;
  const minute = match[5] !== undefined ? parseInt(match[5], 10) : 0;
  const second = match[6] !== undefined ? parseInt(match[6], 10) : 0;

  const wallUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const wallDate = new Date(wallUtc);

  // Compute offset between wall clock in userTimezone and UTC
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: userTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
  }).formatToParts(wallDate);

  let tzYear = year, tzMonth = month, tzDay = day, tzHour = hour, tzMin = minute, tzSec = second;
  for (const p of parts) {
    if (p.type === "year") tzYear = parseInt(p.value, 10);
    if (p.type === "month") tzMonth = parseInt(p.value, 10);
    if (p.type === "day") tzDay = parseInt(p.value, 10);
    if (p.type === "hour") tzHour = parseInt(p.value, 10);
    if (p.type === "minute") tzMin = parseInt(p.value, 10);
    if (p.type === "second") tzSec = parseInt(p.value, 10);
  }
  if (tzHour === 24) tzHour = 0;

  const asInTz = Date.UTC(tzYear, tzMonth - 1, tzDay, tzHour, tzMin, tzSec);
  const offsetMs = asInTz - wallUtc;

  return new Date(wallUtc - offsetMs);
}

export function buildExtractionPrompt(
  rawPayload: string,
  type: string = "text",
  userTimezone: string = "UTC",
  now: Date = new Date()
): string {
  const currentTimeStr = now.toLocaleString("en-US", { timeZone: userTimezone, timeZoneName: "shortOffset" });

  return `You are LifeLoop, an intelligent personal life assistant.
Extract all structured actionable items, deadlines, obligations, or entities from this user capture.
User's Timezone: ${userTimezone}
Current Date and Time: ${currentTimeStr} (Assume this is "now" when interpreting relative times like "today", "tomorrow", or "at 7pm").

Classification Rules for itemType:
- "document": Receipts, maintenance records, service invoices, oil changes, tire rotations, warranties, registration papers, identity docs, leases. IMPORTANT: NEVER classify a maintenance receipt, service record, or repair bill as "vehicle" or "home" entity!
- "vehicle": ONLY the vehicle itself as an asset/entity (e.g. "I bought a Honda Civic", "2024 Honda Civic Sport car info").
- "home": ONLY the physical property/home itself as an asset/entity (e.g. "Moved to 123 Main St", "Purchased condo").
- "renewal": Insurance renewals, lease renewals, license renewal deadlines, subscription renewals.
- "payment": Unpaid bills, credit card statements, due payments.
- "waiting_for": Pending responses, expecting a callback or package or refund from someone.
- "appointment": Doctor visits, dentist appointments, service appointments scheduled for a specific time.
- "task": General to-dos and action items.

Deadline & Time Rules:
- Return all dates and times as LOCAL wall-clock time in the user's timezone formatted as "YYYY-MM-DDTHH:mm:ss" (without timezone offset or 'Z').
- Do NOT convert to UTC or append timezone offsets (do NOT return +05:30 or -04:00 or Z). The server converts local wall-clock time to UTC in code using the user's timezone.
- For date-only deadlines without an explicit clock time (e.g. "on Oct 5", "due next Friday", "due the 18th", "by end of month", "March 2027", "Meeting with Henderson tomorrow"), set the time component to 09:00:00 local time ("YYYY-MM-DDT09:00:00").
- If a day-of-month is specified without a month (e.g. "due the 18th", "pay on the 5th") and that day has already passed in the current month relative to Current Date and Time, roll to that day in the NEXT month (e.g. if Current Date is September 28, "due the 18th" is October 18).
- "hasExplicitTime": boolean; true ONLY if the user stated an explicit clock time or relative duration ("at 4:30 pm", "in 2 minutes", "tomorrow 10 am", "Gym at 6"); false for date-only ("on Oct 5", "next Friday", "the 18th", "by end of month", "March 2027", "Meeting with Henderson tomorrow"); false when unsure.

User input (${type}):
"${rawPayload}"

Return ONLY valid JSON adhering strictly to this schema:
{
  "items": [
    {
      "title": "Clear, concise title (e.g. Geico Car Insurance Renewal, Downtown Auto Care Oil Change, Mr. Henderson Pipe Repair)",
      "itemType": "renewal" | "payment" | "waiting_for" | "subscription" | "document" | "appointment" | "vehicle" | "home" | "task",
      "dueDate": "Local wall-clock ISO string formatted as YYYY-MM-DDTHH:mm:ss (e.g. 2026-10-18T09:00:00 for date-only at 09:00:00 local time, or exact local time like 2026-10-05T16:30:00 when clock time is specified, NO timezone offset or Z) or null if no deadline",
      "hasExplicitTime": false,
      "confidenceScore": 0.95,
      "metadata": {
        "amount": 185.50 or null,
        "currency": "USD" or "INR" or null,
        "vendor": "Downtown Auto Care or null",
        "service": "Oil change and tire rotation or null",
        "waitingFor": "person or company name if waiting on someone, else null",
        "policyNumber": "string or null",
        "description": "brief context"
      }
    }
  ]
}`;
}

export class GeminiAIProvider implements AIProvider {
  private ai: GoogleGenAI;
  private mockFallback: MockAIProvider;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
    this.mockFallback = new MockAIProvider();
  }

  async processCapture(captureId: string, userId: string, rawPayload: string, type: string, clientTimezone?: string): Promise<void> {
    // In automated tests or simulated error tests, use deterministic mock
    if (process.env.NODE_ENV === "test" || rawPayload.includes("TEST_")) {
      return this.mockFallback.processCapture(captureId, userId, rawPayload, type, clientTimezone);
    }

    console.log(`[Gemini AI] Processing capture ${captureId} with live LLM...`);

    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const userSettings = (user?.settings as any) || {};
    const autoRemindersEnabled = userSettings.autoReminders === true;
    const userTimezone = clientTimezone || userSettings.timezone || "UTC";

    const now = new Date();
    const prompt = buildExtractionPrompt(rawPayload, type, userTimezone, now);

    let itemsList: any[] = [];
    try {
      const response = await this.ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          responseMimeType: "application/json"
        }
      });

      const text = response.text;
      console.log(`[RAW MODEL RESPONSE for "${rawPayload}"]: ${text}`);
      if (text) {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed.items) && parsed.items.length > 0) {
          itemsList = parsed.items;
        }
      }
    } catch (err: any) {
      console.error(`[Gemini AI] Live LLM extraction failed:`, err.message || err);
      if (process.env.NODE_ENV === "production") {
        throw new Error(`[Gemini AI] Live LLM extraction failed in production: ${err.message || err}`);
      }
    }

    if (itemsList.length === 0) {
      if (process.env.NODE_ENV === "production") {
        console.warn(`[Gemini AI] No items returned by live LLM for capture ${captureId}.`);
        return;
      }
      console.warn(`[Gemini AI] Live LLM returned no items. Falling back to heuristic mock extraction with explicit warning.`);
      return this.mockFallback.processCapture(captureId, userId, rawPayload, type);
    }

    await saveExtractedItems(userId, captureId, itemsList, rawPayload, autoRemindersEnabled, userTimezone);
    console.log(`[Gemini AI] Successfully processed capture ${captureId} into ${itemsList.length} items.`);
  }
}

/**
 * Deterministic Mock AI Provider for offline development and automated CI suites.
 */
export class MockAIProvider implements AIProvider {
  async processCapture(captureId: string, userId: string, rawPayload: string, type: string, clientTimezone?: string): Promise<void> {
    console.log(`[AI MOCK] Processing capture ${captureId}...`);
    
    // Simulate latency
    await new Promise(resolve => setTimeout(resolve, 800));
    
    const lower = rawPayload.toLowerCase();
    const parsedItems: any[] = [];

    // Check user preferences for auto-reminders
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const userSettings = (user?.settings as any) || {};
    const autoRemindersEnabled = userSettings.autoReminders === true;
    const userTimezone = userSettings.timezone || "UTC";

    // TEST SCENARIOS (Deterministic Invalid States)
    if (rawPayload.includes("TEST_PROVIDER_ERROR")) {
      throw new Error("Simulated Provider Error");
    }
    if (rawPayload.includes("TEST_TIMEOUT")) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      throw new Error("Simulated Provider Timeout");
    }
    if (rawPayload.includes("TEST_MALFORMED_JSON")) {
      JSON.parse("{ malformed: json ");
    }
    if (rawPayload.includes("TEST_NULL_RESPONSE")) {
      console.log(`[AI MOCK] Empty response for capture ${captureId}`);
      return;
    }

    // Helper: try extracting dynamic date and/or time from string
    const parseDynamicDateTime = (str: string): { dueDate: Date | null; hasExplicitTime: boolean } => {
      const lowerStr = str.toLowerCase();

      // 1. Relative time like "in 2 minutes", "in 5 mins", "in 1 hour"
      const relativeMatch = lowerStr.match(/\bin\s+(\d+)\s*(minute|min|hour|hr|second|sec)s?\b/i);
      if (relativeMatch) {
        const val = parseInt(relativeMatch[1], 10);
        const unit = relativeMatch[2].toLowerCase();
        const multiplier = unit.startsWith("h") ? 3600000 : unit.startsWith("s") ? 1000 : 60000;
        return {
          dueDate: new Date(Date.now() + val * multiplier),
          hasExplicitTime: true,
        };
      }

      // 2. Explicit clock time like "at 4:30 pm", "at 4:30", "at 16:30", "4:30 pm"
      const timeMatch = lowerStr.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i) ||
                         lowerStr.match(/\bat\s+(\d{1,2}):(\d{2})\b/i);

      // Check if a calendar date is also mentioned (e.g. "Oct 5", "October 15, 2026")
      const monthNames = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
      const dateRegex = new RegExp(`(${monthNames}\\s+\\d{1,2}(?:st|nd|rd|th)?,?(?:\\s+\\d{4})?)`, "i");
      const dateMatch = str.match(dateRegex);

      if (timeMatch) {
        let hours = parseInt(timeMatch[1], 10);
        const minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
        const meridian = timeMatch[3]?.toLowerCase();

        if (meridian === "pm" && hours < 12) hours += 12;
        if (meridian === "am" && hours === 12) hours = 0;

        let targetDate: Date;
        if (dateMatch) {
          const year = dateMatch[1].match(/\d{4}/) ? "" : ` ${new Date().getFullYear()}`;
          targetDate = new Date(`${dateMatch[1]}${year}`);
        } else {
          targetDate = new Date();
        }
        targetDate.setHours(hours, minutes, 0, 0);
        return {
          dueDate: targetDate,
          hasExplicitTime: true,
        };
      }

      if (dateMatch) {
        const year = dateMatch[1].match(/\d{4}/) ? "" : ` ${new Date().getFullYear()}`;
        const d = new Date(`${dateMatch[1]}${year}`);
        if (!isNaN(d.getTime())) {
          return {
            dueDate: d,
            hasExplicitTime: false,
          };
        }
      }

      return { dueDate: null, hasExplicitTime: false };
    };

    // 1. Renewal / Insurance (evaluated before generic 'due')
    if (lower.includes("car insurance") || lower.includes("insurance") || lower.includes("expires") || lower.includes("renewal")) {
      const matchAmount = rawPayload.match(/(?:₹|\$|€|£)\s*([0-9,]+(?:\.[0-9]{2})?)/);
      const amount = matchAmount ? parseFloat(matchAmount[1].replace(/,/g, "")) : 185.50;
      const currency = rawPayload.includes("$") ? "USD" : rawPayload.includes("€") ? "EUR" : "INR";
      const dt = parseDynamicDateTime(rawPayload);
      const dynamicDate = dt.dueDate;

      parsedItems.push({
        title: lower.includes("geico") ? "Geico Car Insurance Renewal" : "Car Insurance",
        itemType: "renewal",
        dueDate: dynamicDate || new Date("2026-10-15T09:00:00Z"),
        hasExplicitTime: dt.hasExplicitTime,
        confidenceScore: 0.95,
        metadata: {
          object: "car insurance",
          amount,
          currency,
          policyNumber: rawPayload.match(/#?([A-Z0-9-]{6,})/)?.[1] || "GK-982341",
          description: rawPayload,
          hasExplicitTime: dt.hasExplicitTime,
        }
      });
    }
    // 2. Electricity bill / Generic Payment
    else if (lower.includes("electricity bill") || lower.includes("bill") || lower.includes("due")) {
      const matchAmount = rawPayload.match(/(?:₹|\$|€|£)\s*([0-9,]+(?:\.[0-9]{2})?)/);
      const amount = matchAmount ? parseFloat(matchAmount[1].replace(/,/g, "")) : 2840;
      const currency = rawPayload.includes("$") ? "USD" : rawPayload.includes("€") ? "EUR" : "INR";
      const dt = parseDynamicDateTime(rawPayload);
      const dynamicDate = dt.dueDate;
      
      parsedItems.push({
        title: "Electricity bill",
        itemType: "payment",
        dueDate: dynamicDate || new Date("2026-09-18T09:00:00Z"),
        hasExplicitTime: dt.hasExplicitTime,
        confidenceScore: 0.95,
        metadata: {
          amount,
          currency,
          dueDate: dynamicDate ? dynamicDate.toISOString().split("T")[0] : "2026-09-18",
          description: "Electricity bill",
          hasExplicitTime: dt.hasExplicitTime,
        }
      });
    } 
    // 3. Subscription
    else if (lower.includes("netflix") || lower.includes("subscription")) {
      parsedItems.push({
        title: "Netflix subscription",
        itemType: "subscription",
        dueDate: new Date("2026-10-12T09:00:00Z"),
        confidenceScore: 0.90,
        metadata: {
          amount: 649,
          currency: "INR",
          renewalFrequency: "monthly",
        }
      });
    }
    // 3b. Maintenance / Service Receipt / Document
    else if (lower.includes("receipt") || lower.includes("oil change") || lower.includes("tire rotation") || lower.includes("maintenance") || lower.includes("servicing")) {
      const matchAmount = rawPayload.match(/(?:₹|\$|€|£)\s*([0-9,]+(?:\.[0-9]{2})?)/);
      const amount = matchAmount ? parseFloat(matchAmount[1].replace(/,/g, "")) : 75;
      const currency = rawPayload.includes("$") ? "USD" : rawPayload.includes("€") ? "EUR" : "INR";
      parsedItems.push({
        title: rawPayload.length > 60 ? rawPayload.substring(0, 60) + "..." : rawPayload,
        itemType: "document",
        confidenceScore: 0.95,
        metadata: {
          vendor: lower.includes("downtown auto care") ? "Downtown Auto Care" : "Service Center",
          amount,
          currency,
          description: rawPayload,
        }
      });
    }
    // 4. Waiting For
    else if (lower.includes("waiting") || lower.includes("wait") || lower.includes("reply") || lower.includes("hearing back")) {
      let person = "Contact";
      let organization: string | undefined = undefined;
      let title = "Waiting for response";

      // Generic pattern: "Waiting (on|for) [Person/Org] (for|to|about) [Action/Title]"
      const waitingMatch = rawPayload.match(/waiting\s+(?:on|for)\s+([^,\n\r]+?)(?:\s+(?:for|to|about)\s+(.+))?$/i);
      if (waitingMatch) {
        person = waitingMatch[1].trim();
        if (waitingMatch[2]) {
          title = waitingMatch[2].trim();
        } else {
          title = `Waiting on ${person}`;
        }
      } else if (lower.includes("landlord")) {
        person = "Landlord";
        title = "Waiting on Landlord for pipe repair";
      } else if (lower.includes("bob")) {
        person = "Bob";
      } else if (lower.includes("alice")) {
        person = "Alice";
      } else if (lower.includes("doctor")) {
        person = "Doctor";
      } else if (lower.includes("refund")) {
        title = "Waiting for Refund";
      }

      if (lower.includes("amazon")) organization = "Amazon";
      else if (lower.includes("apple")) organization = "Apple";

      parsedItems.push({
        title: title.length > 50 ? title.substring(0, 50) + "..." : title,
        itemType: "waiting_for",
        confidenceScore: autoRemindersEnabled ? 0.85 : 0.75,
        dueDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        metadata: {
          waitingFor: person,
          person: person,
          organization: organization,
          isWaitingFor: true,
          notes: rawPayload
        }
      });
    }
    // 5. Entity Vehicle
    else if (lower.includes("bought a") || lower.includes("vehicle") || /\bcar\b/.test(lower)) {
      parsedItems.push({
        title: rawPayload.replace(/i just bought a/i, "").trim() || "Vehicle",
        itemType: "vehicle",
        confidenceScore: 0.95,
        metadata: { keywords: ["car", "vehicle"] }
      });
    }
    // 6. Entity Home
    else if (lower.includes("moved to") || lower.includes("home") || /\b(?:st|street|ave|avenue|blvd|rd|road)\b/.test(lower)) {
      parsedItems.push({
        title: rawPayload.replace(/moved to/i, "").trim() || "Home",
        itemType: "home",
        confidenceScore: 0.95,
        metadata: { keywords: ["home", "apartment", "house"] }
      });
    }
    // 7. Purchase
    else if (lower.includes("bought") || lower.includes("purchased") || lower.includes("receipt")) {
      parsedItems.push({
        title: "Online Purchase",
        itemType: "purchase",
        confidenceScore: 0.86,
        metadata: {
          vendor: "Nike Store",
          amount: 120,
          currency: "USD",
        }
      });
    }
    // 8. Document
    else if (lower.includes("passport") || lower.includes("lease") || lower.includes("document") || type === "document") {
      parsedItems.push({
        title: "Document Record",
        itemType: "document",
        confidenceScore: 0.87,
        metadata: {
          documentType: "Agreement",
        }
      });
    }
    // 9. Reminder / Explicit Time / Dynamic date-time
    else if (
      lower.includes("remind me") ||
      lower.includes("in 2 minutes") ||
      lower.includes("at 4:30") ||
      lower.includes("dentist") ||
      lower.includes("rent") ||
      parseDynamicDateTime(rawPayload).dueDate !== null
    ) {
      const dt = parseDynamicDateTime(rawPayload);
      let dueDate = dt.dueDate;
      let hasExplicitTime = dt.hasExplicitTime;

      if (!dueDate) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(9, 0, 0, 0);
        dueDate = tomorrow;
        hasExplicitTime = false;
      }

      let title = rawPayload.replace(/^remind me (?:to\s+)?/i, "").trim() || "Reminder";
      parsedItems.push({
        title: title.length > 50 ? title.substring(0, 50) + "..." : title,
        itemType: lower.includes("dentist") || lower.includes("doctor") ? "appointment" : lower.includes("rent") ? "payment" : "task",
        dueDate,
        hasExplicitTime,
        confidenceScore: 0.95,
        metadata: {
          hasExplicitTime,
        }
      });
    }
    // 10. Low-confidence ambiguity test
    else if (lower.includes("unclear garbage text")) {
      parsedItems.push({
        title: "Unresolved Note",
        itemType: "task",
        confidenceScore: 0.35,
        metadata: {}
      });
    } 
    // 11. Generic fallback
    else {
      parsedItems.push({
        title: rawPayload.substring(0, 50),
        itemType: "task",
        confidenceScore: 0.65,
        metadata: {}
      });
    }

    await saveExtractedItems(userId, captureId, parsedItems, rawPayload, autoRemindersEnabled, userTimezone);
    console.log(`[AI MOCK] Finished processing capture ${captureId}`);
  }
}

export function createAIProvider(): AIProvider {
  // Strict production safety checks at startup
  if (process.env.NODE_ENV === "production") {
    if (process.env.AI_PROVIDER === "mock") {
      throw new Error("FATAL: AI_PROVIDER cannot be set to 'mock' in production environment. Fix: Unset or remove AI_PROVIDER from production environment variables.");
    }
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("FATAL: GEMINI_API_KEY environment variable is missing in production. Fix: Set GEMINI_API_KEY in your production environment variables (e.g. export GEMINI_API_KEY=\"<your_gemini_api_key>\").");
    }
    if (process.env.DISABLE_RATE_LIMIT === "1") {
      throw new Error("FATAL: DISABLE_RATE_LIMIT cannot be set to '1' in production environment. Fix: Unset or remove DISABLE_RATE_LIMIT from production environment variables.");
    }
  }

  // Explicit mock in test or when explicitly requested in non-production
  if (process.env.AI_PROVIDER === "mock" || process.env.NODE_ENV === "test") {
    console.log("[AIProvider] Initialized MockAIProvider explicitly (AI_PROVIDER=mock or NODE_ENV=test).");
    return new MockAIProvider();
  }

  // Real Gemini AI provider when GEMINI_API_KEY is provided
  if (process.env.GEMINI_API_KEY) {
    console.log("[AIProvider] Initialized GeminiAIProvider with configured API key.");
    return new GeminiAIProvider(process.env.GEMINI_API_KEY);
  }

  // In any environment, NEVER fall back to the mock silently!
  throw new Error("FATAL: GEMINI_API_KEY environment variable is missing and AI_PROVIDER is not set to 'mock'. Fix: Provide GEMINI_API_KEY in your environment variables, or explicitly set AI_PROVIDER=mock for offline local development.");
}

export const aiProvider: AIProvider = createAIProvider();
