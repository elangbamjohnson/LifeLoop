import { describe, it, expect } from "vitest";
import {
  formatApiErrorMessage,
  extractApiErrorMessage,
  NETWORK_ERROR_MESSAGE,
  isShortString,
} from "../../../src/client/lib/apiError";

describe("apiError status-to-message mapping", () => {
  describe("formatApiErrorMessage", () => {
    it("returns correct message for 401", () => {
      expect(formatApiErrorMessage(401)).toBe("Your session has expired. Please sign in again.");
      expect(formatApiErrorMessage(401, { error: "Ignored" })).toBe("Your session has expired. Please sign in again.");
    });

    it("returns correct message for 413", () => {
      expect(formatApiErrorMessage(413)).toBe("That file is too large.");
      expect(formatApiErrorMessage(413, { error: "Payload Too Large" })).toBe("That file is too large.");
    });

    it("returns correct message for 429", () => {
      expect(formatApiErrorMessage(429)).toBe("Too many requests. Please wait a moment and try again.");
      expect(formatApiErrorMessage(429, { error: "Rate limit exceeded" })).toBe("Too many requests. Please wait a moment and try again.");
    });

    it("returns friendly message for 5xx and never leaks raw server error or stack traces", () => {
      const expectedNote = "Something went wrong on our side. Your note is still here, please try again.";
      expect(formatApiErrorMessage(500)).toBe(expectedNote);
      expect(formatApiErrorMessage(500, undefined, "note")).toBe(expectedNote);
      expect(formatApiErrorMessage(500, { error: "pg_query: syntax error at or near 'SELECT'" })).toBe(expectedNote);
      expect(formatApiErrorMessage(502, { error: "Bad Gateway" })).toBe(expectedNote);
      expect(formatApiErrorMessage(503, { error: "Service Unavailable" })).toBe(expectedNote);
      expect(formatApiErrorMessage(504, { stack: "Error: at line 42" })).toBe(expectedNote);

      const expectedChanges = "Something went wrong on our side. Your changes are still here, please try again.";
      expect(formatApiErrorMessage(500, undefined, "changes")).toBe(expectedChanges);
      expect(formatApiErrorMessage(500, { error: "pg_query: syntax error" }, "changes")).toBe(expectedChanges);
      expect(formatApiErrorMessage(503, { error: "Service Unavailable" }, "changes")).toBe(expectedChanges);
    });

    it("handles 403: uses short error string if present, else fallback", () => {
      expect(
        formatApiErrorMessage(403, { error: "Please verify your email address to access this resource" })
      ).toBe("Please verify your email address to access this resource");

      expect(formatApiErrorMessage(403, {})).toBe("You don't have permission to do that.");
      expect(formatApiErrorMessage(403, null)).toBe("You don't have permission to do that.");
      expect(formatApiErrorMessage(403, undefined)).toBe("You don't have permission to do that.");
      expect(formatApiErrorMessage(403, { error: "" })).toBe("You don't have permission to do that.");
      expect(formatApiErrorMessage(403, { error: "   " })).toBe("You don't have permission to do that.");

      // Very long server error string (> 200 chars) falls back to safe message
      const longError = "A".repeat(250);
      expect(formatApiErrorMessage(403, { error: longError })).toBe("You don't have permission to do that.");

      // Raw HTML falls back to safe message
      expect(formatApiErrorMessage(403, { error: "<html><body>Forbidden</body></html>" })).toBe(
        "You don't have permission to do that."
      );
    });

    it("handles other 4xx: uses short error string if present, else generic fallback", () => {
      expect(formatApiErrorMessage(400, { error: "Invalid title format" })).toBe("Invalid title format");
      expect(formatApiErrorMessage(422, { error: "Validation failed on fields" })).toBe("Validation failed on fields");

      expect(formatApiErrorMessage(400, {})).toBe("Couldn't save. Please try again.");
      expect(formatApiErrorMessage(404, null)).toBe("Couldn't save. Please try again.");
      expect(formatApiErrorMessage(400, { error: "" })).toBe("Couldn't save. Please try again.");

      // Very long server error string falls back to generic message
      const longError = "Error detail: " + "X".repeat(250);
      expect(formatApiErrorMessage(400, { error: longError })).toBe("Couldn't save. Please try again.");

      // Raw stack trace falls back to generic message
      expect(formatApiErrorMessage(400, { error: "TypeError: failed\n    at Object.test (/app/index.js:1:1)" })).toBe(
        "Couldn't save. Please try again."
      );
    });
  });

  describe("extractApiErrorMessage with Response", () => {
    it("extracts error from JSON response", async () => {
      const res = new Response(JSON.stringify({ error: "Custom 400 error" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
      const msg = await extractApiErrorMessage(res);
      expect(msg).toBe("Custom 400 error");
    });

    it("handles empty body safely with default 'note' subject", async () => {
      const res = new Response("", { status: 500 });
      const msg = await extractApiErrorMessage(res);
      expect(msg).toBe("Something went wrong on our side. Your note is still here, please try again.");
    });

    it("handles 500 with 'changes' subject via 2nd or 3rd argument", async () => {
      const res1 = new Response("", { status: 500 });
      const msg1 = await extractApiErrorMessage(res1, "changes");
      expect(msg1).toBe("Something went wrong on our side. Your changes are still here, please try again.");

      const res2 = new Response(JSON.stringify({ error: "Server exploded" }), { status: 500 });
      const msg2 = await extractApiErrorMessage(res2, undefined, "changes");
      expect(msg2).toBe("Something went wrong on our side. Your changes are still here, please try again.");
    });

    it("handles non-JSON body safely", async () => {
      const res = new Response("<!DOCTYPE html><html><body>Internal Error</body></html>", {
        status: 500,
        headers: { "Content-Type": "text/html" },
      });
      const msg = await extractApiErrorMessage(res);
      expect(msg).toBe("Something went wrong on our side. Your note is still here, please try again.");
    });

    it("handles non-JSON body for 403 safely", async () => {
      const res = new Response("Forbidden HTML body", {
        status: 403,
        headers: { "Content-Type": "text/plain" },
      });
      const msg = await extractApiErrorMessage(res);
      expect(msg).toBe("You don't have permission to do that.");
    });
  });

  describe("NETWORK_ERROR_MESSAGE", () => {
    it("has the required network error text", () => {
      expect(NETWORK_ERROR_MESSAGE).toBe("Couldn't reach the server. Check your connection and try again.");
    });
  });

  describe("isShortString", () => {
    it("validates string length and formats", () => {
      expect(isShortString("Valid short error")).toBe(true);
      expect(isShortString("")).toBe(false);
      expect(isShortString("   ")).toBe(false);
      expect(isShortString(null)).toBe(false);
      expect(isShortString(123)).toBe(false);
      expect(isShortString("A".repeat(201))).toBe(false);
      expect(isShortString("<!DOCTYPE html>")).toBe(false);
      expect(isShortString("<html>Error</html>")).toBe(false);
      expect(isShortString("Error\n    at foo.bar")).toBe(false);
    });
  });
});
