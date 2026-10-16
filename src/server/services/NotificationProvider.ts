import { db } from "../../db";
import { notificationLogs, reminders, pushSubscriptions } from "../../db/schema";
import { eq } from "drizzle-orm";
import webPush from "web-push";
import { getMailSender, getAppUrl, MockMailSender } from "./MailSender";

function sanitizeErrorMessage(msg: string): string {
  if (!msg) return "Push delivery failed";
  return msg
    .replace(/(?:key|secret|token|bearer|auth|vapid)[=:\s]+[A-Za-z0-9_\-\.\/+=]+/gi, "[REDACTED]")
    .replace(/["']?[a-zA-Z0-9_\-]{30,}["']?/g, "[REDACTED]");
}

export type NotificationChannel = "web" | "ios" | "android" | "email";

export interface NotificationPayload {
  reminderId: string;
  userId: string;
  title: string;
  body: string;
  channel: NotificationChannel;
  scheduledAt: Date;
  itemId?: string;
  metadata?: Record<string, any>;
}

export interface NotificationResult {
  success: boolean;
  channel: NotificationChannel;
  status: "delivered" | "queued" | "failed";
  idempotencyKey: string;
  deliveredAt?: Date;
  error?: string;
  payload?: any;
}

export interface ChannelProvider {
  channel: NotificationChannel;
  send(payload: NotificationPayload, idempotencyKey: string): Promise<NotificationResult>;
}

// 1. Web Notification Provider (Web Push / Browser Notification API)
export class WebNotificationProvider implements ChannelProvider {
  channel: NotificationChannel = "web";

  async send(payload: NotificationPayload, idempotencyKey: string): Promise<NotificationResult> {
    try {
      const isOffline = payload.metadata?.isDeviceOffline === true;

      // If device is offline, mark as queued for delivery when back online
      if (isOffline) {
        return {
          success: true,
          channel: this.channel,
          status: "queued",
          idempotencyKey,
          payload: {
            badge: "/favicon.ico",
            icon: "/favicon.ico",
            title: payload.title,
            body: payload.body,
            tag: `lifeloop-${payload.reminderId}`,
            data: { itemId: payload.itemId, url: payload.itemId ? `/?item=${encodeURIComponent(payload.itemId)}` : "/" },
            pushed: 0,
          },
        };
      }

      const publicKey = process.env.VAPID_PUBLIC_KEY;
      const privateKey = process.env.VAPID_PRIVATE_KEY;
      const subject = process.env.VAPID_SUBJECT || "mailto:admin@lifeloop.app";

      // If keys are missing, keep today's behavior ("delivered") and record pushed: 0
      if (!publicKey || !privateKey) {
        return {
          success: true,
          channel: this.channel,
          status: "delivered",
          idempotencyKey,
          deliveredAt: new Date(),
          payload: {
            title: payload.title,
            body: payload.body,
            tag: `lifeloop-${payload.reminderId}`,
            timestamp: Date.now(),
            pushed: 0,
          },
        };
      }

      // Fetch user subscriptions
      const subscriptions = await db
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, payload.userId));

      // If user has no subscriptions, keep today's behavior ("delivered") and record pushed: 0
      if (subscriptions.length === 0) {
        return {
          success: true,
          channel: this.channel,
          status: "delivered",
          idempotencyKey,
          deliveredAt: new Date(),
          payload: {
            title: payload.title,
            body: payload.body,
            tag: `lifeloop-${payload.reminderId}`,
            timestamp: Date.now(),
            pushed: 0,
          },
        };
      }

      // Configure web-push details
      webPush.setVapidDetails(subject, publicKey, privateKey);

      // Small payload: title, body, item id, and a URL that opens the item
      const itemUrl = payload.itemId ? `/?item=${encodeURIComponent(payload.itemId)}` : "/";
      const pushData = JSON.stringify({
        title: payload.title,
        body: payload.body,
        itemId: payload.itemId,
        url: itemUrl,
      });

      let successCount = 0;
      let nonExpiredFailureCount = 0;
      let lastErrorMessage = "";

      for (const sub of subscriptions) {
        try {
          await webPush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: {
                p256dh: sub.p256dh,
                auth: sub.auth,
              },
            },
            pushData
          );
          successCount++;
        } catch (err: any) {
          const status = err?.statusCode || err?.status;
          // a 404 or 410 from the push service deletes that subscription and does not count as a failure
          if (status === 404 || status === 410) {
            await db
              .delete(pushSubscriptions)
              .where(eq(pushSubscriptions.endpoint, sub.endpoint))
              .catch(() => {});
          } else {
            nonExpiredFailureCount++;
            lastErrorMessage = sanitizeErrorMessage(err?.message || "Push delivery failed");
          }
        }
      }

      // At least one send worked: "delivered", with the count in the payload
      if (successCount > 0) {
        return {
          success: true,
          channel: this.channel,
          status: "delivered",
          idempotencyKey,
          deliveredAt: new Date(),
          payload: {
            title: payload.title,
            body: payload.body,
            tag: `lifeloop-${payload.reminderId}`,
            timestamp: Date.now(),
            pushed: successCount,
          },
        };
      }

      // Every send failed for another reason: "failed", with an error text that has no secrets
      if (nonExpiredFailureCount > 0) {
        return {
          success: false,
          channel: this.channel,
          status: "failed",
          idempotencyKey,
          error: lastErrorMessage || "All push notification dispatches failed",
          payload: {
            pushed: 0,
            failed: nonExpiredFailureCount,
          },
        };
      }

      // If all subscriptions were 404/410, deleted subscriptions don't count as failure
      return {
        success: true,
        channel: this.channel,
        status: "delivered",
        idempotencyKey,
        deliveredAt: new Date(),
        payload: {
          title: payload.title,
          body: payload.body,
          tag: `lifeloop-${payload.reminderId}`,
          timestamp: Date.now(),
          pushed: 0,
        },
      };
    } catch (unexpectedError: any) {
      // The provider must never throw. Return failed with sanitized error text
      return {
        success: false,
        channel: this.channel,
        status: "failed",
        idempotencyKey,
        error: "Unexpected error during web push delivery",
        payload: {
          pushed: 0,
          error: sanitizeErrorMessage(unexpectedError?.message || "Unknown error"),
        },
      };
    }
  }
}

