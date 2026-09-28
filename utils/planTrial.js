import pool from "../config/db.js";

export const SUPPORT_EMAIL =
  process.env.SUPPORT_EMAIL || "support@addvision.co.za";

export const ADDVISION_ADMIN_EMAIL =
  (process.env.ADDVISION_ADMIN_EMAIL || "quentin@addvision.co.za").toLowerCase();

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

export function deriveManagerAccessState({ planCode, trialEndsAt }) {
  const normalizedPlan = String(planCode || "").toUpperCase();

  if (normalizedPlan === "SUSPENDED") {
    return "SUSPENDED";
  }

  if (normalizedPlan === "PRO") {
    return "PRO";
  }

  if (isTrialActive(trialEndsAt)) {
    return "TRIAL";
  }

  return "EXPIRED";
}

export function hasOperationalAccess(accessState) {
  return accessState === "TRIAL" || accessState === "PRO";
}

export function buildManagerFeatures({ planCode, trialActive, accessState }) {
  const state =
    accessState ||
    deriveManagerAccessState({
      planCode,
      trialEndsAt: trialActive ? new Date(Date.now() + 60_000) : null
    });

  const enabled = hasOperationalAccess(state);

  return {
    can_create_multiple_residencies: enabled,
    can_manage_maintenance_workflow: enabled,
    can_assign_artisans: enabled,
    can_schedule_maintenance: enabled,
    can_send_notifications: enabled,
    can_remove_branding: enabled,
    can_use_resident_portal: enabled,
    can_use_knowledge_base: enabled
  };
}

export async function startManagerTrialIfEligible(managerId, client = pool) {
  if (!managerId) return null;

  const result = await client.query(
    `
    UPDATE managers
    SET
      plan_code = CASE
        WHEN UPPER(COALESCE(plan_code, '')) = 'PRO' THEN plan_code
        ELSE 'FREE'
      END,
      trial_started_at = NOW(),
      trial_ends_at = NOW() + INTERVAL '30 days',
      has_used_trial = TRUE,
      trial_notify_7d_sent_at = NULL,
      trial_notify_1d_sent_at = NULL,
      trial_expired_notified_at = NULL
    WHERE id = $1
      AND has_used_trial = FALSE
      AND UPPER(COALESCE(plan_code, '')) <> 'PRO'
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
      m.email,
      m.full_name,
      m.plan_code,
      m.trial_started_at,
      m.trial_ends_at,
      m.has_used_trial,
      COUNT(mr.residency_id)::int AS residency_count
    FROM managers m
    LEFT JOIN manager_residencies mr
      ON mr.manager_id = m.id
    WHERE m.supabase_user_id = $1
    GROUP BY
      m.id,
      m.email,
      m.full_name,
      m.plan_code,
      m.trial_started_at,
      m.trial_ends_at,
      m.has_used_trial
    LIMIT 1
    `,
    [supabaseUserId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const manager = result.rows[0];
  const trialActive = isTrialActive(manager.trial_ends_at);
  const accessState = deriveManagerAccessState({
    planCode: manager.plan_code,
    trialEndsAt: manager.trial_ends_at
  });
  const daysRemaining =
    accessState === "TRIAL"
      ? calculateDaysRemaining(manager.trial_ends_at)
      : accessState === "EXPIRED"
        ? 0
        : null;

  const features = buildManagerFeatures({
    planCode: manager.plan_code,
    trialActive,
    accessState
  });

  return {
    manager_id: manager.id,
    email: manager.email,
    full_name: manager.full_name,
    plan: accessState === "PRO" ? "Pro" : accessState === "TRIAL" ? "Trial" : accessState,
    plan_code: manager.plan_code,
    access_state: accessState,
    operational_access: hasOperationalAccess(accessState),
    trial_started_at: manager.trial_started_at,
    trial_ends_at: manager.trial_ends_at,
    has_used_trial: manager.has_used_trial,
    trial_active: accessState === "TRIAL",
    days_remaining: daysRemaining,
    residency_count: manager.residency_count,
    support_email: SUPPORT_EMAIL,
    features
  };
}

export async function getResidencyAccessState(residencyId, client = pool) {
  if (!residencyId) {
    return {
      operational_access: false,
      access_state: "EXPIRED"
    };
  }

  const result = await client.query(
    `
    SELECT
      m.plan_code,
      m.trial_ends_at
    FROM manager_residencies mr
    JOIN managers m
      ON m.id = mr.manager_id
    WHERE mr.residency_id = $1
    `,
    [residencyId]
  );

  if (result.rows.length === 0) {
    return {
      operational_access: false,
      access_state: "EXPIRED"
    };
  }

  const states = result.rows.map((row) =>
    deriveManagerAccessState({
      planCode: row.plan_code,
      trialEndsAt: row.trial_ends_at
    })
  );

  if (states.includes("PRO")) {
    return { operational_access: true, access_state: "PRO" };
  }

  if (states.includes("TRIAL")) {
    return { operational_access: true, access_state: "TRIAL" };
  }

  if (states.every((state) => state === "SUSPENDED")) {
    return { operational_access: false, access_state: "SUSPENDED" };
  }

  return { operational_access: false, access_state: "EXPIRED" };
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

  if (!account.operational_access || !account.features?.[featureKey]) {
    return {
      ok: false,
      status: 403,
      body: {
        error: "ACCOUNT_ACCESS_REQUIRED",
        access_state: account.access_state,
        feature: featureKey,
        trial_ends_at: account.trial_ends_at,
        support_email: SUPPORT_EMAIL
      }
    };
  }

  return {
    ok: true,
    account
  };
}
