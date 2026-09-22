import nodemailer from "nodemailer";

export interface VerificationEmailArgs {
  to: string;
  verifyUrl: string;
  expiresAt: Date;
}

export interface EmailProvider {
  sendVerificationEmail(args: VerificationEmailArgs): Promise<void>;
}

export class TransactionalEmailProvider implements EmailProvider {
  private transporter: ReturnType<typeof nodemailer.createTransport>;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || "587", 10),
      secure: process.env.SMTP_SECURE === "true", // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  async sendVerificationEmail(args: VerificationEmailArgs): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: process.env.EMAIL_FROM || '"LifeLoop" <noreply@lifeloop.com>',
        to: args.to,
        subject: "Verify your LifeLoop email address",
        text: `Please verify your email address by visiting the following link: \n\n${args.verifyUrl}\n\nThis link will expire at ${args.expiresAt.toISOString()}.`,
        html: `<p>Please verify your email address by clicking the link below:</p><p><a href="${args.verifyUrl}">Verify Email</a></p><p>This link will expire at ${args.expiresAt.toISOString()}.</p>`,
      });
      console.log(`[EmailProvider] Verification email sent to ${args.to}`);
    } catch (error) {
      console.error(`[EmailProvider] TransactionalEmailProvider error:`, error);
      // We log but do not throw, as sending must be asynchronous and non-blocking
    }
  }
}

export class MockEmailProvider implements EmailProvider {
  public emails: Array<{ to: string; subject: string; text?: string; html?: string; verifyUrl: string; sentAt: Date }> = [];

  async sendVerificationEmail(args: VerificationEmailArgs): Promise<void> {
    this.emails.push({
      to: args.to,
      subject: "Verify your LifeLoop email address",
      text: `Please verify your email address by visiting the following link: \n\n${args.verifyUrl}\n\nThis link will expire at ${args.expiresAt.toISOString()}.`,
      html: `<p>Please verify your email address by clicking the link below:</p><p><a href="${args.verifyUrl}">Verify Email</a></p><p>This link will expire at ${args.expiresAt.toISOString()}.</p>`,
      verifyUrl: args.verifyUrl,
      sentAt: new Date(),
    });
    console.log(`[EmailProvider] (Mock) Verification email recorded for ${args.to}`);
  }
}

let providerInstance: EmailProvider;

export function getEmailProvider(): EmailProvider {
  if (providerInstance) return providerInstance;

  const envProvider = process.env.EMAIL_PROVIDER || "mock";
  const isTest = process.env.NODE_ENV === "test";

  if (isTest || envProvider === "mock") {
    providerInstance = new MockEmailProvider();
  } else {
    providerInstance = new TransactionalEmailProvider();
  }

  return providerInstance;
}
