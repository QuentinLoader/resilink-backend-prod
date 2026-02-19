import express from "express";
import pool from "../db.js";
import { authenticateUser } from "../middleware/auth.js";

const router = express.Router();

// 🔐 All manager routes require auth
router.use(authenticateUser);

/* =====================================================
   GET: Residencies Assigned to Manager
===================================================== */
router.get("/residencies", async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT 
        r.id,
        r.name,
        r.created_at
      FROM manager_residencies mr
      JOIN managers m ON m.id = mr.manager_id
      JOIN residencies r ON r.id = mr.residency_id
      WHERE m.supabase_user_id = $1
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
   GET: Maintenance by Residency (Scoped Properly)
===================================================== */
router.get("/residencies/:residencyId/maintenance", async (req, res) => {
  const { residencyId } = req.params;
  const { status } = req.query;

  try {
    // 🔐 Ensure manager has access to this residency
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

    // 🔥 Proper relational scoping via properties
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
   PATCH: Update Maintenance Status (Secure)
===================================================== */
router.patch("/maintenance/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!status) {
    return res.status(400).json({ error: "Status is required" });
  }

  try {
    const check = await pool.query(
      `
      SELECT 1
      FROM maintenance_requests mr
      JOIN residents r ON mr.resident_id = r.id
      JOIN properties p ON r.property_id = p.id
      JOIN manager_residencies mres ON mres.residency_id = p.residency_id
      JOIN managers m ON m.id = mres.manager_id
      WHERE mr.id = $1
      AND m.supabase_user_id = $2
      `,
      [id, req.user.sub]
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

/* =====================================================
   GET: Residency Template (Scoped)
===================================================== */
router.get("/residencies/:residencyId/template", async (req, res) => {
  const { residencyId } = req.params;

  try {
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
      `
      SELECT id
      FROM residency_templates
      WHERE residency_id = $1
      `,
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

/* =====================================================
   PATCH: Update Template Item
===================================================== */
router.patch("/template-items/:id", async (req, res) => {
  const { id } = req.params;
  const { label, content } = req.body;

  if (!label || !content) {
    return res.status(400).json({ error: "Label and content required" });
  }

  try {
    const result = await pool.query(
      `
      UPDATE residency_template_items
      SET label = $1,
          content = $2,
          updated_at = now()
      WHERE id = $3
      RETURNING *
      `,
      [label, content, id]
    );

    res.json(result.rows[0]);

  } catch (err) {
    console.error("Error updating template item:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
