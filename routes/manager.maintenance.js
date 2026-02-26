import express from "express";
import pool from "../db.js";
import { authenticateUser } from "../middleware/auth.js";

const router = express.Router();

/* ===============================
   Helper: Get internal manager ID
================================ */
async function getManagerDbId(supabaseUserId) {
  const result = await pool.query(
    `SELECT id FROM managers WHERE supabase_user_id = $1 LIMIT 1`,
    [supabaseUserId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0].id;
}

/* ===============================
   GET ALL MAINTENANCE
   GET /api/manager/maintenance
================================ */
router.get("/", authenticateUser, async (req, res) => {
  try {
    const managerDbId = await getManagerDbId(req.user.id);

    if (!managerDbId) {
      return res.status(404).json({ error: "Manager not found" });
    }

    const { status } = req.query;

    let query = `
      SELECT m.*
      FROM maintenance_requests m
      JOIN manager_residencies mr
        ON mr.residency_id = m.residency_id
      WHERE mr.manager_id = $1
    `;

    const params = [managerDbId];

    if (status) {
      query += ` AND m.status = $2`;
      params.push(status);
    }

    query += ` ORDER BY m.created_at DESC`;

    const { rows } = await pool.query(query, params);

    res.json(rows);
  } catch (error) {
    console.error("Get maintenance error:", error);
    res.status(500).json({ error: "Failed to fetch maintenance" });
  }
});

/* ===============================
   GET MAINTENANCE FOR ONE RESIDENCY
   GET /api/manager/residencies/:residencyId/maintenance
================================ */
router.get(
  "/residencies/:residencyId/maintenance",
  authenticateUser,
  async (req, res) => {
    try {
      const { residencyId } = req.params;

      const managerDbId = await getManagerDbId(req.user.id);

      if (!managerDbId) {
        return res.status(404).json({ error: "Manager not found" });
      }

      const { rows } = await pool.query(
        `
        SELECT m.*
        FROM maintenance_requests m
        JOIN manager_residencies mr
          ON mr.residency_id = m.residency_id
        WHERE mr.manager_id = $1
          AND m.residency_id = $2
        ORDER BY m.created_at DESC;
        `,
        [managerDbId, residencyId]
      );

      res.json(rows);
    } catch (error) {
      console.error("Get residency maintenance error:", error);
      res.status(500).json({ error: "Failed to fetch maintenance" });
    }
  }
);

export default router;