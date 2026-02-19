import express from "express";
import crypto from "crypto";
import pool from "../db.js";
import { authenticateUser } from "../middleware/auth.js";

const router = express.Router();

/* =====================================================
   POST: Register Manager (Authenticated)
===================================================== */
router.post("/register-manager", authenticateUser, async (req, res) => {
  try {
    const supabaseUserId = req.user.sub;
    const email = req.user.email;

    const { full_name, residency_name, property_type } = req.body;

    if (!full_name || !residency_name || !property_type) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Prevent duplicate manager
    const existingManager = await pool.query(
      "SELECT id FROM managers WHERE supabase_user_id = $1",
      [supabaseUserId]
    );

    if (existingManager.rowCount > 0) {
      return res.status(400).json({ error: "Manager already exists" });
    }

    /* ===============================
       Create Manager
    =============================== */
    const managerResult = await pool.query(
      `
      INSERT INTO managers (supabase_user_id, full_name, email)
      VALUES ($1, $2, $3)
      RETURNING id
      `,
      [supabaseUserId, full_name, email]
    );

    const managerId = managerResult.rows[0].id;

    /* ===============================
       Generate Access Code
    =============================== */
    const accessCode = crypto.randomBytes(3).toString("hex").toUpperCase();

    /* ===============================
       Create Residency
    =============================== */
    const residencyResult = await pool.query(
      `
      INSERT INTO residencies (name, property_type, access_code)
      VALUES ($1, $2, $3)
      RETURNING id
      `,
      [residency_name, property_type, accessCode]
    );

    const residencyId = residencyResult.rows[0].id;

    /* ===============================
       Link Manager to Residency
    =============================== */
    await pool.query(
      `
      INSERT INTO manager_residencies (manager_id, residency_id)
      VALUES ($1, $2)
      `,
      [managerId, residencyId]
    );

    res.json({ 
      success: true,
      access_code: accessCode  // optional but useful
    });

  } catch (err) {
    console.error("Register manager error:", err);
    res.status(500).json({ error: "Registration failed" });
  }
});

export default router;
