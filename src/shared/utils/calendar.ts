/**
 * calendar.ts — Pure iCalendar (.ics) builder.
 *
 * No browser globals, no iOS / Android code.
 * Platform-specific download is handled in AddToCalendarButton.tsx so that
 * an Android-specific share-sheet can be added later without touching this file.
 */

import { TimelineItem } from "./timeline";

/**
 * Escape special characters as required by RFC 5545 §3.3.11.
 * Must escape: backslash, semicolon, comma, newlines.
 */
function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n/g, "\\n")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\n");
}

/**
 * Fold lines at 75 octets (bytes) using CRLF + SPACE as specified in RFC 5545 §3.1.
 * We fold on UTF-8 byte boundaries, not character boundaries, because the spec
 * counts octets.  A simple approach: build the line character-by-character and
 * flush when the byte count (including continuation prefix) would exceed 75.
 */
function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(line);

  if (bytes.length <= 75) return line;

  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let start = 0;
  let firstChunk = true;

  while (start < bytes.length) {
    const maxBytes = firstChunk ? 75 : 74; // continuation lines prefix with 1 space
    let end = Math.min(start + maxBytes, bytes.length);

    // Back up to a valid UTF-8 character boundary if needed
    while (end > start && (bytes[end] & 0xc0) === 0x80) {
      end--;
    }

    chunks.push(decoder.decode(bytes.slice(start, end)));
    start = end;
    firstChunk = false;
  }

  return chunks.join("\r\n ");
}

/**
 * Format a Date as YYYYMMDDTHHMMSSZ (UTC, as required for DTSTART/DTEND with Z suffix).
 */
function formatUtcDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

/**
 * Get the local calendar date (YYYYMMDD) in the given timezone,
 * using Intl.DateTimeFormat — NOT by slicing the UTC string.
 */
function localDateString(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    // en-CA gives "YYYY-MM-DD" which is easy to strip
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  let year = "", month = "", day = "";
  for (const p of parts) {
    if (p.type === "year") year = p.value;
    if (p.type === "month") month = p.value;
    if (p.type === "day") day = p.value;
  }
  return `${year}${month}${day}`;
}

/**
 * Add `minutes` to a Date, returning a new Date.
 */
function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

/**
 * Add one calendar day to the given YYYYMMDD string.
 * Works via simple numeric manipulation — avoids DST edge cases for all-day dates.
 */
function nextCalendarDay(yyyymmdd: string): string {
  const year = parseInt(yyyymmdd.slice(0, 4), 10);
  const month = parseInt(yyyymmdd.slice(4, 6), 10) - 1; // 0-based
  const day = parseInt(yyyymmdd.slice(6, 8), 10);
  const d = new Date(Date.UTC(year, month, day + 1));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

/**
 * Build the iCalendar text for a single TimelineItem.
 *
 * @param item         - The LifeLoop timeline item.
 * @param userTimezone - A valid IANA timezone string (e.g. "America/New_York").
 *                       Falls back to "UTC" if empty / invalid.
 * @returns            The complete .ics text (CRLF line endings, folded at 75 bytes),
 *                     or null if the item has no valid dueDate.
 */
export function buildIcs(
  item: TimelineItem,
  userTimezone: string
): string | null {
  // 1. Validate dueDate
  if (!item.dueDate) return null;
  const dueDate = new Date(item.dueDate);
  if (isNaN(dueDate.getTime())) return null;

  // 2. Validate / normalise timezone
  let tz = "UTC";
  try {
    Intl.DateTimeFormat("en-US", { timeZone: userTimezone });
    tz = userTimezone;
  } catch {
    // fall back to UTC
  }

  // 3. Stable UID — the same item never produces two events
  const uid = `${item.id}@lifeloop`;

  // 4. DTSTAMP — current UTC moment
  const dtstamp = formatUtcDateTime(new Date());

  // 5. DTSTART / DTEND
  let dtstart: string;
  let dtend: string;

  if (item.metadata?.hasExplicitTime === true) {
    // Timed event: DTSTART and DTEND in UTC (Z suffix), duration = 60 min
    dtstart = `DTSTART:${formatUtcDateTime(dueDate)}`;
    dtend = `DTEND:${formatUtcDateTime(addMinutes(dueDate, 60))}`;
  } else {
    // All-day event: VALUE=DATE, local calendar day in userTimezone
    const startDay = localDateString(dueDate, tz);
    const endDay = nextCalendarDay(startDay);
    dtstart = `DTSTART;VALUE=DATE:${startDay}`;
    dtend = `DTEND;VALUE=DATE:${endDay}`;
  }

  // 6. Optional fields (only include when non-empty)
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//LifeLoop//LifeLoop Calendar//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    dtstart,
    dtend,
    `SUMMARY:${escapeIcsText(item.title)}`,
  ];

  // DESCRIPTION: prefer metadata.description then metadata.notes
  const description =
    item.metadata?.description || item.metadata?.notes || null;
  if (description && typeof description === "string" && description.trim()) {
    lines.push(`DESCRIPTION:${escapeIcsText(description.trim())}`);
  }

  // LOCATION
  const location = item.metadata?.location || null;
  if (location && typeof location === "string" && location.trim()) {
    lines.push(`LOCATION:${escapeIcsText(location.trim())}`);
  }

  lines.push("END:VEVENT");
  lines.push("END:VCALENDAR");

  // 7. Fold each line at 75 bytes and join with CRLF
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
