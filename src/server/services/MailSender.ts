export interface MailArgs {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

export type MailResult =
  | { ok: true; messageId?: string; error?: undefined }
  | { ok: false; error: string; messageId?: undefined };

export interface MailSender {
  send(args: MailArgs): Promise<MailResult>;
}

export function getAppUrl(): string {
  return process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || "";
}

export class BrevoMailSender implements MailSender {
  async send(args: MailArgs): Promise<MailResult> {
    const apiKey = process.env.BREVO_API_KEY || "";
    const fromEmail = process.env.EMAIL_FROM_ADDRESS || "";
    const fromName = process.env.EMAIL_FROM_NAME || "LifeLoop";

    try {
      const payload: Record<string, any> = {
        sender: {
          name: fromName,
          email: fromEmail,
        },
        to: [{ email: args.to }],
        subject: args.subject,
      };

      if (args.html) {
        payload.htmlContent = args.html;
      }
      if (args.text) {
        payload.textContent = args.text;
      }

      const res = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "api-key": apiKey,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        let data: any = null;
        try {
          data = await res.json();
        } catch {
          // ignore non-json or empty response
        }
        return { ok: true as const, messageId: data?.messageId };
      }

      let errBody = "";
      try {
        const text = await res.text();
        errBody = text.slice(0, 200);
      } catch {
        // ignore read error
      }

      // NEVER log API key or email body
      return {
        ok: false as const,
        error: `Brevo API error (${res.status}): ${errBody}`,
      };
    } catch (err: any) {
      // NEVER throw, NEVER log API key or email body
      const isTimeout = err?.name === "TimeoutError" || err?.name === "AbortError";
      const errMsg = isTimeout ? "Request timed out" : (err?.message || "Network error");
      return {
        ok: false as const,
        error: errMsg.slice(0, 200),
      };
    }
  }
}

export class MockMailSender implements MailSender {
  public emails: Array<{
    to: string;
    subject: string;
    text?: string;
    html?: string;
    sentAt: Date;
    messageId?: string;
  }> = [];

  public forceFailure: string | null = null;

  setForceFailure(errorMsg: string | null) {
    this.forceFailure = errorMsg;
  }

  async send(args: MailArgs): Promise<MailResult> {
    if (this.forceFailure) {
      return { ok: false as const, error: this.forceFailure };
    }

    const messageId = `<mock-${Date.now()}-${Math.random().toString(36).slice(2)}@lifeloop.local>`;
    this.emails.push({
      to: args.to,
      subject: args.subject,
      text: args.text,
      html: args.html,
      sentAt: new Date(),
      messageId,
    });

    return { ok: true as const, messageId };
  }
}

let senderInstance: MailSender | null = null;

export function validateMailConfig(): { activeType: "mock" | "brevo" } {
  const rawProvider = process.env.MAIL_PROVIDER;
  const isProd = process.env.NODE_ENV === "production";

  let activeType: "mock" | "brevo" = "mock";

  if (!rawProvider || rawProvider === "mock") {
    activeType = "mock";
  } else if (rawProvider === "brevo") {
    activeType = "brevo";
  } else {
    if (isProd) {
      throw new Error(
        `FATAL: Invalid MAIL_PROVIDER '${rawProvider}'. Valid values are 'mock' or 'brevo'.`
      );
    } else {
      console.warn(
        `[MailSender] Unknown MAIL_PROVIDER '${rawProvider}', falling back to 'mock'.`
      );
      activeType = "mock";
    }
  }

  if (isProd && activeType === "mock") {
    console.warn(
      "[MailSender] Warning: Email reminders are disabled because MAIL_PROVIDER is not brevo."
    );
  }

  console.log(`[MailSender] Active mail provider: ${activeType}`);
  return { activeType };
}

export function getMailSender(): MailSender {
  if (senderInstance) return senderInstance;

  const isTest = process.env.NODE_ENV === "test";
  if (isTest) {
    senderInstance = new MockMailSender();
    return senderInstance;
  }

  const { activeType } = validateMailConfig();
  if (activeType === "brevo") {
    senderInstance = new BrevoMailSender();
  } else {
    senderInstance = new MockMailSender();
  }

  return senderInstance;
}

export function setMailSender(sender: MailSender | null) {
  senderInstance = sender;
}
