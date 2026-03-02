import pool from "../db.js";

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

    // Get internal manager id
    const managerResult = await pool.query(
      `SELECT id FROM managers WHERE supabase_user_id = $1 LIMIT 1`,
      [req.user.id]
    );

    if (managerResult.rows.length === 0) {
      return res.status(403).json({ error: "Manager not found" });
    }

    const managerId = managerResult.rows[0].id;

    // Verify manager linked to residency
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

    // Attach for downstream use
    req.managerDbId = managerId;
    req.residencyId = residencyId;

    next();
  } catch (error) {
    console.error("Residency scope middleware error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}