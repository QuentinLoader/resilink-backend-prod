import pool from "../db.js";

export default async function residencyAccess(req, res, next) {
  const { residencyId } = req.params;

  if (!residencyId) {
    return res.status(400).json({ error: "Missing residencyId" });
  }

  try {
    const managerSupabaseId = req.user.sub;

    const { rows } = await pool.query(
      `
      SELECT 1
      FROM manager_residencies
      WHERE manager_id = $1
      AND residency_id = $2
      LIMIT 1;
      `,
      [managerSupabaseId, residencyId]
    );

    if (rows.length === 0) {
      return res.status(403).json({ error: "Access denied" });
    }

    next();
  } catch (error) {
    console.error("Residency access check failed:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}