const pushHosts = new Set([
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
]);

export function isSupportedPushEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== "string") return false;

  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }

  // Validate the canonical string that web-push will use for the request.
  if (url.href !== endpoint || url.protocol !== "https:" || url.port || url.username || url.password || endpoint.includes("#")) {
    return false;
  }

  return pushHosts.has(url.hostname) ||
    url.hostname.endsWith(".push.apple.com") ||
    url.hostname.endsWith(".notify.windows.com");
}
