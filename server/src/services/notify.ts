import nodemailer, { type Transporter } from "nodemailer";
import { prisma } from "../db.js";
import { config } from "../config.js";

let transport: Transporter | null = null;
if (config.smtp.host) {
  transport = nodemailer.createTransport({
    host: config.smtp.host, port: config.smtp.port, secure: config.smtp.port === 465,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
}

// Notification service layer. In-app inbox + email now.
// Push (FCM) and SMS/WhatsApp can be added here later without touching callers.
export async function notify(userIds: (number | null | undefined)[], title: string, body: string, link?: string) {
  const ids = [...new Set(userIds.filter((x): x is number => typeof x === "number"))];
  if (!ids.length) return;
  await prisma.notification.createMany({ data: ids.map((userId) => ({ userId, title, body, link })) });
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { email: true } });
  for (const u of users) await sendEmail(u.email, title, body);
}

export async function sendEmail(to: string, subject: string, text: string) {
  if (!transport) {
    console.log(`[email not configured] to=${to} subject=${subject}`);
    return;
  }
  try {
    await transport.sendMail({ from: config.smtp.from, to, subject, text });
  } catch (e) {
    console.error("email failed", to, (e as Error).message);
  }
}
