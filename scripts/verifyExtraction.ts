import "dotenv/config";
import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("GEMINI_API_KEY not found in environment");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

const phrases = [
  "Pay rent on Oct 5",
  "Dentist Oct 5 at 4:30 pm",
  "Remind me in 2 minutes to check the oven",
  "Car insurance renewal due next Friday",
  "Call mom tomorrow at 10 am",
  "Electricity bill due the 18th",
  "Submit report by end of month",
  "Gym at 6",
  "Passport expires March 2027",
  "Meeting with Henderson tomorrow",
];

const userTimezone = "Asia/Kolkata";
const now = new Date("2026-09-28T12:00:00+05:30");
const currentTimeStr = now.toLocaleString("en-US", { timeZone: userTimezone, timeZoneName: "shortOffset" });

async function runPhrase(rawPayload: string) {
  const type = "text";
  const prompt = `You are LifeLoop, an intelligent personal life assistant.
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
- "dueDate": ISO 8601 string timestamp with user's timezone offset (+05:30) (e.g. 2026-10-15T09:00:00+05:30) or null if no deadline/due date mentioned. For date-only deadlines without an explicit clock time (e.g. "on Oct 5", "due next Friday", "due the 18th", "by end of month", "March 2027", "Meeting with Henderson tomorrow"), set the time component of dueDate to 09:00:00 in the user's timezone (+05:30). For explicit times/durations, preserve the explicit time with the +05:30 offset.
- "hasExplicitTime": boolean; true ONLY if the user stated a clock time or a relative duration ("at 4:30 pm", "in 2 minutes", "tomorrow 10 am", "Gym at 6"); false for date-only ("on Oct 5", "next Friday", "the 18th", "by end of month", "March 2027", "Meeting with Henderson tomorrow"); false when unsure.

User input (${type}):
"${rawPayload}"

Return ONLY valid JSON adhering strictly to this schema:
{
  "items": [
    {
      "title": "Clear, concise title (e.g. Geico Car Insurance Renewal, Downtown Auto Care Oil Change, Mr. Henderson Pipe Repair)",
      "itemType": "renewal" | "payment" | "waiting_for" | "subscription" | "document" | "appointment" | "vehicle" | "home" | "task",
      "dueDate": "ISO 8601 string timestamp with +05:30 timezone offset (e.g. 2026-10-05T09:00:00+05:30 for date-only at 09:00:00 local time, or exact timestamp with +05:30 when clock time is specified) or null if no deadline",
      "hasExplicitTime": false,
      "confidenceScore": 0.95,
      "metadata": {
        "amount": 185.50 or null,
        "currency": "INR" or "USD" or null,
        "vendor": "string or null",
        "service": "string or null",
        "waitingFor": "string or null",
        "policyNumber": "string or null",
        "description": "brief context"
      }
    }
  ]
}`;

  const response = await ai.models.generateContent({
    model: "gemini-3.5-flash-lite",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
    },
  });

  const parsed = JSON.parse(response.text || "{}");
  return {
    input: rawPayload,
    parsed: parsed.items?.[0] || null,
  };
}

async function main() {
  const results = [];
  for (const phrase of phrases) {
    try {
      const res = await runPhrase(phrase);
      results.push(res);
      await new Promise((r) => setTimeout(r, 600));
    } catch (e: any) {
      results.push({ input: phrase, error: e.message });
    }
  }
  console.log(JSON.stringify(results, null, 2));
}

main();