// 2. iOS Notification Provider (APNs Abstraction)
export class IOSNotificationProvider implements ChannelProvider {
  channel: NotificationChannel = "ios";

  async send(payload: NotificationPayload, idempotencyKey: string): Promise<NotificationResult> {
    // Apple Push Notification Service (APNs) spec payload
    const apnsPayload = {
      aps: {
        alert: {
          title: payload.title,
          body: payload.body,
        },
        badge: 1,
        sound: "default",
        "interruption-level": "time-sensitive", // Critical for reminder timeliness
        "collapse-id": `lifeloop_${payload.reminderId}`,
      },
      itemId: payload.itemId,
    };

    return {
      success: true,
      channel: this.channel,
      status: "delivered",
      idempotencyKey,
      deliveredAt: new Date(),
      payload: apnsPayload,
    };
  }
}

// 3. Android Notification Provider (FCM Abstraction)
export class AndroidNotificationProvider implements ChannelProvider {
  channel: NotificationChannel = "android";

  async send(payload: NotificationPayload, idempotencyKey: string): Promise<NotificationResult> {
    // Firebase Cloud Messaging (FCM) spec payload
    const fcmPayload = {
      notification: {
        title: payload.title,
        body: payload.body,
      },
      android: {
        priority: "high",
        notification: {
          channel_id: "lifeloop_reminders",
          default_sound: true,
          default_vibrate_timings: true,
          tag: payload.reminderId,
        },
      },
      data: {
        itemId: payload.itemId || "",
        scheduledAt: payload.scheduledAt.toISOString(),
      }
    };

    return {
      success: true,
      channel: this.channel,
      status: "delivered",
      idempotencyKey,
      deliveredAt: new Date(),
      payload: fcmPayload,
    };
  }
}

// 4. Email Notification Provider (Brevo Transactional Email Integration)
export class EmailNotificationProvider implements ChannelProvider {
  channel: NotificationChannel = "email";

