import nodemailer from "nodemailer";
import webpush from "web-push";
import { z } from "zod";
import { pool, transaction } from "./db.js";
import { integrationStatus } from "./config.js";
export const pushSchema = z
  .object({
    endpoint: z
      .string()
      .url()
      .max(2048)
      .refine((value) => {
        const u = new URL(value);
        return (
          u.protocol === "https:" &&
          !u.username &&
          !u.password &&
          !u.port &&
          ([
            "fcm.googleapis.com",
            "updates.push.services.mozilla.com",
            "web.push.apple.com",
          ].includes(u.hostname) ||
            u.hostname.endsWith(".notify.windows.com"))
        );
      }, "Proveedor push no admitido."),
    expirationTime: z.number().nullable().optional(),
    keys: z
      .object({
        p256dh: z.string().min(40).max(200),
        auth: z.string().min(16).max(100),
      })
      .strict(),
  })
  .strict();
let smtp;
function smtpTransport() {
  return (smtp ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 10000,
    socketTimeout: 15000,
  }));
}
export async function dispatchNotifications(
  db = pool,
  channels = {
    email: (message) => smtpTransport().sendMail(message),
    push: (subscription, payload) =>
      webpush.sendNotification(subscription, payload, {
        TTL: 3600,
        timeout: 10000,
      }),
  },
) {
  const enabled = integrationStatus();
  if (!enabled.email && !enabled.push) return;
  if (enabled.push)
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT,
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY,
    );
  // Outbox is committed with the business transaction. Delivery is at least once.
  for (let i = 0; i < 20; i++) {
    const handled = await transaction(async (c) => {
      const n = (
        await c.query(
          `SELECT n.*,u.email,EXISTS(SELECT 1 FROM demo_entities WHERE kind='user' AND entity_id=u.id) AS demo FROM notification_outbox n JOIN users u ON u.id=n.user_id WHERE (($1 AND email_sent_at IS NULL) OR ($2 AND push_sent_at IS NULL)) AND next_attempt_at<=now(3) ORDER BY n.created_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
          [enabled.email, enabled.push],
        )
      ).rows[0];
      if (!n) return false;
      let email = Boolean(n.email_sent_at),
        push = Boolean(n.push_sent_at);
      if (!email && enabled.email)
        try {
          if (!n.demo)
            await channels.email({
              from: process.env.MAIL_FROM,
              to: n.email,
              subject: n.title,
              text: `${n.body}\n\n${n.url}`,
              messageId: `<${n.id}@conexiones>`,
            });
          email = true;
        } catch {
          console.error("Correo pendiente", n.id);
        }
      if (!push && enabled.push) {
        push = true;
        for (const s of (
          await c.query("SELECT * FROM push_subscriptions WHERE user_id=$1", [
            n.user_id,
          ])
        ).rows) {
          try {
            await channels.push(
              s.subscription,
              JSON.stringify({
                title: n.title,
                body: n.body,
                url: n.url,
                tag: n.event_key,
              }),
            );
          } catch (error) {
            if ([404, 410].includes(error.statusCode))
              await c.query("DELETE FROM push_subscriptions WHERE id=$1", [
                s.id,
              ]);
            else push = false;
          }
        }
      }
      await c.query(
        `UPDATE notification_outbox SET email_sent_at=CASE WHEN $2 THEN COALESCE(email_sent_at,now(3)) ELSE email_sent_at END,push_sent_at=CASE WHEN $3 THEN COALESCE(push_sent_at,now(3)) ELSE push_sent_at END,next_attempt_at=DATE_ADD(now(3),INTERVAL LEAST(60,POW(2,LEAST(attempts,6))) MINUTE),attempts=attempts+1 WHERE id=$1`,
        [n.id, email, push],
      );
      return true;
    }, db);
    if (!handled) break;
  }
}
