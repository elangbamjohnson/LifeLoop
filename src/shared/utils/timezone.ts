/**
 * Validates an IANA timezone string.
 * Returns true if the string is a valid IANA timezone name recognised by the runtime.
 * Returns false for null, undefined, empty strings, and invalid names.
 */
export function isValidTimezone(tz: string | null | undefined): boolean {
  if (!tz || typeof tz !== "string") return false;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
