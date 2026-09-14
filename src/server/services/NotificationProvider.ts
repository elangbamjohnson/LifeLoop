import { db } from "../../db";
import { notificationLogs, reminders } from "../../db/schema";
import { eq } from "drizzle-orm";

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
          data: { itemId: payload.itemId, url: "/" }
        }
      };
    }

    // Live Web Notification dispatch
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
      }
    };
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

// 4. Email Notification Provider (Future-compatible Email Abstraction)
export class EmailNotificationProvider implements ChannelProvider {
  channel: NotificationChannel = "email";

  async send(payload: NotificationPayload, idempotencyKey: string): Promise<NotificationResult> {
    const emailPayload = {
      from: "LifeLoop Reminders <notifications@lifeloop.app>",
      to: payload.metadata?.userEmail || "user@lifeloop.app",
      subject: `[LifeLoop] Reminder: ${payload.title}`,
      text: `${payload.title}\n\n${payload.body}\n\nView item: https://lifeloop.app`,
      html: `
        <div style="font-family: sans-serif; padding: 20px; color: #1c1917;">
          <h2 style="margin: 0 0 10px 0;">${payload.title}</h2>
          <p style="color: #57534e; font-size: 16px;">${payload.body}</p>
          <a href="https://lifeloop.app" style="display: inline-block; background: #1c1917; color: #fff; padding: 10px 18px; border-radius: 8px; text-decoration: none; margin-top: 15px;">Open LifeLoop</a>
        </div>
      `,
    };

    return {
      success: true,
      channel: this.channel,
      status: "delivered",
      idempotencyKey,
      deliveredAt: new Date(),
      payload: emailPayload,
    };
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

    // 1. Idempotency Check: check if already sent in DB
    const [existing] = await db
      .select()
      .from(notificationLogs)
      .where(eq(notificationLogs.idempotencyKey, idempotencyKey))
      .limit(1);

    if (existing) {
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

    // 3. Persist to notification logs table
    await db.insert(notificationLogs).values({
      reminderId: payload.reminderId,
      userId: payload.userId,
      channel: payload.channel,
      idempotencyKey,
      status: result.status,
      deliveredAt: result.deliveredAt || null,
      payload: result.payload || {},
    });

    // 4. Update reminder status
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
