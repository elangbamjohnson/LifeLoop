// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useNow } from "../../../src/client/hooks/useNow";

describe("useNow hook", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    Object.defineProperty(document, "hidden", { value: false, writable: true });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns current Date and re-renders when it ticks", () => {
    const startTime = new Date("2026-09-28T12:00:00.000Z");
    vi.setSystemTime(startTime);

    const { result } = renderHook(() => useNow(1000));
    expect(result.current.toISOString()).toBe("2026-09-28T12:00:00.000Z");

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.toISOString()).toBe("2026-09-28T12:00:01.000Z");
  });

  it("pauses ticking while the tab is hidden", () => {
    const startTime = new Date("2026-09-28T12:00:00.000Z");
    vi.setSystemTime(startTime);

    const { result } = renderHook(() => useNow(1000));
    expect(result.current.toISOString()).toBe("2026-09-28T12:00:00.000Z");

    // Hide tab
    act(() => {
      Object.defineProperty(document, "hidden", { value: true, writable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Advance 5 seconds while hidden
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    // No ticks occurred while hidden: state still holds the time before advancing
    expect(result.current.toISOString()).toBe("2026-09-28T12:00:00.000Z");
  });

  it("on visibilitychange/focus sets the clock to the real time immediately", () => {
    const startTime = new Date("2026-09-28T12:00:00.000Z");
    vi.setSystemTime(startTime);

    const { result } = renderHook(() => useNow(1000));

    // Hide tab
    act(() => {
      Object.defineProperty(document, "hidden", { value: true, writable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Advance 10 seconds while hidden
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(result.current.toISOString()).toBe("2026-09-28T12:00:00.000Z");

    // Make tab visible again
    act(() => {
      Object.defineProperty(document, "hidden", { value: false, writable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Immediately corrected to real system time (10 seconds later)
    expect(result.current.toISOString()).toBe("2026-09-28T12:00:10.000Z");

    // Also test window focus event
    act(() => {
      vi.setSystemTime(new Date("2026-09-28T12:00:30.000Z"));
      window.dispatchEvent(new Event("focus"));
    });
    expect(result.current.toISOString()).toBe("2026-09-28T12:00:30.000Z");
  });

  it("unmount clears the interval (no leaked timers)", () => {
    const clearIntervalSpy = vi.spyOn(global, "clearInterval");
    const { unmount } = renderHook(() => useNow(1000));

    unmount();

    expect(clearIntervalSpy).toHaveBeenCalled();
  });
});
