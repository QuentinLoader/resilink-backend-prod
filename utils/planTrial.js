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

export function buildManagerFeatures({ planCode, trialActive }) {
  const isPaid = planCode === "PRO";
  const hasMaintenanceProAccess = isPaid || trialActive;

  return {
    can_create_multiple_residencies: isPaid,
    can_manage_maintenance_workflow: hasMaintenanceProAccess,
    can_assign_artisans: hasMaintenanceProAccess,
    can_schedule_maintenance: hasMaintenanceProAccess,
    can_send_notifications: isPaid,
    can_remove_branding: isPaid
  };
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

export async function getManagerAccountStateBySupabaseUserId(
  supabaseUserId,
  client = pool
) {
  if (!supabaseUserId) return null;

  const result = await client.query(
    `
    SELECT
      m.id,
      m.plan_code,
      m.trial_started_at,
      m.trial_ends_at,
      m.has_used_trial,
      COUNT(mr.residency_id)::int AS residency_count
    FROM managers m
    LEFT JOIN manager_residencies mr
      ON mr.manager_id = m.id
    WHERE m.supabase_user_id = $1
    GROUP BY m.id, m.plan_code, m.trial_started_at, m.trial_ends_at, m.has_used_trial
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

  const features = buildManagerFeatures({
    planCode: manager.plan_code,
    trialActive
  });

  return {
    manager_id: manager.id,
    plan,
    plan_code: manager.plan_code,
    trial_started_at: manager.trial_started_at,
    trial_ends_at: manager.trial_ends_at,
    has_used_trial: manager.has_used_trial,
    trial_active: trialActive,
    days_remaining: daysRemaining,
    residency_count: manager.residency_count,
    features
  };
}

export async function requireManagerFeature(
  supabaseUserId,
  featureKey,
  client = pool
) {
  const account = await getManagerAccountStateBySupabaseUserId(
    supabaseUserId,
    client
  );

  if (!account) {
    return {
      ok: false,
      status: 404,
      body: { error: "Manager not found" }
    };
  }

  if (!account.features?.[featureKey]) {
    return {
      ok: false,
      status: 403,
      body: {
        error: "PLAN_UPGRADE_REQUIRED",
        feature: featureKey,
        plan: account.plan,
        trial_active: account.trial_active,
        trial_ends_at: account.trial_ends_at
      }
    };
  }

  return {
    ok: true,
    account
  };
}