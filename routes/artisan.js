import express from "express";
import pool from "../config/db.js";

export const router = express.Router();

/* ===============================
   GET ARTISAN PROFILE
   GET /api/artisan/:accessCode/profile
================================ */

router.get("/:accessCode/profile", async (req, res) => {
  const { accessCode } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT id, name, phone, trade
      FROM artisans
      WHERE access_code = $1
      `,
      [accessCode]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Invalid artisan code" });
    }

    res.json(result.rows[0]);

  } catch (err) {
    console.error("Artisan profile error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ===============================
   GET ARTISAN JOBS
   GET /api/artisan/:accessCode/jobs
================================ */

router.get("/:accessCode/jobs", async (req, res) => {
  const { accessCode } = req.params;

  try {

    const artisan = await pool.query(
      `SELECT id FROM artisans WHERE access_code = $1`,
      [accessCode]
    );

    if (artisan.rows.length === 0) {
      return res.status(404).json({ error: "Invalid artisan code" });
    }

    const artisanId = artisan.rows[0].id;

    const jobs = await pool.query(
      `
      SELECT
        m.id,
        m.title,
        m.description,
        m.status,
        m.scheduled_date,
        m.scheduled_time,
        p.name AS property,
        r.name AS residency
      FROM maintenance_requests m
      LEFT JOIN properties p ON m.property_id = p.id
      LEFT JOIN residencies r ON m.residency_id = r.id
      WHERE m.artisan_id = $1
      ORDER BY m.scheduled_date ASC
      `,
      [artisanId]
    );

    res.json(jobs.rows);

  } catch (err) {
    console.error("Artisan jobs error:", err);
    res.status(500).json({ error: "Server error" });
  }
});