import express from "express";
import pool from "../db.js";
import requireAuth from "../middleware/auth.js";

const router = express.Router();

router.use(requireAuth);

// GET manager residencies
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
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
// GET maintenance for a specific residency
router.get("/residencies/:residencyId/maintenance", async (req, res) => {
  const { residencyId } = req.params;

  try {
    // 1️⃣ Verify manager has access to this residency
    const accessCheck = await pool.query(
      `
      SELECT 1
      FROM manager_residencies
      WHERE manager_id = (
        SELECT id FROM managers WHERE supabase_user_id = $1
      )
      AND residency_id = $2
      `,
      [req.user.supabase_user_id, residencyId]
    );

    if (accessCheck.rowCount === 0) {
      return res.status(403).json({ error: "Access denied" });
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
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});
