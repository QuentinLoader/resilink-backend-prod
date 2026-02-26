import express from "express";
import pool from "../db.js";
import { authenticateUser } from "../middleware/auth.js";

const router = express.Router();

/* ===============================
   Allowed Status Transitions
================================ */
const allowedTransitions = {
  pending: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

/* ===============================
   Helper: Get internal manager ID
================================ */
async function getManagerDbId(supabaseUserId) {
  const result = await pool.query(
    `SELECT id FROM managers WHERE supabase_user_id = $1 LIMIT 1`,
    [supabaseUserId]
  );

  if (result.rows.length === 0) return null;
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
      SELECT 
        m.id,
        m.status,
        m.priority,
        m.title,
        m.description,
        m.created_at,
        r.full_name AS resident_name,
        r.unit_number
      FROM maintenance_requests m
      JOIN manager_residencies mr
        ON mr.residency_id = m.residency_id
      LEFT JOIN residents r
        ON r.id = m.resident_id
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
        SELECT 
          m.id,
          m.status,
          m.priority,
          m.title,
          m.description,
          m.created_at,
          r.full_name AS resident_name,
          r.unit_number
        FROM maintenance_requests m
        JOIN manager_residencies mr
          ON mr.residency_id = m.residency_id
        LEFT JOIN residents r
          ON r.id = m.resident_id
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

/* ===============================
   UPDATE STATUS
   PUT /api/manager/maintenance/:id/status
================================ */
router.put("/:id/status", authenticateUser, async (req, res) => {
  try {
    const managerDbId = await getManagerDbId(req.user.id);
    if (!managerDbId) {
      return res.status(404).json({ error: "Manager not found" });
    }

    const { id } = req.params;
    const { status: newStatus } = req.body;

    if (!newStatus) {
      return res.status(400).json({ error: "Status required" });
    }

    const existing = await pool.query(
      `
      SELECT m.*
      FROM maintenance_requests m
      JOIN manager_residencies mr
        ON mr.residency_id = m.residency_id
      WHERE m.id = $1
        AND mr.manager_id = $2
      LIMIT 1;
      `,
      [id, managerDbId]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Maintenance not found" });
    }

    const currentStatus = existing.rows[0].status;

    if (!allowedTransitions[currentStatus].includes(newStatus)) {
      return res.status(400).json({
        error: `Invalid transition from ${currentStatus} to ${newStatus}`,
      });
    }

    const updated = await pool.query(
      `
      UPDATE maintenance_requests
      SET status = $1,
          updated_at = NOW()
      WHERE id = $2
      RETURNING *;
      `,
      [newStatus, id]
    );

    res.json(updated.rows[0]);
  } catch (error) {
    console.error("Update status error:", error);
    res.status(500).json({ error: "Failed to update status" });
  }
});

export default router;