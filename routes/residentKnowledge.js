import express from "express";
import pool from "../config/db.js";

export const router = express.Router();

/* =========================================================
   HELPER: Resolve accessCode → residency_id
========================================================= */
async function getResidencyIdFromAccessCode(accessCode) {
  const result = await pool.query(
    `SELECT id FROM residencies WHERE access_code = $1 LIMIT 1`,
    [accessCode]
  );

  if (result.rows.length === 0) return null;
  return result.rows[0].id;
}

/* =========================================================
   NEW: GET KNOWLEDGE BASE VIA ACCESS CODE (FRONTEND ROUTE)
   GET /api/resident/:accessCode/template
========================================================= */
router.get("/:accessCode/template", async (req, res) => {

  const { accessCode } = req.params;

  try {

    const residencyId = await getResidencyIdFromAccessCode(accessCode);

    if (!residencyId) {
      return res.status(404).json({ error: "Invalid access code" });
    }

    const rules = await pool.query(`
      SELECT id, title, description, display_order
      FROM rules
      WHERE residency_id = $1 AND is_active = true
      ORDER BY display_order
    `, [residencyId]);

    const faqs = await pool.query(`
      SELECT id, question, answer, display_order
      FROM faqs
      WHERE residency_id = $1 AND is_active = true
      ORDER BY display_order
    `, [residencyId]);

    const contacts = await pool.query(`
      SELECT id, name, phone, email, description
      FROM emergency_contacts
      WHERE residency_id = $1 AND is_active = true
      ORDER BY name
    `, [residencyId]);

    const info = await pool.query(`
      SELECT id, category, title, content, display_order
      FROM info_items
      WHERE residency_id = $1 AND is_active = true
      ORDER BY category, display_order
    `, [residencyId]);

    const announcements = await pool.query(`
      SELECT id, title, message, start_date, end_date
      FROM announcements
      WHERE residency_id = $1 AND is_active = true
      ORDER BY created_at DESC
    `, [residencyId]);

    res.json({
      residency_id: residencyId,
      rules: rules.rows,
      faqs: faqs.rows,
      emergency_contacts: contacts.rows,
      info_items: info.rows,
      announcements: announcements.rows
    });

  } catch (err) {
    console.error("AccessCode KB fetch error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =========================================================
   NEW: SEARCH VIA ACCESS CODE
   GET /api/resident/:accessCode/template/search?q=
========================================================= */
router.get("/:accessCode/template/search", async (req, res) => {

  const { accessCode } = req.params;
  const { q } = req.query;

  if (!q) {
    return res.status(400).json({ error: "Search query required" });
  }

  try {

    const residencyId = await getResidencyIdFromAccessCode(accessCode);

    if (!residencyId) {
      return res.status(404).json({ error: "Invalid access code" });
    }

    const search = `%${q}%`;

    const rules = await pool.query(`
      SELECT 'rule' AS type, id, title, description AS content
      FROM rules
      WHERE residency_id = $1 AND is_active = true
      AND (title ILIKE $2 OR description ILIKE $2)
    `,[residencyId, search]);

    const faqs = await pool.query(`
      SELECT 'faq' AS type, id, question AS title, answer AS content
      FROM faqs
      WHERE residency_id = $1 AND is_active = true
      AND (question ILIKE $2 OR answer ILIKE $2)
    `,[residencyId, search]);

    const info = await pool.query(`
      SELECT 'info' AS type, id, title, content
      FROM info_items
      WHERE residency_id = $1 AND is_active = true
      AND (title ILIKE $2 OR content ILIKE $2)
    `,[residencyId, search]);

    const contacts = await pool.query(`
      SELECT 'contact' AS type, id, name AS title, description AS content
      FROM emergency_contacts
      WHERE residency_id = $1 AND is_active = true
      AND (name ILIKE $2 OR description ILIKE $2)
    `,[residencyId, search]);

    const announcements = await pool.query(`
      SELECT 'announcement' AS type, id, title, message AS content
      FROM announcements
      WHERE residency_id = $1 AND is_active = true
      AND (title ILIKE $2 OR message ILIKE $2)
    `,[residencyId, search]);

    const results = [
      ...rules.rows,
      ...faqs.rows,
      ...info.rows,
      ...contacts.rows,
      ...announcements.rows
    ];

    res.json(results);

  } catch (err) {
    console.error("AccessCode KB search error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =========================================================
   EXISTING: GET BY RESIDENCY ID (UNCHANGED)
========================================================= */
router.get("/residencies/:id/knowledge", async (req, res) => {

  const { id } = req.params;

  try {

    const rules = await pool.query(`
      SELECT id, title, description, display_order
      FROM rules
      WHERE residency_id = $1 AND is_active = true
      ORDER BY display_order
    `,[id]);

    const faqs = await pool.query(`
      SELECT id, question, answer, display_order
      FROM faqs
      WHERE residency_id = $1 AND is_active = true
      ORDER BY display_order
    `,[id]);

    const contacts = await pool.query(`
      SELECT id, name, phone, email, description
      FROM emergency_contacts
      WHERE residency_id = $1 AND is_active = true
      ORDER BY name
    `,[id]);

    const info = await pool.query(`
      SELECT id, category, title, content, display_order
      FROM info_items
      WHERE residency_id = $1 AND is_active = true
      ORDER BY category, display_order
    `,[id]);

    const announcements = await pool.query(`
      SELECT id, title, message, start_date, end_date
      FROM announcements
      WHERE residency_id = $1 AND is_active = true
      ORDER BY created_at DESC
    `,[id]);

    res.json({
      rules: rules.rows,
      faqs: faqs.rows,
      emergency_contacts: contacts.rows,
      info_items: info.rows,
      announcements: announcements.rows
    });

  } catch (err) {
    console.error("Knowledge base fetch error:", err);
    res.status(500).json({ error: "Server error" });
  }

});

/* =========================================================
   EXISTING: SEARCH BY RESIDENCY ID (UNCHANGED)
========================================================= */
router.get("/residencies/:id/knowledge/search", async (req, res) => {

  const { id } = req.params;
  const { q } = req.query;

  if (!q) {
    return res.status(400).json({ error: "Search query required" });
  }

  try {

    const search = `%${q}%`;

    const rules = await pool.query(`
      SELECT 'rule' AS type, id, title, description AS content
      FROM rules
      WHERE residency_id = $1 AND is_active = true
      AND (title ILIKE $2 OR description ILIKE $2)
    `,[id, search]);

    const faqs = await pool.query(`
      SELECT 'faq' AS type, id, question AS title, answer AS content
      FROM faqs
      WHERE residency_id = $1 AND is_active = true
      AND (question ILIKE $2 OR answer ILIKE $2)
    `,[id, search]);

    const info = await pool.query(`
      SELECT 'info' AS type, id, title, content
      FROM info_items
      WHERE residency_id = $1 AND is_active = true
      AND (title ILIKE $2 OR content ILIKE $2)
    `,[id, search]);

    const contacts = await pool.query(`
      SELECT 'contact' AS type, id, name AS title, description AS content
      FROM emergency_contacts
      WHERE residency_id = $1 AND is_active = true
      AND (name ILIKE $2 OR description ILIKE $2)
    `,[id, search]);

    const announcements = await pool.query(`
      SELECT 'announcement' AS type, id, title, message AS content
      FROM announcements
      WHERE residency_id = $1 AND is_active = true
      AND (title ILIKE $2 OR message ILIKE $2)
    `,[id, search]);

    const results = [
      ...rules.rows,
      ...faqs.rows,
      ...info.rows,
      ...contacts.rows,
      ...announcements.rows
    ];

    res.json(results);

  } catch (err) {
    console.error("Knowledge search error:", err);
    res.status(500).json({ error: "Server error" });
  }

});