import pool from "../config/db.js";

export async function startManagerTrialIfEligible(managerId, client = pool) {
  if (!managerId) return null;

  const result = await client.query(
    `
    UPDATE managers
    SET
      trial_started_at = NOW(),
      trial_ends_at = NOW() + INTERVAL '30 days',
      has_used_trial = TRUE
    WHERE id = $1
      AND has_used_trial = FALSE
    RETURNING id, trial_started_at, trial_ends_at
    `,
    [managerId]
  );

  return result.rows[0] || null;
}