  async send(payload: NotificationPayload, idempotencyKey: string): Promise<NotificationResult> {
    const recipient = payload.metadata?.userEmail;
    if (!recipient) {
      return {
        success: false,
        channel: this.channel,
        status: "failed",
        idempotencyKey,
        error: "no recipient",
      };
    }

    try {
      const isProd = process.env.NODE_ENV === "production";
      const isTest = process.env.NODE_ENV === "test";

      const sender = getMailSender();

      // In production (not test), if active provider is mock, return failed rather than fake delivery
      if (isProd && !isTest && (sender instanceof MockMailSender || process.env.MAIL_PROVIDER !== "brevo")) {
        return {
          success: false,
          channel: this.channel,
          status: "failed",
          idempotencyKey,
          error: "mail provider not configured",
        };
      }

      let userTz = "UTC";
      if (payload.metadata?.timezone) {
        try {
          Intl.DateTimeFormat(undefined, { timeZone: payload.metadata.timezone });
          userTz = payload.metadata.timezone;
        } catch {
          userTz = "UTC";
        }
      }

      let formattedDue = "";
      try {
        formattedDue = new Intl.DateTimeFormat("en-US", {
          timeZone: userTz,
          dateStyle: "full",
          timeStyle: "short",
        }).format(new Date(payload.scheduledAt));
      } catch {
        formattedDue = new Date(payload.scheduledAt).toUTCString();
      }

      const scheduledDate = new Date(payload.scheduledAt);
      const now = new Date();
      let isTodayInTz = false;
      try {
        const dayFmt = new Intl.DateTimeFormat("en-US", {
          timeZone: userTz,
          year: "numeric",
          month: "numeric",
          day: "numeric",
        });
        isTodayInTz = dayFmt.format(now) === dayFmt.format(scheduledDate);
      } catch {
        isTodayInTz = false;
      }

      let shortDueTime = "";
      try {
        if (isTodayInTz) {
          shortDueTime = new Intl.DateTimeFormat("en-US", {
            timeZone: userTz,
            hour: "numeric",
            minute: "2-digit",
          }).format(scheduledDate);
        } else {
          shortDueTime = new Intl.DateTimeFormat("en-US", {
            timeZone: userTz,
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          }).format(scheduledDate);
        }
      } catch {
        shortDueTime = scheduledDate.toUTCString();
      }
      shortDueTime = shortDueTime.replace(/[\u202F\u00A0]/g, " ").trim();

      const escapeHtml = (str: string) =>
        str
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#039;");

      const safeTitle = escapeHtml(payload.title || "");
      const safeBody = escapeHtml(payload.body || "");
      const safeDue = escapeHtml(formattedDue);

      // Keep subject to one line (strip newlines, cap ~120 chars)
      const cleanTitle = (payload.title || "").replace(/[\r\n]+/g, " ").trim();
      let rawSubject: string;
      if (!cleanTitle) {
        rawSubject = "Your LifeLoop reminder";
      } else {
        rawSubject = `${cleanTitle} at ${shortDueTime}`;
      }
      rawSubject = rawSubject.replace(/[\r\n]+/g, " ").trim();
      const subject = rawSubject.length > 120 ? rawSubject.slice(0, 117) + "..." : rawSubject;

      const appUrl = getAppUrl().replace(/\/+$/, "");
      const itemLink = appUrl ? `${appUrl}` : "";

      const footerNotice = "You're getting this because you turned on email reminders in LifeLoop. To stop, turn off \"Email me reminders\" in Preferences.";
      const textFooter = appUrl
        ? `${footerNotice}\n${appUrl}`
        : footerNotice;
      const htmlFooter = appUrl
        ? `<p style="color: #78716c; font-size: 12px; margin-top: 24px; line-height: 1.4;">${footerNotice}<br/><a href="${appUrl}" style="color: #78716c;">${appUrl}</a></p>`
        : `<p style="color: #78716c; font-size: 12px; margin-top: 24px; line-height: 1.4;">${footerNotice}</p>`;

      const text = `${payload.title}\n\nDue: ${formattedDue}\n\n${payload.body}${itemLink ? `\n\nView item: ${itemLink}` : ""}\n\n${textFooter}`;
      const html = `
        <div style="font-family: sans-serif; padding: 20px; color: #1c1917;">
          <h2 style="margin: 0 0 10px 0;">${safeTitle}</h2>
          <p style="color: #78716c; font-size: 14px; margin: 0 0 10px 0;"><strong>Due:</strong> ${safeDue}</p>
          <p style="color: #57534e; font-size: 16px;">${safeBody}</p>
          ${itemLink ? `<a href="${itemLink}" style="display: inline-block; background: #1c1917; color: #fff; padding: 10px 18px; border-radius: 8px; text-decoration: none; margin-top: 15px;">Open LifeLoop</a>` : ""}
          ${htmlFooter}
        </div>
      `.trim();

      const sendResult = await sender.send({
        to: recipient,
        subject,
        text,
        html,
      });

      if (sendResult.ok) {
        return {
          success: true,
          channel: this.channel,
          status: "delivered",
          idempotencyKey,
          deliveredAt: new Date(),
          payload: {
            to: recipient,
            subject,
            messageId: sendResult.messageId,
          },
        };
      } else {
        return {
          success: false,
          channel: this.channel,
          status: "failed",
          idempotencyKey,
          error: (sendResult.error || "Send failed").slice(0, 200),
        };
      }
    } catch (err: any) {
      return {
        success: false,
        channel: this.channel,
        status: "failed",
        idempotencyKey,
        error: (err?.message || "Mail sender failure").slice(0, 200),
      };
    }
  }
}

