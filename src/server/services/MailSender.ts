export interface MailArgs {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

export type MailResult =
  | { ok: true; messageId?: string }
  | { ok: false; error: string };

export interface MailSender {
  send(args: MailArgs): Promise<MailResult>;
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
        return { ok: true, messageId: data?.messageId };
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
        ok: false,
        error: `Brevo API error (${res.status}): ${errBody}`,
      };
    } catch (err: any) {
      // NEVER throw, NEVER log API key or email body
      const isTimeout = err?.name === "TimeoutError" || err?.name === "AbortError";
      const errMsg = isTimeout ? "Request timed out" : (err?.message || "Network error");
      return {
        ok: false,
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
      return { ok: false, error: this.forceFailure };
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

    return { ok: true, messageId };
  }
}

let senderInstance: MailSender | null = null;

export function getMailSender(): MailSender {
  if (senderInstance) return senderInstance;

  const envProvider = process.env.EMAIL_PROVIDER;
  const isTest = process.env.NODE_ENV === "test";

  if (isTest || envProvider === "mock" || !envProvider) {
    senderInstance = new MockMailSender();
  } else if (envProvider === "brevo") {
    senderInstance = new BrevoMailSender();
  } else {
    senderInstance = new MockMailSender();
  }

  return senderInstance;
}

export function setMailSender(sender: MailSender | null) {
  senderInstance = sender;
}
