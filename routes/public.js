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

    const existingManager = await pool.query(
      "SELECT id FROM managers WHERE supabase_user_id = $1",
      [supabaseUserId]
    );

    if (existingManager.rowCount > 0) {
      return res.status(400).json({ error: "Manager already exists" });
    }

    const managerResult = await pool.query(
      `
      INSERT INTO managers (supabase_user_id, full_name, email)
      VALUES ($1, $2, $3)
      RETURNING id
      `,
      [supabaseUserId, full_name, email]
    );

    const managerId = managerResult.rows[0].id;

    const accessCode = crypto.randomBytes(3).toString("hex").toUpperCase();

    const residencyResult = await pool.query(
      `
      INSERT INTO residencies (name, property_type, access_code)
      VALUES ($1, $2, $3)
      RETURNING id
      `,
      [residency_name, property_type, accessCode]
    );

    const residencyId = residencyResult.rows[0].id;

    await pool.query(
      `
      INSERT INTO manager_residencies (manager_id, residency_id)
      VALUES ($1, $2)
      `,
      [managerId, residencyId]
    );

    // 🔹 Auto-create template
    await pool.query(
      `
      INSERT INTO residency_templates (residency_id)
      VALUES ($1)
      `,
      [residencyId]
    );

    res.json({
      success: true,
      access_code: accessCode
    });

  } catch (err) {
    console.error("Register manager error:", err);
    res.status(500).json({ error: "Registration failed" });
  }
});

/* =====================================================
   GET: Template by Access Code (Bot)
===================================================== */
router.get("/template/:accessCode", async (req, res) => {
  const { accessCode } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT rt.id
      FROM residencies r
      JOIN residency_templates rt ON rt.residency_id = r.id
      WHERE r.access_code = $1
      `,
      [accessCode]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Invalid access code" });
    }

    const templateId = result.rows[0].id;

    const items = await pool.query(
      `
      SELECT category, label, content
      FROM residency_template_items
      WHERE template_id = $1
      ORDER BY category, sort_order
      `,
      [templateId]
    );

    res.json(items.rows);

  } catch (err) {
    console.error("Error fetching public template:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
