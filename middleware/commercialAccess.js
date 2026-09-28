import {
  ADDVISION_ADMIN_EMAIL,
  SUPPORT_EMAIL,
  getManagerAccountStateBySupabaseUserId,
  getResidencyAccessState
} from "../utils/planTrial.js";

export async function requireManagerOperationalAccess(req, res, next) {
  try {
    const account = await getManagerAccountStateBySupabaseUserId(req.user?.id);

    if (!account) {
      return res.status(404).json({ error: "Manager not found" });
    }

    if (!account.operational_access) {
      return res.status(403).json({
        error: "ACCOUNT_ACCESS_REQUIRED",
        access_state: account.access_state,
        trial_ends_at: account.trial_ends_at,
        support_email: SUPPORT_EMAIL
      });
    }

    req.managerAccount = account;
    next();
  } catch (error) {
    console.error("Manager operational access check failed:", error);
    return res.status(500).json({ error: "Failed to verify account access" });
  }
}

export function requireAddVisionAdmin(req, res, next) {
  const email = String(req.user?.email || "").trim().toLowerCase();

  if (!email || email !== ADDVISION_ADMIN_EMAIL) {
    return res.status(403).json({ error: "AddVision administrator access required" });
  }

  next();
}

export async function requireResidencyOperationalAccess(
  residencyId,
  res,
  client
) {
  const access = await getResidencyAccessState(residencyId, client);

  if (!access.operational_access) {
    res.status(403).json({
      error: "RESIDENT_PORTAL_PAUSED",
      access_state: access.access_state,
      support_email: SUPPORT_EMAIL
    });
    return false;
  }

  return true;
}