// Unified Notification Dispatcher with Idempotency & DB Log
export class NotificationDispatcher {
  private providers: Map<NotificationChannel, ChannelProvider> = new Map();

  constructor() {
    this.registerProvider(new WebNotificationProvider());
    this.registerProvider(new IOSNotificationProvider());
    this.registerProvider(new AndroidNotificationProvider());
    this.registerProvider(new EmailNotificationProvider());
  }

  registerProvider(provider: ChannelProvider) {
    this.providers.set(provider.channel, provider);
  }

  generateIdempotencyKey(reminderId: string, scheduledTime: Date, channel: string): string {
    const timeKey = scheduledTime.toISOString().slice(0, 16); // Minute precision
    return `${reminderId}_${timeKey}_${channel}`;
  }

  async dispatch(payload: NotificationPayload): Promise<NotificationResult> {
    const provider = this.providers.get(payload.channel);
    if (!provider) {
      throw new Error(`Unsupported notification channel: ${payload.channel}`);
    }

    const idempotencyKey = this.generateIdempotencyKey(
      payload.reminderId,
      payload.scheduledAt,
      payload.channel
    );

    // 1. Idempotency Check: only rows with status "delivered" or "queued" block resend
    const [existing] = await db
      .select()
      .from(notificationLogs)
      .where(eq(notificationLogs.idempotencyKey, idempotencyKey))
      .limit(1);

    if (existing && (existing.status === "delivered" || existing.status === "queued")) {
      // Duplicate notification blocked!
      return {
        success: true,
        channel: payload.channel,
        status: existing.status as any,
        idempotencyKey,
        deliveredAt: existing.deliveredAt || undefined,
        payload: existing.payload,
      };
    }

    // 2. Dispatch via channel provider
    const result = await provider.send(payload, idempotencyKey);

    // 3. Persist to notification logs table (update existing failed row or insert new)
    if (existing) {
      await db
        .update(notificationLogs)
        .set({
          status: result.status,
          deliveredAt: result.deliveredAt || null,
          payload: result.payload || {},
          updatedAt: new Date(),
        })
        .where(eq(notificationLogs.id, existing.id));
    } else {
      await db.insert(notificationLogs).values({
        reminderId: payload.reminderId,
        userId: payload.userId,
        channel: payload.channel,
        idempotencyKey,
        status: result.status,
        deliveredAt: result.deliveredAt || null,
        payload: result.payload || {},
      });
    }

    // 4. Update reminder status
    // If result.status is "failed": log it, and do NOT update the reminder status to sent/scheduled here.
    if (result.status === "failed") {
      console.warn(
        `[NotificationDispatcher] Dispatch failed for reminder ${payload.reminderId} via ${payload.channel}: ${result.error}`
      );
      return result;
    }

    await db
      .update(reminders)
      .set({
        status: result.status === "delivered" ? "sent" : "scheduled",
        sentAt: result.deliveredAt || null,
      })
      .where(eq(reminders.id, payload.reminderId));

    return result;
  }
}

export const notificationDispatcher = new NotificationDispatcher();

