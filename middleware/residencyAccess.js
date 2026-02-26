import pool from "../db.js";

export default async function residencyAccess(req, res, next) {
  const { residencyId } = req.params;

  if (!residencyId) {
    return res.status(400).json({ error: "Missing residencyId" });
  }

  try {
    const supabaseUserId = req.user.sub;

    // Step 1: Get internal manager ID
    const managerResult = await pool.query(
      `
      SELECT id
      FROM managers
      WHERE supabase_user_id = $1
      LIMIT 1;
      `,
      [supabaseUserId]
    );

    if (managerResult.rows.length === 0) {
      return res.status(403).json({ error: "Manager not found" });
    }

    const managerId = managerResult.rows[0].id;

    // Step 2: Check residency access
    const accessResult = await pool.query(
      `
      SELECT 1
      FROM manager_residencies
      WHERE manager_id = $1
      AND residency_id = $2
      LIMIT 1;
      `,
      [managerId, residencyId]
    );

    if (accessResult.rows.length === 0) {
      return res.status(403).json({ error: "Access denied" });
    }

    next();
  } catch (error) {
    console.error("Residency access check failed:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}