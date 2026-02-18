import express from "express";
import pool from "../db.js";
import requireAuth from "../middleware/auth.js";

const router = express.Router();

// 🔐 All manager routes require auth
router.use(requireAuth);

/* =====================================================
   GET: Manager's Residencies
===================================================== */
router.get("/residencies", async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT r.*
      FROM residencies r
      JOIN manager_residencies mr ON mr.residency_id = r.id
      JOIN managers m ON m.id = mr.manager_id
      WHERE m.supabase_user_id = $1
      `,
      [req.user.supabase_user_id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching residencies:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =====================================================
   GET: Maintenance by Residency (Scoped)
===================================================== */
router.get("/residencies/:residencyId/maintenance", async (req, res) => {
  const { residencyId } = req.params;

  try {
    // 1️⃣ Verify manager has access to this residency
    const accessCheck = await pool.query(
      `
      SELECT 1
      FROM manager_residencies mr
      JOIN managers m ON m.id = mr.manager_id
      WHERE m.supabase_user_id = $1
      AND mr.residency_id = $2
      `,
      [req.user.supabase_user_id, residencyId]
    );

    if (accessCheck.rowCount === 0) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // 2️⃣ Fetch maintenance scoped to residency
    const result = await pool.query(
      `
      SELECT 
        m.id,
        m.status,
        m.title,
        m.description,
        m.created_at,
        r.full_name AS resident_name,
        p.unit_number
      FROM maintenance_requests m
      JOIN residents r ON m.resident_id = r.id
      JOIN properties p ON r.property_id = p.id
      WHERE m.residency_id = $1
      ORDER BY m.created_at DESC
      `,
      [residencyId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching maintenance:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =====================================================
   PATCH: Update Maintenance Status (Secure)
===================================================== */
router.patch("/maintenance/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!status) {
    return res.status(400).json({ error: "Status is required" });
  }

  try {
    // Ensure maintenance belongs to a residency manager has access to
    const check = await pool.query(
      `
      SELECT 1
      FROM maintenance_requests mr
      JOIN manager_residencies mres ON mres.residency_id = mr.residency_id
      JOIN managers m ON m.id = mres.manager_id
      WHERE mr.id = $1
      AND m.supabase_user_id = $2
      `,
      [id, req.user.supabase_user_id]
    );

    if (check.rowCount === 0) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const update = await pool.query(
      `
      UPDATE maintenance_requests
      SET status = $1,
          updated_at = now()
      WHERE id = $2
      RETURNING *
      `,
      [status, id]
    );

    res.json(update.rows[0]);
  } catch (err) {
    console.error("Error updating status:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
