import express from "express";
import pool from "../config/db.js";
import { authenticateUser } from "../middleware/auth.js";
import crypto from "crypto";

const router = express.Router();

/* ===============================
   Helper: Generate Residency Access Code
================================ */
function generateAccessCode() {
  return "R-" + crypto.randomBytes(3).toString("hex").toUpperCase();
}

/* ===============================
   Helper: Normalize Artisan Phone
================================ */
function normalizePhone(phone = "") {
  return String(phone).trim().replace(/\s+/g, "");
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
   Helper: Check manager access to residency
================================ */
async function managerHasResidencyAccess(managerDbId, residencyId) {
  const result = await pool.query(
    `
    SELECT 1
    FROM manager_residencies
    WHERE manager_id = $1
      AND residency_id = $2
    LIMIT 1
    `,
    [managerDbId, residencyId]
  );

  return result.rows.length > 0;
}

/* ===============================
   GET MANAGER RESIDENCIES
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
        r.is_archived,
        r.archived_at,
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

    let accessCode;
    let residencyResult;

    for (let attempt = 0; attempt < 3; attempt++) {
      accessCode = generateAccessCode();

      try {
        residencyResult = await client.query(
          `
          INSERT INTO residencies (name, property_type, access_code)
          VALUES ($1, $2, $3)
          RETURNING id, name, property_type, access_code, is_archived, archived_at, created_at;
          `,
          [name, property_type, accessCode]
        );
        break;
      } catch (err) {
        if (err.code !== "23505") throw err;
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

/* ===============================
   ARCHIVE RESIDENCY
================================ */
router.put("/residencies/:id/archive", authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;

    const managerDbId = await getManagerDbId(req.user.id);

    if (!managerDbId) {
      return res.status(404).json({ error: "Manager not found" });
    }

    const hasAccess = await managerHasResidencyAccess(managerDbId, id);

    if (!hasAccess) {
      return res.status(403).json({ error: "Access denied" });
    }

    const result = await pool.query(
      `
      UPDATE residencies
      SET
        is_archived = TRUE,
        archived_at = NOW()
      WHERE id = $1
      RETURNING id, name, property_type, access_code, is_archived, archived_at, created_at
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Residency not found" });
    }

    res.json({
      success: true,
      residency: result.rows[0]
    });
  } catch (error) {
    console.error("Archive residency error:", error);
    res.status(500).json({ error: "Failed to archive residency" });
  }
});

/* ===============================
   UNARCHIVE RESIDENCY
================================ */
router.put("/residencies/:id/unarchive", authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;

    const managerDbId = await getManagerDbId(req.user.id);

    if (!managerDbId) {
      return res.status(404).json({ error: "Manager not found" });
    }

    const hasAccess = await managerHasResidencyAccess(managerDbId, id);

    if (!hasAccess) {
      return res.status(403).json({ error: "Access denied" });
    }

    const result = await pool.query(
      `
      UPDATE residencies
      SET
        is_archived = FALSE,
        archived_at = NULL
      WHERE id = $1
      RETURNING id, name, property_type, access_code, is_archived, archived_at, created_at
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Residency not found" });
    }

    res.json({
      success: true,
      residency: result.rows[0]
    });
  } catch (error) {
    console.error("Unarchive residency error:", error);
    res.status(500).json({ error: "Failed to unarchive residency" });
  }
});

