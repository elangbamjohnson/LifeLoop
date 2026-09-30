import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleCaptureSubmit } from "../../../src/client/features/dashboard/Dashboard";

describe("Dashboard handleCaptureSubmit", () => {
  const originalFetch = global.fetch;
  const showToast = vi.fn();
  const fetchData = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("throws expected message on 401 session expiration", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "Unauthorized" }),
    } as Response);

    await expect(
      handleCaptureSubmit({ type: "text", payload: "Test note" }, { showToast, fetchData })
    ).rejects.toThrow("Your session has expired. Please sign in again.");

    expect(showToast).not.toHaveBeenCalled();
    expect(fetchData).not.toHaveBeenCalled();
  });

  it("throws expected message on 403 with server error message", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: "Please verify your email address to access this resource" }),
    } as Response);

    await expect(
      handleCaptureSubmit({ type: "text", payload: "Test note" }, { showToast, fetchData })
    ).rejects.toThrow("Please verify your email address to access this resource");

    expect(showToast).not.toHaveBeenCalled();
    expect(fetchData).not.toHaveBeenCalled();
  });

  it("throws fallback message on 403 without server error string", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({}),
    } as Response);

    await expect(
      handleCaptureSubmit({ type: "text", payload: "Test note" }, { showToast, fetchData })
    ).rejects.toThrow("You don't have permission to do that.");
  });

  it("throws expected message on 429 rate limit", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: "Rate limit exceeded" }),
    } as Response);

    await expect(
      handleCaptureSubmit({ type: "text", payload: "Test note" }, { showToast, fetchData })
    ).rejects.toThrow("Too many requests. Please wait a moment and try again.");

    expect(showToast).not.toHaveBeenCalled();
    expect(fetchData).not.toHaveBeenCalled();
  });

  it("throws sanitized friendly message on 500 and hides server details", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "SELECT * FROM users failed: stack trace..." }),
    } as Response);

    await expect(
      handleCaptureSubmit({ type: "text", payload: "Test note" }, { showToast, fetchData })
    ).rejects.toThrow("Something went wrong on our side. Your note is still here, please try again.");

    expect(showToast).not.toHaveBeenCalled();
    expect(fetchData).not.toHaveBeenCalled();
  });

  it("throws expected message on network error (fetch rejects)", async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(
      handleCaptureSubmit({ type: "text", payload: "Test note" }, { showToast, fetchData })
    ).rejects.toThrow("Couldn't reach the server. Check your connection and try again.");

    expect(showToast).not.toHaveBeenCalled();
    expect(fetchData).not.toHaveBeenCalled();
  });

  it("resolves and calls callbacks on success", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ capture: { id: "cap-1" } }),
    } as Response);

    await expect(
      handleCaptureSubmit({ type: "text", payload: "Test note" }, { showToast, fetchData })
    ).resolves.toBeUndefined();

    expect(showToast).toHaveBeenCalledWith("Captured! LifeLoop AI is organizing it in the background.");
    expect(fetchData).toHaveBeenCalled();
  });
});
