import express from "express";
import pool from "../config/db.js";
import { authenticateUser } from "../middleware/auth.js";
import crypto from "crypto";

const router = express.Router();

/* ===============================
   Helper: Generate Residency Access Code
   (Unified secure generator)
================================ */
function generateAccessCode() {
  return "R-" + crypto.randomBytes(3).toString("hex").toUpperCase();
}

/* ===============================
   Helper: Get internal manager ID
================================ */
async function getManagerDbId(supabaseUserId) {
  const result = await pool.query(
    `SELECT id FROM managers WHERE supabase_user_id = $1 LIMIT 1`,
    [supabaseUserId]
  );

  if (result.rows.length === 0) return null;
  return result.rows[0].id;
}

/* ===============================
   GET MANAGER RESIDENCIES
   GET /api/manager/residencies
================================ */
router.get("/residencies", authenticateUser, async (req, res) => {
  try {
    const managerDbId = await getManagerDbId(req.user.id);

    if (!managerDbId) {
      return res.status(404).json({ error: "Manager not found" });
    }

    const { rows } = await pool.query(
      `
      SELECT 
        r.id,
        r.name,
        r.property_type,
        r.access_code,
        r.created_at
      FROM residencies r
      JOIN manager_residencies mr
        ON mr.residency_id = r.id
      WHERE mr.manager_id = $1
      ORDER BY r.created_at DESC;
      `,
      [managerDbId]
    );

    res.json(rows);
  } catch (error) {
    console.error("Get residencies error:", error);
    res.status(500).json({ error: "Failed to fetch residencies" });
  }
});

/* ===============================
   CREATE NEW RESIDENCY
   POST /api/manager/residencies
================================ */
router.post("/residencies", authenticateUser, async (req, res) => {
  const { name, property_type } = req.body;

  if (!name || !property_type) {
    return res.status(400).json({
      error: "Name and property type are required",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const managerDbId = await getManagerDbId(req.user.id);

    if (!managerDbId) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Manager not found" });
    }

    // Generate secure access code with rare collision retry
    let accessCode;
    let residencyResult;

    for (let attempt = 0; attempt < 3; attempt++) {
      accessCode = generateAccessCode();

      try {
        residencyResult = await client.query(
          `
          INSERT INTO residencies (name, property_type, access_code)
          VALUES ($1, $2, $3)
          RETURNING id, name, property_type, access_code, created_at;
          `,
          [name, property_type, accessCode]
        );
        break; // success
      } catch (err) {
        // Retry only on unique violation
        if (err.code !== "23505") {
          throw err;
        }
      }
    }

    if (!residencyResult) {
      throw new Error("Failed to generate unique access code");
    }

    const residency = residencyResult.rows[0];

    await client.query(
      `
      INSERT INTO manager_residencies (manager_id, residency_id)
      VALUES ($1, $2);
      `,
      [managerDbId, residency.id]
    );

    await client.query("COMMIT");

    res.status(201).json(residency);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Create residency error:", error);
    res.status(500).json({ error: "Failed to create residency" });
  } finally {
    client.release();
  }
});

/* ======================================
   GET MAINTENANCE REQUESTS FOR RESIDENCY
   GET /api/manager/residencies/:id/maintenance
====================================== */

router.get(
  "/residencies/:id/maintenance",
  authenticateUser,
  async (req, res) => {
    try {

      const { id } = req.params;

      const result = await pool.query(
        `
        SELECT
          id,
          title,
          category,
          unit_number,
          description,
          priority,
          status,
          resident_name,
          resident_phone,
          preferred_date,
          preferred_time,
          created_at,

          EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600 AS job_age_hours

        FROM maintenance_requests
        WHERE residency_id = $1
        ORDER BY created_at DESC
        `,
        [id]
      );

      res.json(result.rows);

    } catch (error) {

      console.error("Get maintenance error:", error);

      res.status(500).json({
        error: "Failed to load maintenance requests"
      });

    }
  }
);


/* ======================================
   SCHEDULE MAINTENANCE VISIT
   PUT /api/manager/maintenance/:id/schedule
====================================== */

router.put(
  "/maintenance/:id/schedule",
  authenticateUser,
  async (req, res) => {
    try {

      const { id } = req.params;

      const {
        scheduled_date,
        scheduled_time,
        schedule_notes
      } = req.body;

      if (!scheduled_date || !scheduled_time) {
        return res.status(400).json({
          error: "Date and time required"
        });
      }

      await pool.query(
        `
        UPDATE maintenance_requests
        SET
          scheduled_date = $1,
          scheduled_time = $2,
          schedule_notes = $3,
          schedule_status = 'proposed'
        WHERE id = $4
        `,
        [
          scheduled_date,
          scheduled_time,
          schedule_notes || null,
          id
        ]
      );

      res.json({
        success: true
      });

    } catch (error) {
      console.error("Schedule error:", error);
      res.status(500).json({ error: "Server error" });
    }
  }
);

/* ===============================
   CREATE ARTISAN
   POST /api/manager/residencies/:id/artisans
================================ */

router.post(
  "/residencies/:id/artisans",
  authenticateUser,
  async (req, res) => {

    const { id } = req.params;
    const { name, phone, trade } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Name is required" });
    }

    try {

      const accessCode = crypto.randomBytes(4).toString("hex");

      const artisan = await pool.query(
        `
        INSERT INTO artisans (name, phone, trade, access_code)
        VALUES ($1,$2,$3,$4)
        RETURNING *
        `,
        [name, phone, trade, accessCode]
      );

      await pool.query(
        `
        INSERT INTO residency_artisans (residency_id, artisan_id)
        VALUES ($1,$2)
        `,
        [id, artisan.rows[0].id]
      );

      res.json(artisan.rows[0]);

    } catch (err) {

      console.error("Create artisan error:", err);
      res.status(500).json({ error: "Server error" });

    }
  }
);
/* ===============================
   LIST ARTISANS
   GET /api/manager/residencies/:id/artisans
================================ */