/* ======================================
   GET MAINTENANCE REQUESTS FOR RESIDENCY
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
          m.id,
          m.job_number,
          m.title,
          m.category,
          m.unit_number,
          m.description,
          m.priority,
          m.status,
          m.artisan_id,
          a.name AS artisan_name,
          a.phone AS artisan_phone,
          a.trade AS artisan_trade,
          m.claimed_at,
          m.started_at,
          m.completed_at,
          m.resident_name,
          m.resident_phone,
          m.preferred_date,
          m.preferred_time,
          m.scheduled_date,
          m.scheduled_time,
          m.cancel_reason,
          m.cancelled_at,
          m.cancelled_by,
          m.created_at,
          EXTRACT(EPOCH FROM (NOW() - m.created_at)) / 3600 AS job_age_hours
        FROM maintenance_requests m
        LEFT JOIN artisans a
          ON a.id = m.artisan_id
        WHERE m.residency_id = $1
        AND (m.status IS NULL OR m.status != 'cancelled')
        ORDER BY m.created_at DESC
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

      res.json({ success: true });
    } catch (error) {
      console.error("Schedule error:", error);
      res.status(500).json({ error: "Server error" });
    }
  }
);

/* ===============================
   CANCEL MAINTENANCE REQUEST
================================ */
router.put(
  "/maintenance/:id/cancel",
  authenticateUser,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { reason, note } = req.body;

      if (!reason) {
        return res.status(400).json({ error: "Cancellation reason required" });
      }

      const cancelReason =
        reason === "Other" && note ? `Other: ${note}` : reason;

      const result = await pool.query(
        `
        UPDATE maintenance_requests
        SET
          status = 'cancelled',
          cancel_reason = $1,
          cancelled_by = $2,
          cancelled_at = NOW()
        WHERE id = $3
        RETURNING *
        `,
        [cancelReason, req.user.id, id]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ error: "Maintenance request not found" });
      }

      res.json(result.rows[0]);
    } catch (err) {
      console.error("Cancel maintenance error:", err);
      res.status(500).json({ error: "Failed to cancel request" });
    }
  }
);

