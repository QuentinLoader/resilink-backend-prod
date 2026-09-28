import express from "express";
import pool from "../config/db.js";
import { authenticateUser } from "../middleware/auth.js";
import crypto from "crypto";
import { startManagerTrialIfEligible, SUPPORT_EMAIL } from "../utils/planTrial.js";
import { sendEmail } from "../utils/mailer.js";

const router = express.Router();

function generateAccessCode() {
  return "R-" + crypto.randomBytes(3).toString("hex").toUpperCase();
}

function formatDate(value) {
  return new Date(value).toLocaleDateString("en-ZA", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

router.post("/register-manager", authenticateUser, async (req, res) => {
  const { full_name, residency_name, property_type } = req.body;

  const supabaseUserId = req.user.id;
  const email = req.user.email;

  if (!residency_name || !property_type) {
    return res.status(400).json({
      error: "Residency name and property type are required"
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
        full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), managers.full_name)
      RETURNING id
      `,
      [supabaseUserId, email, String(full_name || "").trim() || null]
    );

    const managerDbId = managerResult.rows[0].id;

    trialStarted = await startManagerTrialIfEligible(managerDbId, client);

    const accessCode = generateAccessCode();

    const residencyResult = await client.query(
      `
      INSERT INTO residencies (name, property_type, access_code)
      VALUES ($1, $2, $3)
      RETURNING id
      `,
      [residency_name, property_type, accessCode]
    );

    const residencyId = residencyResult.rows[0].id;

    await client.query(
      `
      INSERT INTO manager_residencies (manager_id, residency_id)
      VALUES ($1, $2)
      `,
      [managerDbId, residencyId]
    );

    await client.query("COMMIT");

    if (trialStarted && email) {
      sendEmail({
        to: email,
        subject: "Your 30-day ResLink trial has started",
        html: `
          <p>Welcome to ResLink.</p>
          <p>Your <b>30-day full-access trial</b> is now active until <b>${formatDate(trialStarted.trial_ends_at)}</b>.</p>
          <p>During the trial you can use all manager and resident portal functions.</p>
          <p>If you do not upgrade to Pro before the trial ends, operational access and the resident portal will pause. Your data will be retained.</p>
          <p>Need help? Contact <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>
        `
      }).catch((error) => {
        console.error("Trial welcome email failed:", error);
      });
    }

    return res.status(201).json({
      message: "Manager registered successfully",
      residency_id: residencyId,
      access_code: accessCode,
      access_state: trialStarted ? "TRIAL" : undefined,
      trial_ends_at: trialStarted?.trial_ends_at ?? null
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Register manager error:", error);
    return res.status(500).json({ error: "Registration failed" });
  } finally {
    client.release();
  }
});

export default router;
