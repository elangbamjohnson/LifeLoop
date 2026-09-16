import { db } from "../../db";
import { items, captures, users, itemRelations } from "../../db/schema";
import { eq, and, or } from "drizzle-orm";
import { reminderService } from "./ReminderService";
import { GoogleGenAI } from "@google/genai";

export interface AIProvider {
  processCapture(captureId: string, userId: string, rawPayload: string, type: string): Promise<void>;
}

/**
 * Shared helper to save extracted items and automatically compute relation suggestions and reminders.
 */
async function saveExtractedItems(
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

    const metadataToSave = {
      ...(item.metadata || {}),
      ...(suggestedRelationTargetId ? {
        suggestedRelationTargetId,
        suggestedRelationTitle,
        relationPrompt: `This ${item.itemType} appears to belong to your ${suggestedRelationTitle}.`
      } : {})
    };

    let parsedDueDate: Date | null = null;
    if (item.dueDate) {
      parsedDueDate = item.dueDate instanceof Date ? item.dueDate : new Date(item.dueDate);
      if (isNaN(parsedDueDate.getTime())) parsedDueDate = null;
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

    // Create relative reminders if autoReminders is enabled and item has a valid dueDate
    if (autoRemindersEnabled && isHighConfidence && createdItem.dueDate) {
      await reminderService.createStandardRelativeReminders(
        createdItem.id,
        userId,
        createdItem.title,
        createdItem.dueDate,
        [-30, -7, -1, 0],
        "web",
        userTimezone
      );
    }
  }
}

/**
 * Live Google Gemini AI Provider for real natural language extraction.
 */
