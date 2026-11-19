import { extractApiErrorMessage } from "./apiError";

export async function getBrowserPushSubscription(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  return await registration?.pushManager?.getSubscription() ?? null;
}

export async function isPushRegistered(subscription: PushSubscription, requireConfigured = true): Promise<boolean> {
  const response = await fetch("/api/v1/push/status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
  if (!response.ok) throw new Error(await extractApiErrorMessage(response, "changes"));
  const status = await response.json();
  return status.registered === true && (!requireConfigured || status.available === true);
}

export async function disableBrowserPush(): Promise<void> {
  const subscription = await getBrowserPushSubscription();
  if (!subscription) return;

  let browserDisabled = false;
  try {
    await subscription.unsubscribe();
    browserDisabled = true;
  } catch {
    // Removing the server registration also stops future delivery to this device.
  }

  try {
    const response = await fetch("/api/v1/push/subscribe", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
    if (!response.ok) throw new Error(await extractApiErrorMessage(response, "changes"));
    const result = await response.json();
    if (!browserDisabled && !result.removed) throw new Error("Subscription removal was not confirmed");
  } catch {
    if (!browserDisabled) throw new Error("Couldn't turn off notifications on this device. Check your connection and try again.");
  }
}
