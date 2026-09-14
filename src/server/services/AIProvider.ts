import { db } from "../../db";
import { items, captures, users } from "../../db/schema";
import { eq, and, or } from "drizzle-orm";
import { reminderService } from "./ReminderService";

export interface AIProvider {
  processCapture(captureId: string, userId: string, rawPayload: string, type: string): Promise<void>;
}

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
    
    // 1. Payment
    if (lower.includes("electricity bill") || lower.includes("bill") || lower.includes("due")) {
      const matchAmount = rawPayload.match(/(?:₹|\$|€|£)\s*([0-9,]+(?:\.[0-9]{2})?)/);
      const amount = matchAmount ? parseFloat(matchAmount[1].replace(/,/g, "")) : 2840;
      const currency = rawPayload.includes("$") ? "USD" : rawPayload.includes("€") ? "EUR" : "INR";
      
      parsedItems.push({
        title: "Electricity bill",
        itemType: "payment",
        dueDate: new Date("2026-09-18T09:00:00Z"),
        confidenceScore: 0.95,
        metadata: {
          amount,
          currency,
          dueDate: "2026-09-18",
          description: "Electricity bill",
        }
      });
    } 
    // 2. Renewal
    else if (lower.includes("car insurance") || lower.includes("insurance") || lower.includes("expires")) {
      parsedItems.push({
        title: "Car insurance",
        itemType: "renewal",
        dueDate: new Date("2027-03-21T09:00:00Z"),
        confidenceScore: 0.92,
        metadata: {
          object: "car insurance",
          expiryDate: "2027-03-21",
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
    // New: Entity Vehicle
    else if (lower.includes("bought a") || lower.includes("vehicle") || lower.includes("car")) {
       parsedItems.push({
          title: rawPayload.replace(/i just bought a/i, "").trim() || "Vehicle",
          itemType: "vehicle",
          confidenceScore: 0.95,
          metadata: { keywords: ["car", "vehicle"] }
       });
    }
    // New: Entity Home
    else if (lower.includes("moved to") || lower.includes("home") || lower.includes("st")) {
       parsedItems.push({
          title: rawPayload.replace(/we moved to/i, "").trim() || "Home",
          itemType: "home",
          confidenceScore: 0.95,
          metadata: { keywords: ["house", "apartment"] }
       });
    }
    // 4. Appointment
    else if (lower.includes("dentist") || lower.includes("doctor") || lower.includes("appointment")) {
      const appointmentDate = new Date();
      appointmentDate.setDate(appointmentDate.getDate() + 3);
      appointmentDate.setHours(15, 0, 0, 0);

      parsedItems.push({
        title: "Dentist appointment",
        itemType: "appointment",
        dueDate: appointmentDate,
        confidenceScore: 0.88,
        metadata: {
          location: "Downtown Dental Clinic",
          doctor: "Dr. Miller",
        }
      });
    }
    // 5. Warranty
    else if (lower.includes("warranty")) {
      parsedItems.push({
        title: "MacBook Warranty",
        itemType: "warranty",
        dueDate: new Date("2027-12-15T00:00:00Z"),
        confidenceScore: 0.89,
        metadata: {
          product: "MacBook Pro",
          warrantyYears: 3,
        }
      });
    }
    // 6. Waiting-for candidate
    else if (lower.includes("waiting for") || lower.includes("waiting on") || lower.includes("pending reply") || lower.includes("quote") || lower.includes("refund")) {
      let person = "Someone";
      let organization = "";
      let title = rawPayload.replace(/waiting (?:for|on)\s+/i, "").trim() || "Pending Item";
      
      const targetMatch = rawPayload.match(/waiting (?:for|on) ([a-zA-Z\s]+?)(?: to|\.|\,|$)/i);
      if (targetMatch) {
        person = targetMatch[1].trim();
        title = rawPayload.replace(targetMatch[0], "").trim() || "Reply / Action";
      }

      parsedItems.push({
        title: title.length > 50 ? title.substring(0, 50) + "..." : title,
        itemType: "waiting_for",
        confidenceScore: autoRemindersEnabled ? 0.85 : 0.75, // Force confirmation if not auto-enabled
        dueDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // Default expected in 5 days
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
        confidenceScore: 0.35, // Low confidence -> triggers review screen
        metadata: {}
      });
    } 
    // 11. Generic fallback
    else {
      parsedItems.push({
        title: rawPayload.substring(0, 50),
        itemType: "task",
        confidenceScore: 0.65, // Demands user confirmation
        metadata: {}
      });
    }
    
    // Extract relations based on context (Phase 6)
    // We will query existing user entities to see if we should suggest a relation.
    const userEntities = await db.select().from(items).where(
      and(
        eq(items.userId, userId),
        or(eq(items.itemType, "vehicle"), eq(items.itemType, "home"), eq(items.itemType, "person"), eq(items.itemType, "subscription"))
      )
    ).limit(50);

    // Insert extracted items into DB
    for (const item of parsedItems) {
      const isHighConfidence = item.confidenceScore >= 0.8;
      const status = isHighConfidence ? "active" : "pending_review";

      // AI Relation Suggestion Logic
      let suggestedRelationTargetId = null;
      let suggestedRelationTitle = null;
      
      for (const entity of userEntities) {
         if (lower.includes(entity.title.toLowerCase()) || (entity.metadata as any)?.keywords?.some((k: string) => lower.includes(k))) {
            suggestedRelationTargetId = entity.id;
            suggestedRelationTitle = entity.title;
            break;
         }
      }

      const metadataToSave = {
        ...item.metadata || {},
        ...(suggestedRelationTargetId ? { 
           suggestedRelationTargetId, 
           suggestedRelationTitle,
           relationPrompt: `This ${item.itemType} appears to belong to your ${suggestedRelationTitle}.`
        } : {})
      };

      const [createdItem] = await db.insert(items).values({
        userId,
        captureId,
        title: item.title,
        itemType: item.itemType,
        dueDate: item.dueDate || null,
        confidenceScore: item.confidenceScore,
        metadata: metadataToSave,
        status,
      }).returning();

      // STRICT RULE: Do not create reminders automatically unless the user has explicitly enabled automatic reminders
      if (autoRemindersEnabled && isHighConfidence && item.dueDate) {
        await reminderService.createStandardRelativeReminders(
          createdItem.id,
          userId,
          createdItem.title,
          item.dueDate,
          [-30, -7, -1, 0],
          "web",
          userTimezone
        );
      }
    }

    console.log(`[AI MOCK] Finished processing capture ${captureId}`);
  }
}

export const aiProvider = new MockAIProvider();

