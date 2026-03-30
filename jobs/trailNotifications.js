import pool from "../config/db.js";
import { sendEmail } from "../utils/mailer.js";

function daysDiff(a, b) {
  return Math.ceil((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function formatDate(d) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("en-ZA", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function buildSoonHtml({ name, endsAt }) {
  return `
    <p>Hi ${name || "there"},</p>
    <p>Your <b>ResLink Pro trial</b> ends on <b>${formatDate(endsAt)}</b>.</p>
    <p>After expiry, you can still view requests, but you won’t be able to assign artisans, schedule visits, or manage job workflow.</p>
    <p><a href="${process.env.APP_URL}/dashboard">Upgrade to keep full access</a></p>
  `;
}

function buildTomorrowHtml({ name, endsAt }) {
  return `
    <p>Hi ${name || "there"},</p>
    <p>Your trial ends <b>tomorrow (${formatDate(endsAt)})</b>.</p>
    <p>Upgrade now to avoid interruptions.</p>
    <p><a href="${process.env.APP_URL}/dashboard">Upgrade</a></p>
  `;
}

function buildExpiredHtml({ name }) {
  return `
    <p>Hi ${name || "there"},</p>
    <p>Your trial has ended. Maintenance workflow actions are now locked.</p>
    <p><a href="${process.env.APP_URL}/dashboard">Upgrade to ResLink Pro</a></p>
  `;
}

export async function runTrialNotifications() {
  const client = await pool.connect();

  const summary = {
    checked: 0,
    sent_7d: 0,
    sent_1d: 0,
    sent_expired: 0,
    skipped_no_email: 0,
    errors: 0
  };

  try {
    const { rows } = await client.query(`
      SELECT
        m.id,
        m.trial_ends_at,
        m.trial_notify_7d_sent_at,
        m.trial_notify_1d_sent_at,
        m.trial_expired_notified_at,
        u.email,
        COALESCE(u.full_name, u.name, '') AS full_name
      FROM managers m
      LEFT JOIN users u
        ON u.id = m.user_id
      WHERE m.trial_ends_at IS NOT NULL
    `);

    const now = new Date();
    summary.checked = rows.length;

    for (const m of rows) {
      try {
        const end = new Date(m.trial_ends_at);
        if (Number.isNaN(end.getTime())) continue;

        if (!m.email) {
          summary.skipped_no_email += 1;
          continue;
        }

        const d = daysDiff(now, end);

        // T-7
        if (d <= 7 && d > 1 && !m.trial_notify_7d_sent_at) {
          await sendEmail({
            to: m.email,
            subject: "Your ResLink trial ends soon",
            html: buildSoonHtml({ name: m.full_name, endsAt: end })
          });

          await client.query(
            `UPDATE managers SET trial_notify_7d_sent_at = NOW() WHERE id = $1`,
            [m.id]
          );

          summary.sent_7d += 1;
          continue;
        }

        // T-1
        if (d === 1 && !m.trial_notify_1d_sent_at) {
          await sendEmail({
            to: m.email,
            subject: "Your trial ends tomorrow",
            html: buildTomorrowHtml({ name: m.full_name, endsAt: end })
          });

          await client.query(
            `UPDATE managers SET trial_notify_1d_sent_at = NOW() WHERE id = $1`,
            [m.id]
          );

          summary.sent_1d += 1;
          continue;
        }

        // T-0 or past
        if (end <= now && !m.trial_expired_notified_at) {
          await sendEmail({
            to: m.email,
            subject: "Your ResLink trial has ended",
            html: buildExpiredHtml({ name: m.full_name })
          });

          await client.query(
            `UPDATE managers SET trial_expired_notified_at = NOW() WHERE id = $1`,
            [m.id]
          );

          summary.sent_expired += 1;
        }
      } catch (err) {
        summary.errors += 1;
        console.error(`Trial notification row failed for manager ${m.id}:`, err);
      }
    }

    return summary;
  } catch (e) {
    console.error("Trial notification job error:", e);
    throw e;
  } finally {
    client.release();
  }
}