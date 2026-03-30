import pool from "../config/db.js";

function calculateDaysRemaining(trialEndsAt) {
  if (!trialEndsAt) return null;

  const now = new Date();
  const end = new Date(trialEndsAt);

  if (Number.isNaN(end.getTime()) || end <= now) {
    return 0;
  }

  return Math.max(
    0,
    Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  );
}

export function isTrialActive(trialEndsAt) {
  if (!trialEndsAt) return false;

  const end = new Date(trialEndsAt);
  if (Number.isNaN(end.getTime())) return false;

  return end > new Date();
}

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

export async function getManagerSubscriptionBySupabaseUserId(
  supabaseUserId,
  client = pool
) {
  if (!supabaseUserId) return null;

  const result = await client.query(
    `
    SELECT
      id,
      plan_code,
      trial_started_at,
      trial_ends_at,
      has_used_trial
    FROM managers
    WHERE supabase_user_id = $1
    LIMIT 1
    `,
    [supabaseUserId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const manager = result.rows[0];
  const trialActive = isTrialActive(manager.trial_ends_at);
  const daysRemaining = trialActive
    ? calculateDaysRemaining(manager.trial_ends_at)
    : null;

  let plan = "Free";

  if (manager.plan_code === "PRO") {
    plan = "Pro";
  } else if (trialActive) {
    plan = "Trial";
  }

  return {
    manager_id: manager.id,
    plan,
    plan_code: manager.plan_code,
    trial_started_at: manager.trial_started_at,
    trial_ends_at: manager.trial_ends_at,
    has_used_trial: manager.has_used_trial,
    trial_active: trialActive,
    days_remaining: daysRemaining
  };
}