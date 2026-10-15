/**
 * tests/calendar.test.ts
 *
 * Unit tests for buildIcs() in src/shared/utils/calendar.ts.
 * No DOM, no fetch, no browser globals needed.
 */

import { describe, it, expect } from "vitest";
import { buildIcs } from "../src/shared/utils/calendar";
import { TimelineItem } from "../src/shared/utils/timeline";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<TimelineItem> = {}): TimelineItem {
  return {
    id: "test-id-1",
    title: "Test Event",
    itemType: "task",
    status: "active",
    dueDate: "2025-06-15T00:00:00.000Z",
    createdAt: new Date("2025-01-01T00:00:00.000Z").toISOString(),
    metadata: {},
    ...overrides,
  };
}

/** Return every CRLF-terminated unfolded logical line from an .ics string. */
function unfold(ics: string): string[] {
  // RFC 5545: continuation lines start with a single SPACE or TAB
  const unfolded = ics.replace(/\r\n[ \t]/g, "");
  return unfolded.split("\r\n").filter(Boolean);
}

function getLine(ics: string, prefix: string): string | undefined {
  return unfold(ics).find((l) => l.startsWith(prefix));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildIcs", () => {
  it("returns null when dueDate is missing", () => {
    const item = makeItem({ dueDate: null });
    expect(buildIcs(item, "America/New_York")).toBeNull();
  });

  it("returns null when dueDate is undefined", () => {
    const item = makeItem({ dueDate: undefined });
    expect(buildIcs(item, "America/New_York")).toBeNull();
  });

  it("returns null when dueDate is an invalid date string", () => {
    const item = makeItem({ dueDate: "not-a-date" });
    expect(buildIcs(item, "UTC")).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Valid calendar structure
  // -----------------------------------------------------------------------

  it("produces a valid VCALENDAR with required properties for an all-day item", () => {
    const item = makeItem();
    const ics = buildIcs(item, "UTC");
    expect(ics).not.toBeNull();

    const lines = unfold(ics!);
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines).toContain("VERSION:2.0");
    expect(lines.some((l) => l.startsWith("PRODID:"))).toBe(true);
    expect(lines).toContain("CALSCALE:GREGORIAN");
    expect(lines).toContain("BEGIN:VEVENT");
    expect(lines).toContain("END:VEVENT");
    expect(lines[lines.length - 1]).toBe("END:VCALENDAR");
  });

  it("uses CRLF line endings", () => {
    const item = makeItem();
    const ics = buildIcs(item, "UTC")!;
    // Every line break must be CRLF
    expect(ics).toMatch(/\r\n/);
    // No bare LF
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/\n/);
  });

  // -----------------------------------------------------------------------
  // Timed event (hasExplicitTime = true)
  // -----------------------------------------------------------------------

  it("timed event: DTSTART and DTEND are in UTC with Z suffix", () => {
    const item = makeItem({
      dueDate: "2025-06-15T14:30:00.000Z",
      metadata: { hasExplicitTime: true },
    });
    const ics = buildIcs(item, "America/New_York")!;

    const dtstart = getLine(ics, "DTSTART:");
    const dtend = getLine(ics, "DTEND:");

    expect(dtstart).toBe("DTSTART:20250615T143000Z");
    expect(dtend).toBe("DTEND:20250615T153000Z"); // +60 minutes
  });

  it("timed event: DTEND is exactly 60 minutes after DTSTART", () => {
    const item = makeItem({
      dueDate: "2025-08-01T23:00:00.000Z",
      metadata: { hasExplicitTime: true },
    });
    const ics = buildIcs(item, "UTC")!;

    expect(getLine(ics, "DTSTART:")).toBe("DTSTART:20250801T230000Z");
    expect(getLine(ics, "DTEND:")).toBe("DTEND:20250802T000000Z");
  });

  // -----------------------------------------------------------------------
  // All-day event
  // -----------------------------------------------------------------------

  it("all-day event: DTSTART uses VALUE=DATE and is the local calendar day", () => {
    // 2025-06-15T00:00:00Z is still June 14 in America/New_York (UTC-4)
    const item = makeItem({ dueDate: "2025-06-15T00:00:00.000Z" });
    const ics = buildIcs(item, "America/New_York")!;

    // UTC midnight = June 14 in New York
    expect(getLine(ics, "DTSTART;VALUE=DATE:")).toBe(
      "DTSTART;VALUE=DATE:20250614"
    );
    // DTEND is next calendar day
    expect(getLine(ics, "DTEND;VALUE=DATE:")).toBe("DTEND;VALUE=DATE:20250615");
  });

  it("all-day event near midnight in Asia/Kolkata keeps the local day", () => {
    // 2025-06-14T18:45:00Z = 2025-06-15T00:15:00+05:30 (Kolkata)
    // So the LOCAL day is June 15, even though UTC is still June 14.
    const item = makeItem({ dueDate: "2025-06-14T18:45:00.000Z" });
    const ics = buildIcs(item, "Asia/Kolkata")!;

    expect(getLine(ics, "DTSTART;VALUE=DATE:")).toBe(
      "DTSTART;VALUE=DATE:20250615"
    );
    expect(getLine(ics, "DTEND;VALUE=DATE:")).toBe("DTEND;VALUE=DATE:20250616");
  });

  it("all-day event with UTC timezone: local day matches UTC day", () => {
    const item = makeItem({ dueDate: "2025-12-31T00:00:00.000Z" });
    const ics = buildIcs(item, "UTC")!;
    expect(getLine(ics, "DTSTART;VALUE=DATE:")).toBe(
      "DTSTART;VALUE=DATE:20251231"
    );
    expect(getLine(ics, "DTEND;VALUE=DATE:")).toBe("DTEND;VALUE=DATE:20260101");
  });

  // -----------------------------------------------------------------------
  // Stable UID
  // -----------------------------------------------------------------------

  it("UID is stable across two calls with the same item", () => {
    const item = makeItem({ id: "abc-123-def" });
    const ics1 = buildIcs(item, "UTC")!;
    const ics2 = buildIcs(item, "UTC")!;

    const uid1 = getLine(ics1, "UID:");
    const uid2 = getLine(ics2, "UID:");

    expect(uid1).toBe("UID:abc-123-def@lifeloop");
    expect(uid2).toBe("UID:abc-123-def@lifeloop");
    expect(uid1).toBe(uid2);
  });

  // -----------------------------------------------------------------------
  // SUMMARY / DESCRIPTION / LOCATION
  // -----------------------------------------------------------------------

  it("SUMMARY contains the item title", () => {
    const item = makeItem({ title: "Pay Geico Insurance" });
    const ics = buildIcs(item, "UTC")!;
    expect(getLine(ics, "SUMMARY:")).toBe("SUMMARY:Pay Geico Insurance");
  });

  it("includes DESCRIPTION from metadata.description", () => {
    const item = makeItem({
      metadata: { description: "Comprehensive and collision coverage" },
    });
    const ics = buildIcs(item, "UTC")!;
    expect(getLine(ics, "DESCRIPTION:")).toBe(
      "DESCRIPTION:Comprehensive and collision coverage"
    );
  });

  it("includes DESCRIPTION from metadata.notes when description is absent", () => {
    const item = makeItem({
      metadata: { notes: "Bring the policy document" },
    });
    const ics = buildIcs(item, "UTC")!;
    expect(getLine(ics, "DESCRIPTION:")).toBe(
      "DESCRIPTION:Bring the policy document"
    );
  });

  it("includes LOCATION when present", () => {
    const item = makeItem({ metadata: { location: "123 Main St, Springfield" } });
    const ics = buildIcs(item, "UTC")!;
    expect(getLine(ics, "LOCATION:")).toBe(
      "LOCATION:123 Main St\\, Springfield"
    );
  });

  it("omits DESCRIPTION and LOCATION when they are empty", () => {
    const item = makeItem({ metadata: {} });
    const ics = buildIcs(item, "UTC")!;
    expect(unfold(ics).some((l) => l.startsWith("DESCRIPTION:"))).toBe(false);
    expect(unfold(ics).some((l) => l.startsWith("LOCATION:"))).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Special character escaping
  // -----------------------------------------------------------------------

  it("escapes backslash in SUMMARY", () => {
    const item = makeItem({ title: "Path: C:\\Users\\Test" });
    const ics = buildIcs(item, "UTC")!;
    expect(getLine(ics, "SUMMARY:")).toBe(
      "SUMMARY:Path: C:\\\\Users\\\\Test"
    );
  });

  it("escapes semicolons in SUMMARY", () => {
    const item = makeItem({ title: "Task; urgent; now" });
    const ics = buildIcs(item, "UTC")!;
    expect(getLine(ics, "SUMMARY:")).toBe("SUMMARY:Task\\; urgent\\; now");
  });

  it("escapes commas in SUMMARY", () => {
    const item = makeItem({ title: "Meet Alice, Bob, and Carol" });
    const ics = buildIcs(item, "UTC")!;
    expect(getLine(ics, "SUMMARY:")).toBe(
      "SUMMARY:Meet Alice\\, Bob\\, and Carol"
    );
  });

  it("escapes newlines in DESCRIPTION", () => {
    const item = makeItem({
      metadata: { description: "Line one\nLine two" },
    });
    const ics = buildIcs(item, "UTC")!;
    expect(getLine(ics, "DESCRIPTION:")).toBe(
      "DESCRIPTION:Line one\\nLine two"
    );
  });

  // -----------------------------------------------------------------------
  // Long-line folding at 75 bytes
  // -----------------------------------------------------------------------

  it("folds a line longer than 75 bytes at 75 bytes with CRLF+SPACE", () => {
    const longTitle =
      "This is an exceptionally long title that definitely exceeds seventy-five bytes when encoded";
    const item = makeItem({ title: longTitle });
    const ics = buildIcs(item, "UTC")!;

    // Raw (unprocessed) ics should contain folded lines
    const rawLines = ics.split("\r\n");
    const summaryLine = rawLines.find((l) => l.startsWith("SUMMARY:"));
    expect(summaryLine).toBeDefined();
    // The first physical line must be ≤ 75 bytes
    const encoder = new TextEncoder();
    expect(encoder.encode(summaryLine!).length).toBeLessThanOrEqual(75);

    // But the logical line (unfolded) must equal the full value
    const logicalLine = getLine(ics, "SUMMARY:");
    expect(logicalLine).toBe(`SUMMARY:${longTitle}`);
  });

  it("all raw physical lines are ≤ 75 bytes", () => {
    const item = makeItem({
      title:
        "A very long insurance renewal for Geico comprehensive and collision coverage policy 2025",
      metadata: {
        description:
          "Please renew your Geico car insurance policy before the deadline to avoid a lapse in coverage. " +
          "Call 1-800-GEICO or visit geico.com. Policy number: GK-982341. Amount due: $185.50.",
        location: "123 Insurance Ave, Springfield, IL 62701, United States of America",
      },
    });
    const ics = buildIcs(item, "UTC")!;

    const encoder = new TextEncoder();
    const rawLines = ics.split("\r\n").filter(Boolean);
    for (const line of rawLines) {
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    }
  });

  // -----------------------------------------------------------------------
  // Invalid / fallback timezone
  // -----------------------------------------------------------------------

  it("falls back to UTC when given an invalid timezone", () => {
    const item = makeItem({ dueDate: "2025-06-15T00:00:00.000Z" });
    const ics = buildIcs(item, "Not/ATimezone");
    expect(ics).not.toBeNull();
    // Should still produce a valid calendar, with UTC day
    expect(getLine(ics!, "DTSTART;VALUE=DATE:")).toBe(
      "DTSTART;VALUE=DATE:20250615"
    );
  });
});
