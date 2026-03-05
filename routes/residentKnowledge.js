import express from "express";
import pool from "../config/db.js";

export const router = express.Router();

/* ===============================
   GET RESIDENCY KNOWLEDGE BASE
   GET /api/resident/residencies/:id/knowledge
================================ */

router.get("/residencies/:id/knowledge", async (req, res) => {

  const { id } = req.params;

  try {

    const rules = await pool.query(`
      SELECT id, title, description, display_order
      FROM rules
      WHERE residency_id = $1
      AND is_active = true
      ORDER BY display_order
    `,[id]);

    const faqs = await pool.query(`
      SELECT id, question, answer, display_order
      FROM faqs
      WHERE residency_id = $1
      AND is_active = true
      ORDER BY display_order
    `,[id]);

    const contacts = await pool.query(`
      SELECT id, name, phone, email, description
      FROM emergency_contacts
      WHERE residency_id = $1
      AND is_active = true
      ORDER BY name
    `,[id]);

    const info = await pool.query(`
      SELECT id, category, title, content, display_order
      FROM info_items
      WHERE residency_id = $1
      AND is_active = true
      ORDER BY category, display_order
    `,[id]);

    const announcements = await pool.query(`
      SELECT id, title, message, start_date, end_date
      FROM announcements
      WHERE residency_id = $1
      AND is_active = true
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
/* ===============================
   SEARCH KNOWLEDGE BASE
   GET /api/resident/residencies/:id/knowledge/search?q=
================================ */

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
      WHERE residency_id = $1
      AND is_active = true
      AND (title ILIKE $2 OR description ILIKE $2)
    `,[id, search]);

    const faqs = await pool.query(`
      SELECT 'faq' AS type, id, question AS title, answer AS content
      FROM faqs
      WHERE residency_id = $1
      AND is_active = true
      AND (question ILIKE $2 OR answer ILIKE $2)
    `,[id, search]);

    const info = await pool.query(`
      SELECT 'info' AS type, id, title, content
      FROM info_items
      WHERE residency_id = $1
      AND is_active = true
      AND (title ILIKE $2 OR content ILIKE $2)
    `,[id, search]);

    const contacts = await pool.query(`
      SELECT 'contact' AS type, id, name AS title, description AS content
      FROM emergency_contacts
      WHERE residency_id = $1
      AND is_active = true
      AND (name ILIKE $2 OR description ILIKE $2)
    `,[id, search]);

    const announcements = await pool.query(`
      SELECT 'announcement' AS type, id, title, message AS content
      FROM announcements
      WHERE residency_id = $1
      AND is_active = true
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