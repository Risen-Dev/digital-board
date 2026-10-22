import "server-only";
import nodemailer from "nodemailer";

/**
 * Outgoing mail, only used for password-reset links. Off unless both are set:
 * SMTP_URL (e.g. smtps://user:pass@smtp.example.com) and APP_URL — the link is
 * built from APP_URL, never from the request's Host header, which a caller controls.
 */
export const mailEnabled = () => Boolean(process.env.SMTP_URL && process.env.APP_URL);

export const appUrl = (path: string) => new URL(path, process.env.APP_URL).toString();

export async function sendMail(to: string, subject: string, text: string) {
  const transport = nodemailer.createTransport(process.env.SMTP_URL);
  await transport.sendMail({ from: process.env.MAIL_FROM || "Digital Board <no-reply@localhost>", to, subject, text });
}
