import express from "express";
import crypto from "crypto";
import pool from "../db.js";
import { authenticateUser } from "../middleware/auth.js";

const router = express.Router();
router.use(authenticateUser);

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
   GET: Manager Profile
===================================================== */
router.get("/me", async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT 
        m.full_name,
        m.email,
        COUNT(mr.residency_id) AS residency_count
      FROM managers m
      LEFT JOIN manager_residencies mr ON mr.manager_id = m.id
      WHERE m.supabase_user_id = $1
      GROUP BY m.id
      `,
      [req.user.sub]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error fetching manager profile:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =====================================================
   GET: Residencies
===================================================== */
router.get("/residencies", async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT r.id, r.name, r.created_at
      FROM manager_residencies mr
      JOIN managers m ON m.id = mr.manager_id
      JOIN residencies r ON r.id = mr.residency_id
      WHERE m.supabase_user_id = $1
      AND r.is_active = true
      ORDER BY r.created_at DESC
      `,
      [req.user.sub]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching residencies:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =====================================================
   POST: Add Residency
===================================================== */
router.post("/residencies", async (req, res) => {
  const { name, property_type } = req.body;

  if (!name || !property_type) {
    return res.status(400).json({ error: "Name and property_type required" });
  }

  try {
    const managerResult = await pool.query(
      `SELECT id FROM managers WHERE supabase_user_id = $1`,
      [req.user.sub]
    );

    const managerId = managerResult.rows[0].id;
    const accessCode = await generateUniqueAccessCode();

    const residencyResult = await pool.query(
      `
      INSERT INTO residencies (name, property_type, access_code)
      VALUES ($1, $2, $3)
      RETURNING *
      `,
      [name, property_type, accessCode]
    );

    const residency = residencyResult.rows[0];

    await pool.query(
      `INSERT INTO manager_residencies (manager_id, residency_id)
       VALUES ($1, $2)`,
      [managerId, residency.id]
    );

    const templateResult = await pool.query(
      `INSERT INTO residency_templates (residency_id)
       VALUES ($1)
       RETURNING id`,
      [residency.id]
    );

    const templateId = templateResult.rows[0].id;

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
        [templateId, defaultItems[i][0], defaultItems[i][1], "Enter details here.", i + 1]
      );
    }

    res.json({ residency, access_code: accessCode });

  } catch (err) {
    console.error("Error creating residency:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =====================================================
   PATCH: Rename Residency
===================================================== */
router.patch("/residencies/:id", async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;

  try {
    const result = await pool.query(
      `
      UPDATE residencies r
      SET name = $1, updated_at = now()
      FROM manager_residencies mr
      JOIN managers m ON m.id = mr.manager_id
      WHERE r.id = mr.residency_id
      AND r.id = $2
      AND m.supabase_user_id = $3
      RETURNING r.*
      `,
      [name, id, req.user.sub]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error renaming residency:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =====================================================
   DELETE: Soft Delete Residency
===================================================== */
router.delete("/residencies/:id", async (req, res) => {
  const { id } = req.params;

  try {
    await pool.query(
      `
      UPDATE residencies r
      SET is_active = false, updated_at = now()
      FROM manager_residencies mr
      JOIN managers m ON m.id = mr.manager_id
      WHERE r.id = mr.residency_id
      AND r.id = $1
      AND m.supabase_user_id = $2
      `,
      [id, req.user.sub]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Error deleting residency:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =====================================================
   GET: Maintenance
===================================================== */
router.get("/residencies/:residencyId/maintenance", async (req, res) => {
  const { residencyId } = req.params;
  const { status } = req.query;

  try {
    let query = `
      SELECT 
        m.id,
        m.status,
        m.title,
        m.description,
        m.created_at,
        r.full_name AS resident_name,
        r.unit_number
      FROM maintenance_requests m
      JOIN residents r ON m.resident_id = r.id
      JOIN properties p ON r.property_id = p.id
      WHERE p.residency_id = $1
    `;

    const values = [residencyId];

    if (status) {
      query += ` AND m.status = $2`;
      values.push(status);
    }

    query += ` ORDER BY m.created_at DESC`;

    const result = await pool.query(query, values);
    res.json(result.rows);

  } catch (err) {
    console.error("Error fetching maintenance:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =====================================================
   GET: Residency Template
===================================================== */
router.get("/residencies/:residencyId/template", async (req, res) => {
  const { residencyId } = req.params;

  try {
    // Ensure manager has access
    const accessCheck = await pool.query(
      `
      SELECT 1
      FROM manager_residencies mr
      JOIN managers m ON m.id = mr.manager_id
      WHERE m.supabase_user_id = $1
      AND mr.residency_id = $2
      `,
      [req.user.sub, residencyId]
    );

    if (accessCheck.rowCount === 0) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const templateResult = await pool.query(
      `SELECT id FROM residency_templates WHERE residency_id = $1`,
      [residencyId]
    );

    if (templateResult.rowCount === 0) {
      return res.json({});
    }

    const templateId = templateResult.rows[0].id;

    const items = await pool.query(
      `
      SELECT id, category, label, content, sort_order
      FROM residency_template_items
      WHERE template_id = $1
      ORDER BY category, sort_order
      `,
      [templateId]
    );

    const grouped = items.rows.reduce((acc, item) => {
      if (!acc[item.category]) acc[item.category] = [];
      acc[item.category].push(item);
      return acc;
    }, {});

    res.json(grouped);

  } catch (err) {
    console.error("Error fetching template:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
