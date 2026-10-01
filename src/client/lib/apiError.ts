/**
 * src/client/lib/apiError.ts
 *
 * Pure shared status-to-message mapping for API responses and network failures.
 */

export const NETWORK_ERROR_MESSAGE = "Couldn't reach the server. Check your connection and try again.";

export function isShortString(str: unknown, maxLen = 200): str is string {
  if (typeof str !== "string") return false;
  const trimmed = str.trim();
  if (!trimmed) return false;
  if (trimmed.length > maxLen) return false;
  // Exclude raw HTML error responses or stack traces
  if (/^<(!DOCTYPE|html)/i.test(trimmed)) return false;
  if (trimmed.includes("    at ") || trimmed.includes("node:internal")) return false;
  return true;
}

export function formatApiErrorMessage(
  status: number,
  data?: any,
  subject: "note" | "changes" = "note"
): string {
  if (status === 401) {
    return "Your session has expired. Please sign in again.";
  }

  if (status === 413) {
    return "That file is too large.";
  }

  if (status === 429) {
    return "Too many requests. Please wait a moment and try again.";
  }

  if (status >= 500 && status <= 599) {
    const verb = subject === "changes" ? "are" : "is";
    return `Something went wrong on our side. Your ${subject} ${verb} still here, please try again.`;
  }

  const serverError = data && typeof data === "object" ? data.error : undefined;

  if (status === 403) {
    if (isShortString(serverError)) {
      return serverError.trim();
    }
    return "You don't have permission to do that.";
  }

  // Other 4xx
  if (status >= 400 && status <= 499) {
    if (isShortString(serverError)) {
      return serverError.trim();
    }
    return "Couldn't save. Please try again.";
  }

  return "Couldn't save. Please try again.";
}

export async function extractApiErrorMessage(
  res: Response,
  subject?: "note" | "changes"
): Promise<string>;
export async function extractApiErrorMessage(
  res: Response,
  data?: any,
  subject?: "note" | "changes"
): Promise<string>;
export async function extractApiErrorMessage(
  res: Response,
  arg2?: "note" | "changes" | any,
  arg3: "note" | "changes" = "note"
): Promise<string> {
  let subject: "note" | "changes" = "note";
  let data: any = null;

  if (arg2 === "note" || arg2 === "changes") {
    subject = arg2;
  } else {
    data = arg2;
    subject = arg3;
  }

  if (data === null || data === undefined) {
    try {
      data = await res.json();
    } catch {
      // Non-JSON response body (empty, text, HTML 500, etc.)
    }
  }

  return formatApiErrorMessage(res.status, data, subject);
}
