import express from "express";
import crypto from "crypto";
import pool from "../db.js";
import { authenticateUser } from "../middleware/auth.js";

const router = express.Router();
router.use(authenticateUser);

/* =====================================================
   Helper: Ensure Manager Exists (Auto-Provision)
===================================================== */
async function ensureManager(req) {
  if (!req.user || !req.user.sub) {
    throw new Error("Invalid JWT payload");
  }

  const supabaseUserId = req.user.sub;
  const email = req.user.email || "unknown@example.com";

  const result = await pool.query(
    `SELECT id FROM managers WHERE supabase_user_id = $1`,
    [supabaseUserId]
  );

  if (result.rowCount > 0) {
    return result.rows[0].id;
  }

  const insert = await pool.query(
    `INSERT INTO managers (supabase_user_id, email)
     VALUES ($1, $2)
     RETURNING id`,
    [supabaseUserId, email]
  );

  return insert.rows[0].id;
}

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
    const managerId = await ensureManager(req);

    const result = await pool.query(
      `
      SELECT 
        m.full_name,
        m.email,
        COUNT(mr.residency_id) AS residency_count
      FROM managers m
      LEFT JOIN manager_residencies mr ON mr.manager_id = m.id
      WHERE m.id = $1
      GROUP BY m.id
      `,
      [managerId]
    );

    res.json(result.rows[0] || {});
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
    const managerId = await ensureManager(req);

    const result = await pool.query(
      `
      SELECT r.id, r.name, r.created_at
      FROM manager_residencies mr
      JOIN residencies r ON r.id = mr.residency_id
      WHERE mr.manager_id = $1
      AND r.is_active = true
      ORDER BY r.created_at DESC
      `,
      [managerId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching residencies:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =====================================================
   POST: Add Residency (Transactional)
===================================================== */
router.post("/residencies", async (req, res) => {
  const { name, property_type } = req.body;

  if (!name || !property_type) {
    return res.status(400).json({ error: "Name and property_type required" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const managerId = await ensureManager(req);
    const accessCode = await generateUniqueAccessCode();

    const residencyResult = await client.query(
      `
      INSERT INTO residencies (name, property_type, access_code)
      VALUES ($1, $2, $3)
      RETURNING *
      `,
      [name, property_type, accessCode]
    );

    const residency = residencyResult.rows[0];

    await client.query(
      `INSERT INTO manager_residencies (manager_id, residency_id)
       VALUES ($1, $2)`,
      [managerId, residency.id]
    );

    const templateResult = await client.query(
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
      await client.query(
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

    await client.query("COMMIT");

    res.json({ residency, access_code: accessCode });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error creating residency:", err);
    res.status(500).json({ error: "Server error" });
  } finally {
    client.release();
  }
});

/* =====================================================
   PATCH: Rename Residency
===================================================== */
router.patch("/residencies/:id", async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;

  try {
    const managerId = await ensureManager(req);

    const result = await pool.query(
      `
      UPDATE residencies r
      SET name = $1, updated_at = now()
      FROM manager_residencies mr
      WHERE r.id = mr.residency_id
      AND r.id = $2
      AND mr.manager_id = $3
      RETURNING r.*
      `,
      [name, id, managerId]
    );

    res.json(result.rows[0] || {});
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
    const managerId = await ensureManager(req);

    await pool.query(
      `
      UPDATE residencies r
      SET is_active = false, updated_at = now()
      FROM manager_residencies mr
      WHERE r.id = mr.residency_id
      AND r.id = $1
      AND mr.manager_id = $2
      `,
      [id, managerId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Error deleting residency:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;