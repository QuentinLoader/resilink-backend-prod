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
