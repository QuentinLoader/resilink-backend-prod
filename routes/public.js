import express from "express";
import pool from "../config/db.js";
import { authenticateUser } from "../middleware/auth.js";
import {
  startManagerTrialIfEligible,
  getManagerAccountStateBySupabaseUserId,
  SUPPORT_EMAIL
} from "../utils/planTrial.js";
import { sendEmail } from "../utils/mailer.js";

const router = express.Router();

function formatDate(value) {
  return new Date(value).toLocaleDateString("en-ZA", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

router.post("/register-manager", authenticateUser, async (req, res) => {
  const fullName = String(req.body?.full_name || "").trim();

  const supabaseUserId = req.user.id;
  const email = req.user.email;

  if (!fullName) {
    return res.status(400).json({
      error: "Full name is required"
    });
  }

  const client = await pool.connect();
  let trialStarted = null;

  try {
    await client.query("BEGIN");

    const managerResult = await client.query(
      `
      INSERT INTO managers (supabase_user_id, email, full_name)
      VALUES ($1, $2, $3)
      ON CONFLICT (supabase_user_id)
      DO UPDATE SET
        email = EXCLUDED.email,
        full_name = COALESCE(
          NULLIF(EXCLUDED.full_name, ''),
          managers.full_name
        )
      RETURNING id
      `,
      [supabaseUserId, email, fullName]
    );

    const managerDbId = managerResult.rows[0].id;

    trialStarted = await startManagerTrialIfEligible(
      managerDbId,
      client
    );

    const account = await getManagerAccountStateBySupabaseUserId(
      supabaseUserId,
      client
    );

    await client.query("COMMIT");

    if (trialStarted && email) {
      sendEmail({
        to: email,
        subject: "Your 30-day ResLink trial has started",
        html: `
          <p>Welcome to ResLink.</p>
          <p>Your <b>30-day full-access trial</b> is now active until <b>${formatDate(trialStarted.trial_ends_at)}</b>.</p>
          <p>During the trial you can use all ResLink functions.</p>
          <p>You can create your first residency from your dashboard whenever you are ready.</p>
          <p>If you do not upgrade to Pro before the trial ends, operational access and the resident portal will pause. Your data will be retained.</p>
          <p>Need help? Contact <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>
        `
      }).catch((error) => {
        console.error("Trial welcome email failed:", error);
      });
    }

    return res.status(201).json({
      message: "Manager registered successfully",
      manager_id: account?.manager_id ?? managerDbId,
      access_state:
        account?.access_state ??
        (trialStarted ? "TRIAL" : undefined),
      trial_ends_at:
        account?.trial_ends_at ??
        trialStarted?.trial_ends_at ??
        null,
      days_remaining: account?.days_remaining ?? null,
      support_email: SUPPORT_EMAIL
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Register manager error:", error);
    return res.status(500).json({
      error: "Registration failed"
    });
  } finally {
    client.release();
  }
});

export default router;
