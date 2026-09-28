import express from "express";
import pool from "../config/db.js";
import { authenticateUser } from "../middleware/auth.js";
import { requireAddVisionAdmin } from "../middleware/commercialAccess.js";
import {
  SUPPORT_EMAIL,
  deriveManagerAccessState
} from "../utils/planTrial.js";

const router = express.Router();

router.use(authenticateUser, requireAddVisionAdmin);

function mapAccount(row) {
  const accessState = deriveManagerAccessState({
    planCode: row.plan_code,
    trialEndsAt: row.trial_ends_at
  });

  return {
    manager_id: row.id,
    full_name: row.full_name,
    email: row.email,
    access_state: accessState,
    plan_code: row.plan_code,
    trial_started_at: row.trial_started_at,
    trial_ends_at: row.trial_ends_at,
    has_used_trial: row.has_used_trial,
    trial_notify_7d_sent_at: row.trial_notify_7d_sent_at,
    trial_notify_1d_sent_at: row.trial_notify_1d_sent_at,
    trial_expired_notified_at: row.trial_expired_notified_at,
    residencies: row.residencies || [],
    residency_count: Number(row.residency_count || 0),
    support_email: SUPPORT_EMAIL
  };
}

async function loadAccountRows(whereSql = "", params = []) {
  const { rows } = await pool.query(
    `
    SELECT
      m.id,
      m.full_name,
      m.email,
      m.plan_code,
      m.trial_started_at,
      m.trial_ends_at,
      m.has_used_trial,
      m.trial_notify_7d_sent_at,
      m.trial_notify_1d_sent_at,
      m.trial_expired_notified_at,
      COUNT(r.id)::int AS residency_count,
      COALESCE(
        JSON_AGG(
          JSON_BUILD_OBJECT(
            'id', r.id,
            'name', r.name,
            'access_code', r.access_code,
            'is_archived', r.is_archived
          )
          ORDER BY r.name
        ) FILTER (WHERE r.id IS NOT NULL),
        '[]'::json
      ) AS residencies
    FROM managers m
    LEFT JOIN manager_residencies mr
      ON mr.manager_id = m.id
    LEFT JOIN residencies r
      ON r.id = mr.residency_id
    ${whereSql}
    GROUP BY
      m.id,
      m.full_name,
      m.email,
      m.plan_code,
      m.trial_started_at,
      m.trial_ends_at,
      m.has_used_trial,
      m.trial_notify_7d_sent_at,
      m.trial_notify_1d_sent_at,
      m.trial_expired_notified_at
    ORDER BY m.email
    `,
    params
  );

  return rows;
}

router.get("/me", async (req, res) => {
  return res.json({
    email: req.user.email,
    role: "ADDVISION_ADMIN",
    support_email: SUPPORT_EMAIL
  });
});

router.get("/accounts", async (_req, res) => {
  try {
    const rows = await loadAccountRows();
    return res.json(rows.map(mapAccount));
  } catch (error) {
    console.error("Admin accounts error:", error);
    return res.status(500).json({ error: "Failed to load customer accounts" });
  }
});

router.get("/accounts/:managerId", async (req, res) => {
  try {
    const rows = await loadAccountRows("WHERE m.id = $1", [req.params.managerId]);

    if (rows.length === 0) {
      return res.status(404).json({ error: "Manager account not found" });
    }

    return res.json(mapAccount(rows[0]));
  } catch (error) {
    console.error("Admin account detail error:", error);
    return res.status(500).json({ error: "Failed to load customer account" });
  }
});

router.patch("/accounts/:managerId/status", async (req, res) => {
  const managerId = req.params.managerId;
  const requestedStatus = String(req.body?.status || "").trim().toUpperCase();
  const trialDays = Math.max(1, Math.min(90, Number(req.body?.trial_days) || 30));

  if (!["TRIAL", "PRO", "EXPIRED", "SUSPENDED"].includes(requestedStatus)) {
    return res.status(400).json({
      error: "Status must be TRIAL, PRO, EXPIRED or SUSPENDED"
    });
  }

  try {
    if (requestedStatus === "TRIAL") {
      await pool.query(
        `
        UPDATE managers
        SET
          plan_code = 'FREE',
          trial_started_at = NOW(),
          trial_ends_at = NOW() + ($2::text || ' days')::interval,
          has_used_trial = TRUE,
          trial_notify_7d_sent_at = NULL,
          trial_notify_1d_sent_at = NULL,
          trial_expired_notified_at = NULL
        WHERE id = $1
        `,
        [managerId, trialDays]
      );
    } else if (requestedStatus === "PRO") {
      await pool.query(
        `
        UPDATE managers
        SET plan_code = 'PRO'
        WHERE id = $1
        `,
        [managerId]
      );
    } else if (requestedStatus === "EXPIRED") {
      await pool.query(
        `
        UPDATE managers
        SET
          plan_code = 'FREE',
          has_used_trial = TRUE,
          trial_ends_at = LEAST(
            COALESCE(trial_ends_at, NOW() - INTERVAL '1 second'),
            NOW() - INTERVAL '1 second'
          )
        WHERE id = $1
        `,
        [managerId]
      );
    } else {
      await pool.query(
        `
        UPDATE managers
        SET plan_code = 'SUSPENDED'
        WHERE id = $1
        `,
        [managerId]
      );
    }

    const rows = await loadAccountRows("WHERE m.id = $1", [managerId]);

    if (rows.length === 0) {
      return res.status(404).json({ error: "Manager account not found" });
    }

    return res.json(mapAccount(rows[0]));
  } catch (error) {
    console.error("Admin account status update error:", error);
    return res.status(500).json({
      error: "Failed to update account status",
      detail:
        requestedStatus === "SUSPENDED"
          ? "If plan_code is constrained, allow SUSPENDED before using this state."
          : undefined
    });
  }
});

export default router;