router.get(
  "/residencies/:id/artisans",
  authenticateUser,
  async (req, res) => {

    const { id } = req.params;

    try {

      const result = await pool.query(
        `
        SELECT
          a.id,
          a.name,
          a.phone,
          a.trade,
          a.access_code
        FROM artisans a
        JOIN residency_artisans ra
        ON ra.artisan_id = a.id
        WHERE ra.residency_id = $1
        ORDER BY a.name
        `,
        [id]
      );

      res.json(result.rows);

    } catch (err) {

      console.error("List artisans error:", err);
      res.status(500).json({ error: "Server error" });

    }
  }
);

/* ===============================
   GET ARTISAN JOBS
   GET /api/manager/artisans/:id/jobs
================================ */

router.get(
  "/artisans/:id/jobs",
  authenticateUser,
  async (req, res) => {

    const { id } = req.params;

    try {

      const result = await pool.query(
        `
        SELECT
          m.id,
          m.title,
          m.description,
          m.status,
          m.scheduled_date,
          m.scheduled_time,
          r.name AS residency
        FROM maintenance_requests m
        LEFT JOIN residencies r ON m.residency_id = r.id
        WHERE m.artisan_id = $1
        ORDER BY m.scheduled_date ASC
        `,
        [id]
      );

      res.json(result.rows);

    } catch (err) {

      console.error("Manager artisan jobs error:", err);
      res.status(500).json({ error: "Server error" });

    }
  }
);

/* ===============================
   ASSIGN ARTISAN TO JOB
   PUT /api/manager/maintenance/:id/assign-artisan
================================ */

router.put(
  "/maintenance/:id/assign-artisan",
  authenticateUser,
  async (req, res) => {

    const { id } = req.params;
    const { artisan_id, scheduled_date, scheduled_time } = req.body;

    if (!artisan_id) {
      return res.status(400).json({ error: "artisan_id required" });
    }

    try {

      const result = await pool.query(
        `
        UPDATE maintenance_requests
        SET
          artisan_id = $1,
          scheduled_date = $2,
          scheduled_time = $3,
          status = 'scheduled'
        WHERE id = $4
        RETURNING *
        `,
        [artisan_id, scheduled_date, scheduled_time, id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Maintenance request not found" });
      }

      res.json(result.rows[0]);

    } catch (err) {

      console.error("Assign artisan error:", err);
      res.status(500).json({ error: "Server error" });

    }
  }
);

export default router;