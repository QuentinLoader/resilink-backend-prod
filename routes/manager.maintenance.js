import express from "express";
import pool from "../db.js";
import { authenticateUser } from "../middleware/auth.js";

const router = express.Router();

/**
 * Allowed status transitions
 */
const allowedTransitions = {
  pending: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

/**
 * GET /api/manager/maintenance
 * Optional: ?status=pending
 */
router.get("/", authenticateUser, async (req, res) => {
  try {
    const managerId = req.user.id;
    const { status } = req.query;

    let query = `
      SELECT m.*
      FROM maintenance_requests m
      JOIN manager_residencies mr
        ON mr.residency_id = m.residency_id
      WHERE mr.manager_id = $1
    `;

    const values = [managerId];

    if (status) {
      query += ` AND m.status = $2`;
      values.push(status);
    }

    query += ` ORDER BY m.created_at DESC`;

    const { rows } = await pool.query(query, values);

    return res.json(rows);
  } catch (error) {
    console.error("GET maintenance error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * PUT /api/manager/maintenance/:id/status
 */
router.put("/:id/status", authenticateUser, async (req, res) => {
  try {
    const managerId = req.user.id;
    const { id } = req.params;
    const { status: newStatus } = req.body;

    if (!newStatus) {
      return res.status(400).json({ error: "Status is required" });
    }

    // 1️⃣ Fetch maintenance + enforce residency isolation
    const maintenanceQuery = `
      SELECT m.*
      FROM maintenance_requests m
      JOIN manager_residencies mr
        ON mr.residency_id = m.residency_id
      WHERE m.id = $1
        AND mr.manager_id = $2
      LIMIT 1
    `;

    const { rows } = await pool.query(maintenanceQuery, [id, managerId]);

    if (rows.length === 0) {
      return res.status(404).json({ error: "Maintenance not found" });
    }

    const maintenance = rows[0];

    const currentStatus = maintenance.status;

    // 2️⃣ Validate allowed transition
    if (!allowedTransitions[currentStatus].includes(newStatus)) {
      return res.status(400).json({
        error: `Invalid status transition from '${currentStatus}' to '${newStatus}'`,
      });
    }

    // 3️⃣ Update
    const updateQuery = `
      UPDATE maintenance_requests
      SET status = $1,
          updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `;

    const updated = await pool.query(updateQuery, [newStatus, id]);

    return res.json(updated.rows[0]);
  } catch (error) {
    console.error("Update maintenance status error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;