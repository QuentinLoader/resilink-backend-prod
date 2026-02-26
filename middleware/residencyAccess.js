
import db from "../db.js";

export default async function requireResidencyAccess(req, res, next) {
  const { residency_id } = req.params;
  const supabase_user_id = req.user.sub;

  if (!residency_id) {
    return res.status(400).json({ error: "Missing residency_id" });
  }

  try {
    const result = await db.query(
      `
      SELECT 1
      FROM managers m
      JOIN manager_residencies mr
        ON mr.manager_id = m.id
      WHERE m.supabase_user_id = $1
      AND mr.residency_id = $2
      `,
      [supabase_user_id, residency_id]
    );

    if (result.rowCount === 0) {
      return res.status(403).json({ error: "Forbidden" });
    }

    next();
  } catch (error) {
    console.error("Residency access check failed:", error);
    return res.status(500).json({ error: "Server error" });
  }
}
