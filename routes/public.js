import express from "express";
import crypto from "crypto";
import pool from "../db.js";
import { authenticateUser } from "../middleware/auth.js";

const router = express.Router();

/* =====================================================
   Helper: Generate Unique Access Code
===================================================== */
async function generateUniqueAccessCode() {
  let accessCode;
  let exists = true;

  while (exists) {
    accessCode = crypto.randomBytes(3).toString("hex").toUpperCase();

    const check = await pool.query(
      `SELECT 1 FROM residencies WHERE access_code = $1`,
      [accessCode]
    );

    exists = check.rowCount > 0;
  }

  return accessCode;
}

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
      `SELECT id FROM managers WHERE supabase_user_id = $1`,
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
       Generate Unique Access Code
    =============================== */
    const accessCode = await generateUniqueAccessCode();

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

    /* ===============================
       Create Template
    =============================== */
    const templateResult = await pool.query(
      `
      INSERT INTO residency_templates (residency_id)
      VALUES ($1)
      RETURNING id
      `,
      [residencyId]
    );

    const templateId = templateResult.rows[0].id;

    /* ===============================
       Seed Default Template Items
    =============================== */
    const defaultItems = [
      ["Utilities", "Electricity Provider"],
      ["Emergency Contacts", "Security Contact"],
      ["Rules", "Quiet Hours"],
      ["Amenities", "Pool Hours"],
      ["Security", "Access Procedure"],
      ["General Info", "Waste Collection"]
    ];

    for (let i = 0; i < defaultItems.length; i++) {
      await pool.query(
        `
        INSERT INTO residency_template_items
        (template_id, category, label, content, sort_order)
        VALUES ($1, $2, $3, $4, $5)
        `,
        [
          templateId,
          defaultItems[i][0],
          defaultItems[i][1],
          "Enter details here.",
          i + 1
        ]
      );
    }

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
   GET: Template by Access Code (Public/Bot)
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
