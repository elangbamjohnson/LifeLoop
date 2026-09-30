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

export function formatApiErrorMessage(status: number, data?: any): string {
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
    return "Something went wrong on our side. Your note is still here, please try again.";
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

export async function extractApiErrorMessage(res: Response): Promise<string> {
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    // Non-JSON response body (empty, text, HTML 500, etc.)
  }
  return formatApiErrorMessage(res.status, data);
}
