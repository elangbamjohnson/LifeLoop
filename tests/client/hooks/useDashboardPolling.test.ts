// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useDashboardPolling } from "../../../src/client/hooks/useDashboardPolling";

// Mock the global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("useDashboardPolling", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("fetches data initially and sets state", async () => {
    // Setup mock responses
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ captures: [{ id: "c1", type: "text" }] }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [{ id: "i1", title: "Task 1", createdAt: "2024-01-01T00:00:00.000Z" }],
      }),
    });

    const { result } = renderHook(() => useDashboardPolling(4000));

    // Initially loading is true
    expect(result.current.loading).toBe(true);

    // Wait for the async effect to settle
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.captures).toHaveLength(1);
    expect(result.current.captures[0].id).toBe("c1");
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].id).toBe("i1");
    expect(result.current.error).toBeNull();
    
    // fetch should have been called twice (captures and items)
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("polls for data at the specified interval", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    const setIntervalSpy = vi.spyOn(global, "setInterval");
    
    renderHook(() => useDashboardPolling(5000));

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5000);
    setIntervalSpy.mockRestore();
  });

  it("handles fetch errors gracefully", async () => {
    mockFetch.mockRejectedValue(new Error("Network Error"));

    const { result } = renderHook(() => useDashboardPolling());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe("Network Error");
    expect(result.current.captures).toEqual([]);
    expect(result.current.items).toEqual([]);
  });

  it("exposes a refetch function to manually trigger updates", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    const { result } = renderHook(() => useDashboardPolling());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);

    await act(async () => {
      await result.current.refetch();
    });

    expect(mockFetch).toHaveBeenCalledTimes(4);
  });
});
