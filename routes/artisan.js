import express from "express";
import pool from "../config/db.js";

export const router = express.Router();

/* =====================================================
   HELPER: GET ARTISAN
===================================================== */
async function getArtisan(accessCode) {
  const result = await pool.query(
    `SELECT id FROM artisans WHERE access_code = $1`,
    [accessCode]
  );

  if (result.rows.length === 0) return null;
  return result.rows[0];
}

/* =====================================================
   HELPER: CHECK IF A SPECIFIC JOB BELONGS TO
   AN ARCHIVED RESIDENCY
===================================================== */
async function isJobResidencyArchived(jobId) {
  const result = await pool.query(
    `
    SELECT r.is_archived
    FROM maintenance_requests m
    JOIN residencies r
      ON r.id = m.residency_id
    WHERE m.id = $1
    LIMIT 1
    `,
    [jobId]
  );

  if (result.rows.length === 0) return true;
  return result.rows[0].is_archived;
}

/* =====================================================
   GET ARTISAN PROFILE
===================================================== */
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

/* =====================================================
   GET ARTISAN JOBS
===================================================== */
router.get("/:accessCode/jobs", async (req, res) => {
  const { accessCode } = req.params;

  try {
    const artisan = await getArtisan(accessCode);

    if (!artisan) {
      return res.status(404).json({ error: "Invalid artisan code" });
    }

    const jobs = await pool.query(
      `
      SELECT
        m.id,
        m.job_number,
        m.title,
        m.description,
        m.status,
        m.category,
        m.unit_number,
        m.resident_name,
        m.resident_phone,
        m.preferred_date,
        m.preferred_time,
        m.scheduled_date,
        m.scheduled_time,
        r.name AS residency

      FROM maintenance_requests m

      JOIN residency_artisans ra
        ON ra.residency_id = m.residency_id

      LEFT JOIN residencies r
        ON r.id = m.residency_id

      WHERE ra.artisan_id = $1
      AND m.status != 'cancelled'
      AND COALESCE(r.is_archived, FALSE) = FALSE

      ORDER BY m.created_at DESC
      `,
      [artisan.id]
    );

    res.json(jobs.rows);
  } catch (err) {
    console.error("Artisan jobs error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =====================================================
   CLAIM JOB
===================================================== */
router.put("/:accessCode/jobs/:jobId/claim", async (req, res) => {
  const { accessCode, jobId } = req.params;

  try {
    const artisan = await getArtisan(accessCode);

    if (!artisan) {
      return res.status(404).json({ error: "Invalid artisan code" });
    }

    if (await isJobResidencyArchived(jobId)) {
      return res.status(403).json({
        error: "RESIDENCY_ARCHIVED"
      });
    }

    const result = await pool.query(
      `
      UPDATE maintenance_requests
      SET
        artisan_id = $1,
        status = 'claimed',
        claimed_at = NOW()
      WHERE id = $2
      AND artisan_id IS NULL
      RETURNING *
      `,
      [artisan.id, jobId]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: "Job already claimed" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Claim job error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =====================================================
   START JOB
===================================================== */
router.put("/:accessCode/jobs/:jobId/start", async (req, res) => {
  const { accessCode, jobId } = req.params;

  try {
    const artisan = await getArtisan(accessCode);

    if (!artisan) {
      return res.status(404).json({ error: "Invalid artisan code" });
    }

    if (await isJobResidencyArchived(jobId)) {
      return res.status(403).json({
        error: "RESIDENCY_ARCHIVED"
      });
    }

    const result = await pool.query(
      `
      UPDATE maintenance_requests
      SET
        status = 'in_progress',
        started_at = NOW()
      WHERE id = $1
      AND artisan_id = $2
      AND status = 'claimed'
      RETURNING *
      `,
      [jobId, artisan.id]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: "Job not claimed by this artisan" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Start job error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =====================================================
   COMPLETE JOB
===================================================== */
router.put("/:accessCode/jobs/:jobId/complete", async (req, res) => {
  const { accessCode, jobId } = req.params;

  try {
    const artisan = await getArtisan(accessCode);

    if (!artisan) {
      return res.status(404).json({ error: "Invalid artisan code" });
    }

    if (await isJobResidencyArchived(jobId)) {
      return res.status(403).json({
        error: "RESIDENCY_ARCHIVED"
      });
    }

    const result = await pool.query(
      `
      UPDATE maintenance_requests
      SET
        status = 'completed',
        completed_at = NOW()
      WHERE id = $1
      AND artisan_id = $2
      AND status = 'in_progress'
      RETURNING *
      `,
      [jobId, artisan.id]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: "Job cannot be completed" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Complete job error:", err);
    res.status(500).json({ error: "Server error" });
  }
});