import { describe, it, expect } from "vitest";
import { convertLocalWallClockToUTC } from "../src/server/services/AIProvider";

describe("convertLocalWallClockToUTC", () => {
  it("handles standard string without offset", () => {
    // 2026-09-28T09:00:00 in America/New_York (EDT, UTC-4) => 2026-09-28T13:00:00.000Z
    const d = convertLocalWallClockToUTC("2026-09-28T09:00:00", "America/New_York");
    expect(d).not.toBeNull();
    expect(d!.toISOString()).toBe("2026-09-28T13:00:00.000Z");
  });

  it("handles a DST gap (2026-03-08 02:30 America/New_York)", () => {
    // US DST starts 2026-03-08 at 02:00 -> clocks jump to 03:00.
    // 02:30 local does not exist. The implementation treats the wall-clock
    // literally and offsets by whatever Intl reports for that instant.
    // In practice this yields 03:30 EDT = 07:30 UTC.
    const d = convertLocalWallClockToUTC("2026-03-08T02:30:00", "America/New_York");
    expect(d).not.toBeNull();
    expect(d!.toISOString()).toBe("2026-03-08T07:30:00.000Z");
  });

  it("handles a DST overlap (2026-11-01 01:30 America/New_York)", () => {
    // US DST ends 2026-11-01 at 02:00 -> clocks fall back to 01:00.
    // 01:30 local occurs twice. Intl typically resolves to the first
    // occurrence (EDT, UTC-4), so 01:30 EDT = 05:30 UTC.
    const d = convertLocalWallClockToUTC("2026-11-01T01:30:00", "America/New_York");
    expect(d).not.toBeNull();
    expect(d!.toISOString()).toBe("2026-11-01T05:30:00.000Z");
  });

  it("handles post-transition time on spring-forward day (2026-03-08 03:30 America/New_York)", () => {
    // Clocks spring forward 02:00 -> 03:00 EDT (UTC-4). 03:30 EDT is 07:30 UTC.
    const d = convertLocalWallClockToUTC("2026-03-08T03:30:00", "America/New_York");
    expect(d).not.toBeNull();
    expect(d!.toISOString()).toBe("2026-03-08T07:30:00.000Z");
  });

  it("handles post-transition time on fall-back day (2026-11-01 03:00 America/New_York)", () => {
    // Clocks fall back 02:00 -> 01:00 EST (UTC-5). 03:00 EST is 08:00 UTC.
    const d = convertLocalWallClockToUTC("2026-11-01T03:00:00", "America/New_York");
    expect(d).not.toBeNull();
    expect(d!.toISOString()).toBe("2026-11-01T08:00:00.000Z");
  });

  it("strips Z or offsets if a model still returns them", () => {
    // Should ignore the 'Z' and treat it as local 09:00 in New York (EDT)
    const d1 = convertLocalWallClockToUTC("2026-09-28T09:00:00Z", "America/New_York");
    expect(d1).not.toBeNull();
    expect(d1!.toISOString()).toBe("2026-09-28T13:00:00.000Z");

    // Should ignore the +05:30 and treat it as local 09:00 in New York (EDT)
    const d2 = convertLocalWallClockToUTC("2026-09-28T09:00:00+05:30", "America/New_York");
    expect(d2).not.toBeNull();
    expect(d2!.toISOString()).toBe("2026-09-28T13:00:00.000Z");
  });

  it("handles null/invalid input", () => {
    expect(convertLocalWallClockToUTC(null, "America/New_York")).toBeNull();
    expect(convertLocalWallClockToUTC(undefined, "America/New_York")).toBeNull();
    expect(convertLocalWallClockToUTC("", "America/New_York")).toBeNull();
    expect(convertLocalWallClockToUTC("invalid", "America/New_York")).toBeNull();
  });
});