/* ===============================
   CREATE OR LINK ARTISAN
================================ */
router.post(
  "/residencies/:id/artisans",
  authenticateUser,
  async (req, res) => {
    const { id } = req.params;
    const { name, surname,phone, trade } = req.body;

    if (!name || !surname || !phone) {
      return res.status(400).json({
        error: "Name and phone are required"
      });
    }

    try {
      const normalizedPhone = normalizePhone(phone);

      let artisanResult = await pool.query(
        `
        SELECT *
        FROM artisans
        WHERE phone = $1
        LIMIT 1
        `,
        [normalizedPhone]
      );

      let artisan;
      let mode;

      if (artisanResult.rows.length > 0) {
        artisan = artisanResult.rows[0];
        mode = "linked_existing";
      } else {
        const accessCode = crypto.randomBytes(4).toString("hex");

        artisanResult = await pool.query(
          `
          INSERT INTO artisans (name, surname,phone, trade, access_code)
          VALUES ($1,$2,$3,$4,$5)
          RETURNING *
          `,
          [name, surname,normalizedPhone, trade || null, accessCode]
        );

        artisan = artisanResult.rows[0];
        mode = "created_new";
      }

      await pool.query(
        `
        INSERT INTO residency_artisans (residency_id, artisan_id)
        VALUES ($1,$2)
        ON CONFLICT (residency_id, artisan_id) DO NOTHING
        `,
        [id, artisan.id]
      );

      res.json({
        success: true,
        mode,
        artisan
      });
    } catch (err) {
      console.error("Create/link artisan error:", err);
      res.status(500).json({ error: "Server error" });
    }
  }
);
/* ===============================
   SEARCH ARTISANS (GLOBAL)
================================ */
router.get(
  "/artisans/search",
  authenticateUser,
  async (req, res) => {
    const q = String(req.query.q || "").trim();

    if (!q) {
      return res.json([]);
    }

    try {
      const searchValue = `%${q}%`;

      const result = await pool.query(
        `
        SELECT
          id,
          name,
          surname,
          phone,
          trade,
          access_code
        FROM artisans
        WHERE
          name ILIKE $1
          OR surname ILIKE $1
          OR phone ILIKE $1
          OR trade ILIKE $1
        ORDER BY name ASC
        LIMIT 20
        `,
        [searchValue]
      );

      res.json(result.rows);
    } catch (err) {
      console.error("Search artisans error:", err);
      res.status(500).json({ error: "Server error" });
    }
  }
);
/* ===============================
   EDIT ARTISAN
================================ */
router.put(
  "/artisans/:id",
  authenticateUser,
  async (req, res) => {
    const { id } = req.params;
    const { name, surname, trade } = req.body;

    if (!name || !surname) {
      return res.status(400).json({
        error: "Name and surname are required"
      });
    }

    try {
      const result = await pool.query(
        `
        UPDATE artisans
        SET
          name = $1,
          surname = $2,
          trade = $3
        WHERE id = $4
        RETURNING *
        `,
        [name, surname, trade || null, id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Artisan not found" });
      }

      res.json({
        success: true,
        artisan: result.rows[0]
      });
    } catch (err) {
      console.error("Edit artisan error:", err);
      res.status(500).json({ error: "Server error" });
    }
  }
);

/* ===============================
   LIST ARTISANS
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
          a.surname,
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
          m.job_number,
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
   ASSIGN / REASSIGN ARTISAN TO JOB
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
          status = 'claimed',
          claimed_at = NOW(),
          started_at = NULL,
          completed_at = NULL
        WHERE id = $4
        RETURNING *
        `,
        [
          artisan_id,
          scheduled_date || null,
          scheduled_time || null,
          id
        ]
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

/* ===============================
   REMOVE ARTISAN FROM RESIDENCY
================================ */
router.delete(
  "/residencies/:residencyId/artisans/:artisanId",
  authenticateUser,
  async (req, res) => {
    const { residencyId, artisanId } = req.params;

    try {
      const result = await pool.query(
        `
        DELETE FROM residency_artisans
        WHERE residency_id = $1
        AND artisan_id = $2
        RETURNING *
        `,
        [residencyId, artisanId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Artisan not linked to residency" });
      }

      res.json({ success: true });
    } catch (err) {
      console.error("Remove artisan error:", err);
      res.status(500).json({ error: "Server error" });
    }
  }
);

/* =========================================================
   GET KNOWLEDGE BASE (MANAGER VIEW)
   GET /api/manager/residencies/:id/template
========================================================= */
router.get(
  "/residencies/:id/template",
  authenticateUser,
  async (req, res) => {
    const { id } = req.params;

    try {
      const rules = await pool.query(`
        SELECT id, title, description, display_order
        FROM rules
        WHERE residency_id = $1
        ORDER BY display_order
      `, [id]);

      const faqs = await pool.query(`
        SELECT id, question, answer, display_order
        FROM faqs
        WHERE residency_id = $1
        ORDER BY display_order
      `, [id]);

      const contacts = await pool.query(`
        SELECT id, name, phone, email, description
        FROM emergency_contacts
        WHERE residency_id = $1
        ORDER BY name
      `, [id]);

      const info = await pool.query(`
        SELECT id, category, title, content, display_order
        FROM info_items
        WHERE residency_id = $1
        ORDER BY category, display_order
      `, [id]);

      const announcements = await pool.query(`
        SELECT id, title, message, start_date, end_date
        FROM announcements
        WHERE residency_id = $1
        ORDER BY created_at DESC
      `, [id]);

      res.json({
        rules: rules.rows,
        faqs: faqs.rows,
        emergency_contacts: contacts.rows,
        info_items: info.rows,
        announcements: announcements.rows
      });
    } catch (err) {
      console.error("Manager KB fetch error:", err);

      res.status(500).json({
        error: "Failed to fetch knowledge base"
      });
    }
  }
);

/* ===============================
   CREATE ANNOUNCEMENT
================================ */
router.post(
  "/residencies/:id/announcements",
  authenticateUser,
  async (req, res) => {
    const { id } = req.params;
    const {
      title,
      message,
      start_date,
      end_date,
      is_active
    } = req.body;

    if (!title || !message) {
      return res.status(400).json({
        error: "Title and message are required"
      });
    }

    try {
      const result = await pool.query(
        `
        INSERT INTO announcements
        (
          residency_id,
          title,
          message,
          start_date,
          end_date,
          is_active,
          created_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,NOW())
        RETURNING *
        `,
        [
          id,
          title,
          message,
          start_date || null,
          end_date || null,
          is_active ?? true
        ]
      );

      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error("Create announcement error:", err);

      res.status(500).json({
        error: "Failed to create announcement"
      });
    }
  }
);

export default router;