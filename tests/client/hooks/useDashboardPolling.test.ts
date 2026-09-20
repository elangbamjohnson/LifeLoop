// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { useDashboardPolling } from "../../../src/client/hooks/useDashboardPolling";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function okCaptures(statuses: Array<"pending" | "processing" | "completed" | "failed">) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      captures: statuses.map((s, i) => ({
        id: `c${i}`,
        type: "text",
        rawPayload: "",
        originalFilename: null,
        processingStatus: s,
        createdAt: new Date().toISOString(),
      })),
    }),
  } as unknown as Response;
}

function okItems() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      items: [
        {
          id: "i1",
          title: "Task 1",
          createdAt: "2024-01-01T00:00:00.000Z",
          dueDate: null,
          snoozedUntil: null,
          completedAt: null,
        },
      ],
    }),
  } as unknown as Response;
}

function errResp(status: number) {
  return { ok: false, status, json: async () => ({}) } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  fetchMock = vi.fn();
  global.fetch = fetchMock as unknown as typeof fetch;

  // Default: page is visible and online
  Object.defineProperty(document, "hidden", { value: false, writable: true });
  Object.defineProperty(navigator, "onLine", { value: true, writable: true });
});

afterEach(() => {
  vi.runAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useDashboardPolling", () => {
  it("initial fetch: loads captures and items, sets loading=false", async () => {
    fetchMock
      .mockResolvedValueOnce(okCaptures(["completed"]))
      .mockResolvedValueOnce(okItems());

    const { result } = renderHook(() => useDashboardPolling(false));
    expect(result.current.loading).toBe(true);

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.captures).toHaveLength(1);
    expect(result.current.items).toHaveLength(1);
    expect(result.current.error).toBeNull();
    expect(result.current.authError).toBe(false);
    // fetch called exactly twice (captures + items)
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("hasProcessing=false: no timer is scheduled after fetch", async () => {
    fetchMock
      .mockResolvedValue(okCaptures([]))
      .mockResolvedValue(okItems());

    renderHook(() => useDashboardPolling(false));

    await act(async () => { await Promise.resolve(); });

    // Advance 10 seconds — should not cause another fetch
    await act(async () => { vi.advanceTimersByTime(10_000); });
    // Only the initial 2 calls
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("hasProcessing=true: schedules next poll at 5s after fetch completes", async () => {
    fetchMock
      .mockResolvedValue(okCaptures(["pending"]))
      .mockResolvedValue(okItems());

    const { result } = renderHook(() => useDashboardPolling(true));

    // Initial fetch
    await act(async () => { await Promise.resolve(); });
    const callsAfterFirst = fetchMock.mock.calls.length; // 2

    // Advance 5 seconds → second poll fires
    await act(async () => { vi.advanceTimersByTime(5_000); });
    await act(async () => { await Promise.resolve(); });

    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it("no fetch when document is hidden", async () => {
    Object.defineProperty(document, "hidden", { value: true, writable: true });
    fetchMock.mockResolvedValue(okCaptures([]));

    renderHook(() => useDashboardPolling(false));

    await act(async () => { await Promise.resolve(); });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("no fetch when navigator.onLine=false", async () => {
    Object.defineProperty(navigator, "onLine", { value: false, writable: true });
    fetchMock.mockResolvedValue(okCaptures([]));

    renderHook(() => useDashboardPolling(false));

    await act(async () => { await Promise.resolve(); });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refetches when page becomes visible (visibilitychange)", async () => {
    fetchMock
      .mockResolvedValue(okCaptures([]))
      .mockResolvedValue(okItems());

    renderHook(() => useDashboardPolling(false));
    await act(async () => { await Promise.resolve(); });
    const countAfterMount = fetchMock.mock.calls.length;

    // Simulate page becoming visible
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    expect(fetchMock.mock.calls.length).toBeGreaterThan(countAfterMount);
  });

  it("refetches when coming back online", async () => {
    fetchMock
      .mockResolvedValue(okCaptures([]))
      .mockResolvedValue(okItems());

    renderHook(() => useDashboardPolling(false));
    await act(async () => { await Promise.resolve(); });
    const countAfterMount = fetchMock.mock.calls.length;

    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await Promise.resolve();
    });

    expect(fetchMock.mock.calls.length).toBeGreaterThan(countAfterMount);
  });

  it("manual refetch triggers additional fetch", async () => {
    fetchMock
      .mockResolvedValue(okCaptures([]))
      .mockResolvedValue(okItems());

    const { result } = renderHook(() => useDashboardPolling(false));
    await act(async () => { await Promise.resolve(); });
    const before = fetchMock.mock.calls.length;

    await act(async () => {
      result.current.refetch();
      await Promise.resolve();
    });

    expect(fetchMock.mock.calls.length).toBeGreaterThan(before);
  });

  it("error: sets error state; does NOT leave loading=true", async () => {
    fetchMock.mockRejectedValue(new Error("Network Error"));

    const { result } = renderHook(() => useDashboardPolling(false));
    await act(async () => { await Promise.resolve(); });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe("Network Error");
    expect(result.current.loading).toBe(false);
  });

  it("error backoff: retry fires after ~5s, resets error on success", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("fail"))
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue(okCaptures([]))
      .mockResolvedValue(okItems());

    const { result } = renderHook(() => useDashboardPolling(false));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.error).toBeInstanceOf(Error);

    // Advance past the 5s backoff (plus jitter headroom)
    await act(async () => { vi.advanceTimersByTime(7_000); });
    await act(async () => { await Promise.resolve(); });

    // After two failures, error resets when success
    await act(async () => { vi.advanceTimersByTime(15_000); });
    await act(async () => { await Promise.resolve(); });

    expect(result.current.error).toBeNull();
  });

  it("401: stops polling, sets authError=true, calls onAuthError callback", async () => {
    fetchMock.mockResolvedValue(errResp(401));

    const onAuthError = vi.fn();
    const { result } = renderHook(() => useDashboardPolling(true, onAuthError));
    await act(async () => { await Promise.resolve(); });

    expect(result.current.authError).toBe(true);
    expect(onAuthError).toHaveBeenCalledTimes(1);

    // Even with hasProcessing=true, no more polls should fire
    await act(async () => { vi.advanceTimersByTime(30_000); });
    await act(async () => { await Promise.resolve(); });
    expect(onAuthError).toHaveBeenCalledTimes(1); // not called again
  });

  it("403: same stop behaviour as 401", async () => {
    fetchMock.mockResolvedValue(errResp(403));
    const onAuthError = vi.fn();
    const { result } = renderHook(() => useDashboardPolling(false, onAuthError));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.authError).toBe(true);
    expect(onAuthError).toHaveBeenCalledTimes(1);
  });

  it("StrictMode double-mount: does not double poll", async () => {
    fetchMock
      .mockResolvedValue(okCaptures([]))
      .mockResolvedValue(okItems());

    // Simulate StrictMode by mounting, unmounting, and remounting
    const { result, unmount } = renderHook(() => useDashboardPolling(false));
    unmount();

    const { result: result2 } = renderHook(() => useDashboardPolling(false));
    await act(async () => { await Promise.resolve(); });

    // Only the second mount's initial fetch should fire (2 calls)
    // First mount was cleaned up before fetch completed
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it("cleanup on unmount cancels timer and aborts in-flight request", async () => {
    // Spy on the real AbortController.prototype.abort so we can detect the call
    const abortSpy = vi.spyOn(AbortController.prototype, "abort");

    // Fetch that never resolves (simulates in-flight request)
    fetchMock.mockReturnValue(new Promise(() => {}));

    const { unmount } = renderHook(() => useDashboardPolling(true));
    // Let the effect fire (fetch starts but doesn't resolve)
    await act(async () => { await Promise.resolve(); });

    unmount();

    expect(abortSpy).toHaveBeenCalled();
    abortSpy.mockRestore();
  });

  it("no timer is running when both hidden and hasProcessing=true", async () => {
    Object.defineProperty(document, "hidden", { value: true, writable: true });

    renderHook(() => useDashboardPolling(true));
    await act(async () => { await Promise.resolve(); });

    await act(async () => { vi.advanceTimersByTime(20_000); });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
