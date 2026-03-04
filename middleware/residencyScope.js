import pool from "../config/db.js";

/* =====================================================
   MANAGER RESIDENCY PARAM ENFORCEMENT
   Used for routes with :residencyId
===================================================== */

export async function enforceManagerResidencyParam(req, res, next) {
  try {
    const { residencyId } = req.params;

    if (!residencyId) {
      return res.status(400).json({ error: "Missing residencyId" });
    }

    // 1️⃣ Get internal manager ID
    const managerResult = await pool.query(
      `SELECT id, subscription_status 
       FROM managers 
       WHERE supabase_user_id = $1 
       LIMIT 1`,
      [req.user.id]
    );

    if (managerResult.rows.length === 0) {
      return res.status(403).json({ error: "Manager not found" });
    }

    const manager = managerResult.rows[0];
    const managerId = manager.id;

    // 2️⃣ Enforce manager subscription status
    if (manager.subscription_status !== "active") {
      return res.status(403).json({
        error: "Your subscription is inactive.",
      });
    }

    // 3️⃣ Check manager linked to residency
    const accessResult = await pool.query(
      `
      SELECT 1
      FROM manager_residencies
      WHERE manager_id = $1
        AND residency_id = $2
      LIMIT 1
      `,
      [managerId, residencyId]
    );

    if (accessResult.rows.length === 0) {
      return res.status(403).json({ error: "Access denied" });
    }

    // 4️⃣ Check residency is active
    const activeCheck = await pool.query(
      `SELECT is_active 
       FROM residencies 
       WHERE id = $1 
       LIMIT 1`,
      [residencyId]
    );

    if (!activeCheck.rows[0]?.is_active) {
      return res.status(403).json({
        error: "This residency is currently inactive.",
      });
    }

    // Attach to request
    req.managerDbId = managerId;
    req.residencyId = residencyId;

    next();
  } catch (error) {
    console.error("Residency scope middleware error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}