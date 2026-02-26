import express from "express";
import pool from "../db.js";
import { authenticateUser } from "../middleware/auth.js";

const router = express.Router();

/* ===============================
   GET MANAGER RESIDENCIES
   GET /api/manager/residencies
================================ */
router.get("/residencies", authenticateUser, async (req, res) => {
  try {
    const supabaseUserId = req.user.id;

    // 1️⃣ Get internal manager id
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
      return res.status(404).json({ error: "Manager not found" });
    }

    const managerDbId = managerResult.rows[0].id;

    // 2️⃣ Fetch residencies linked to manager
    const residenciesResult = await pool.query(
      `
      SELECT r.*
      FROM residencies r
      JOIN manager_residencies mr
        ON mr.residency_id = r.id
      WHERE mr.manager_id = $1
      ORDER BY r.created_at DESC;
      `,
      [managerDbId]
    );

    return res.json(residenciesResult.rows);
  } catch (error) {
    console.error("Get manager residencies error:", error);
    return res.status(500).json({ error: "Failed to fetch residencies" });
  }
});

export default router;