export class GeminiAIProvider implements AIProvider {
  private ai: GoogleGenAI;
  private mockFallback: MockAIProvider;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
    this.mockFallback = new MockAIProvider();
  }

  async processCapture(captureId: string, userId: string, rawPayload: string, type: string): Promise<void> {
    // In automated tests or simulated error tests, use deterministic mock
    if (process.env.NODE_ENV === "test" || rawPayload.includes("TEST_")) {
      return this.mockFallback.processCapture(captureId, userId, rawPayload, type);
    }

    console.log(`[Gemini AI] Processing capture ${captureId} with live LLM...`);

    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const userSettings = (user?.settings as any) || {};
    const autoRemindersEnabled = userSettings.autoReminders === true;
    const userTimezone = userSettings.timezone || "UTC";

    const todayStr = new Date().toISOString().split("T")[0];

    const prompt = `You are LifeLoop, an intelligent personal life assistant.
Extract all structured actionable items, deadlines, obligations, or entities from this user capture.
Reference date: Today is ${todayStr}.

Classification Rules for itemType:
- "document": Receipts, maintenance records, service invoices, oil changes, tire rotations, warranties, registration papers, identity docs, leases. IMPORTANT: NEVER classify a maintenance receipt, service record, or repair bill as "vehicle" or "home" entity!
- "vehicle": ONLY the vehicle itself as an asset/entity (e.g. "I bought a Honda Civic", "2024 Honda Civic Sport car info").
- "home": ONLY the physical property/home itself as an asset/entity (e.g. "Moved to 123 Main St", "Purchased condo").
- "renewal": Insurance renewals, lease renewals, license renewal deadlines, subscription renewals.
- "payment": Unpaid bills, credit card statements, due payments.
- "waiting_for": Pending responses, expecting a callback or package or refund from someone.
- "appointment": Doctor visits, dentist appointments, service appointments scheduled for a specific time.
- "task": General to-dos and action items.

User input (${type}):
"${rawPayload}"

Return ONLY valid JSON adhering strictly to this schema:
{
  "items": [
    {
      "title": "Clear, concise title (e.g. Geico Car Insurance Renewal, Downtown Auto Care Oil Change, Mr. Henderson Pipe Repair)",
      "itemType": "renewal" | "payment" | "waiting_for" | "subscription" | "document" | "appointment" | "vehicle" | "home" | "task",
      "dueDate": "ISO 8601 string timestamp (e.g. 2026-10-15T09:00:00Z) or null if no deadline/due date mentioned",
      "confidenceScore": 0.95,
      "metadata": {
        "amount": 185.50 or null,
        "currency": "USD" or null,
        "vendor": "Downtown Auto Care or null",
        "service": "Oil change and tire rotation or null",
        "waitingFor": "person or company name if waiting on someone, else null",
        "policyNumber": "string or null",
        "description": "brief context"
      }
    }
  ]
}`;

    let itemsList: any[] = [];
    try {
      const response = await this.ai.models.generateContent({
        model: "gemini-3.5-flash-lite",
        contents: prompt,
        config: {
          responseMimeType: "application/json"
        }
      });

      const text = response.text;
      if (text) {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed.items) && parsed.items.length > 0) {
          itemsList = parsed.items;
        }
      }
    } catch (err: any) {
      console.error(`[Gemini AI] Live LLM extraction failed, falling back to heuristic:`, err.message || err);
    }

    if (itemsList.length === 0) {
      console.log(`[Gemini AI] No items returned by live LLM, falling back to heuristic.`);
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
  async processCapture(captureId: string, userId: string, rawPayload: string, type: string): Promise<void> {
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

    // Helper: try extracting dynamic date if present in string like "October 15, 2026"
    const parseDynamicDate = (str: string): Date | null => {
      const monthNames = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
      const regex = new RegExp(`(${monthNames}\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4})`, "i");
      const match = str.match(regex);
      if (match) {
        const d = new Date(match[1]);
        if (!isNaN(d.getTime())) return d;
      }
      return null;
    };

    // 1. Renewal / Insurance (evaluated before generic 'due')
    if (lower.includes("car insurance") || lower.includes("insurance") || lower.includes("expires") || lower.includes("renewal")) {
      const matchAmount = rawPayload.match(/(?:₹|\$|€|£)\s*([0-9,]+(?:\.[0-9]{2})?)/);
      const amount = matchAmount ? parseFloat(matchAmount[1].replace(/,/g, "")) : 185.50;
      const currency = rawPayload.includes("$") ? "USD" : rawPayload.includes("€") ? "EUR" : "INR";
      const dynamicDate = parseDynamicDate(rawPayload);

      parsedItems.push({
        title: lower.includes("geico") ? "Geico Car Insurance Renewal" : "Car Insurance",
        itemType: "renewal",
        dueDate: dynamicDate || new Date("2026-10-15T09:00:00Z"),
        confidenceScore: 0.95,
        metadata: {
          object: "car insurance",
          amount,
          currency,
          policyNumber: rawPayload.match(/#?([A-Z0-9-]{6,})/)?.[1] || "GK-982341",
          description: rawPayload
        }
      });
    }
    // 2. Electricity bill / Generic Payment
    else if (lower.includes("electricity bill") || lower.includes("bill") || lower.includes("due")) {
      const matchAmount = rawPayload.match(/(?:₹|\$|€|£)\s*([0-9,]+(?:\.[0-9]{2})?)/);
      const amount = matchAmount ? parseFloat(matchAmount[1].replace(/,/g, "")) : 2840;
      const currency = rawPayload.includes("$") ? "USD" : rawPayload.includes("€") ? "EUR" : "INR";
      const dynamicDate = parseDynamicDate(rawPayload);
      
      parsedItems.push({
        title: "Electricity bill",
        itemType: "payment",
        dueDate: dynamicDate || new Date("2026-09-18T09:00:00Z"),
        confidenceScore: 0.95,
        metadata: {
          amount,
          currency,
          dueDate: dynamicDate ? dynamicDate.toISOString().split("T")[0] : "2026-09-18",
          description: "Electricity bill",
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
    // 4. Entity Vehicle
    else if (lower.includes("bought a") || lower.includes("vehicle") || lower.includes("car")) {
      parsedItems.push({
        title: rawPayload.replace(/i just bought a/i, "").trim() || "Vehicle",
        itemType: "vehicle",
        confidenceScore: 0.95,
        metadata: { keywords: ["car", "vehicle"] }
      });
    }
    // 5. Entity Home
    else if (lower.includes("moved to") || lower.includes("home") || lower.includes("st")) {
      parsedItems.push({
        title: rawPayload.replace(/moved to/i, "").trim() || "Home",
        itemType: "home",
        confidenceScore: 0.95,
        metadata: { keywords: ["home", "apartment", "house"] }
      });
    }
    // 6. Waiting For
    else if (lower.includes("waiting") || lower.includes("wait") || lower.includes("reply") || lower.includes("hearing back")) {
      let person = "Contact";
      if (lower.includes("landlord")) person = "Landlord";
      else if (lower.includes("bob")) person = "Bob";
      else if (lower.includes("alice")) person = "Alice";
      else if (lower.includes("doctor")) person = "Doctor";

      let organization = undefined;
      if (lower.includes("amazon")) organization = "Amazon";
      else if (lower.includes("apple")) organization = "Apple";

      let title = "Waiting for response";
      if (lower.includes("landlord")) title = "Waiting on Landlord for pipe repair";
      else if (lower.includes("refund")) title = "Waiting for Refund";

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
    // 9. Reminder
    else if (lower.includes("remind me")) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);

      parsedItems.push({
        title: rawPayload.replace(/remind me to/i, "").trim() || "Reminder",
        itemType: "reminder",
        dueDate: tomorrow,
        confidenceScore: 0.90,
        metadata: {
          trigger: "tomorrow at 9am",
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

export const aiProvider: AIProvider = process.env.GEMINI_API_KEY
  ? new GeminiAIProvider(process.env.GEMINI_API_KEY)
  : new MockAIProvider();
