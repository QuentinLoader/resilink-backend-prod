import express from "express";
import pool from "../config/db.js";
import { authenticateUser } from "../middleware/auth.js";
import crypto from "crypto";
import {
  startManagerTrialIfEligible,
  getManagerAccountStateBySupabaseUserId,
  requireManagerFeature
} from "../utils/planTrial.js";

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
  return String(phone).replace(/\D/g, "");
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
   Helper: Enforce manager residency access
================================ */
async function requireManagerResidencyAccessForRequest(req, res, residencyId) {
  const managerDbId = await getManagerDbId(req.user.id);

  if (!managerDbId) {
    res.status(404).json({ error: "Manager not found" });
    return false;
  }

  const hasAccess = await managerHasResidencyAccess(managerDbId, residencyId);

  if (!hasAccess) {
    res.status(403).json({ error: "Residency access denied" });
    return false;
  }

  return true;
}

/* ===============================
   GET MANAGER SUBSCRIPTION
================================ */
router.get("/subscription", authenticateUser, async (req, res) => {
  try {
    const account = await getManagerAccountStateBySupabaseUserId(req.user.id);

    if (!account) {
      return res.status(404).json({ error: "Manager not found" });
    }

    return res.json({
      plan: account.plan,
      trial_ends_at: account.trial_ends_at,
      days_remaining: account.days_remaining
    });
  } catch (error) {
    console.error("Get subscription error:", error);
    return res.status(500).json({ error: "Failed to fetch subscription" });
  }
});

/* ===============================
   GET MANAGER ACCOUNT STATE
================================ */
router.get("/account", authenticateUser, async (req, res) => {
  try {
    const account = await getManagerAccountStateBySupabaseUserId(req.user.id);

    if (!account) {
      return res.status(404).json({ error: "Manager not found" });
    }

    return res.json(account);
  } catch (error) {
    console.error("Get account state error:", error);
    return res.status(500).json({ error: "Failed to fetch account state" });
  }
});

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

    const accountGate = await getManagerAccountStateBySupabaseUserId(
      req.user.id,
      client
    );

    if (!accountGate) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Manager not found" });
    }

    if (
      !accountGate.features.can_create_multiple_residencies &&
      accountGate.residency_count >= 1
    ) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        error: "PLAN_UPGRADE_REQUIRED",
        feature: "can_create_multiple_residencies",
        plan: accountGate.plan,
        trial_active: accountGate.trial_active,
        trial_ends_at: accountGate.trial_ends_at
      });
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
   UPDATE RESIDENCY NAME
================================ */
router.put("/residencies/:id", authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;
    const trimmedName = String(req.body?.name || "").trim();

    if (!trimmedName) {
      return res.status(400).json({ error: "Name is required" });
    }

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
      SET name = $1
      WHERE id = $2
      RETURNING id, name, property_type, access_code, is_archived, archived_at, created_at
      `,
      [trimmedName, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Residency not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Update residency name error:", error);
    res.status(500).json({ error: "Failed to update residency" });
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

      const gate = await requireManagerFeature(
        req.user.id,
        "can_schedule_maintenance"
      );

      if (!gate.ok) {
        return res.status(gate.status).json(gate.body);
      }

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
    const { name, surname, phone, trade } = req.body;

    if (!name || !surname || !phone) {
      return res.status(400).json({
        error: "Name, surname and phone are required"
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const managerResult = await client.query(
        `
        SELECT id
        FROM managers
        WHERE supabase_user_id = $1
        LIMIT 1
        `,
        [req.user.id]
      );

      const managerDbId = managerResult.rows[0]?.id;

      if (!managerDbId) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Manager not found" });
      }

      const hasAccessResult = await client.query(
        `
        SELECT 1
        FROM manager_residencies
        WHERE manager_id = $1
          AND residency_id = $2
        LIMIT 1
        `,
        [managerDbId, id]
      );

      if (hasAccessResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "Access denied" });
      }

      const normalizedPhone = normalizePhone(phone);

      let artisanResult = await client.query(
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

        artisanResult = await client.query(
          `
          INSERT INTO artisans (name, surname, phone, trade, access_code)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING *
          `,
          [name, surname, normalizedPhone, trade || null, accessCode]
        );

        artisan = artisanResult.rows[0];
        mode = "created_new";
      }

      const linkResult = await client.query(
        `
        INSERT INTO residency_artisans (residency_id, artisan_id)
        VALUES ($1, $2)
        ON CONFLICT (residency_id, artisan_id) DO NOTHING
        RETURNING residency_id, artisan_id
        `,
        [id, artisan.id]
      );

      let trialStarted = null;

      if (linkResult.rowCount > 0) {
        trialStarted = await startManagerTrialIfEligible(managerDbId, client);
      }

      await client.query("COMMIT");

      res.json({
        success: true,
        mode,
        artisan,
        newly_linked: linkResult.rowCount > 0,
        trial_started: !!trialStarted,
        trial_ends_at: trialStarted?.trial_ends_at ?? null
      });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("Create/link artisan error:", err);
      res.status(500).json({ error: "Server error" });
    } finally {
      client.release();
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
      const gate = await requireManagerFeature(
        req.user.id,
        "can_assign_artisans"
      );

      if (!gate.ok) {
        return res.status(gate.status).json(gate.body);
      }

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
      const managerDbId = await getManagerDbId(req.user.id);

      if (!managerDbId) {
        return res.status(404).json({ error: "Manager not found" });
      }

      const hasAccess = await managerHasResidencyAccess(managerDbId, id);

      if (!hasAccess) {
        return res.status(403).json({ error: "Residency access denied" });
      }

      const rules = await pool.query(
        `
        SELECT id, title, description, display_order, is_active
        FROM rules
        WHERE residency_id = $1
        ORDER BY display_order
        `,
        [id]
      );

      const faqs = await pool.query(
        `
        SELECT id, question, answer, display_order, is_active
        FROM faqs
        WHERE residency_id = $1
        ORDER BY display_order
        `,
        [id]
      );

      const contacts = await pool.query(
        `
        SELECT id, name, phone, email, description, is_active
        FROM emergency_contacts
        WHERE residency_id = $1
        ORDER BY name
        `,
        [id]
      );

      const info = await pool.query(
        `
        SELECT id, category, title, content, display_order, is_active
        FROM info_items
        WHERE residency_id = $1
        ORDER BY category, display_order
        `,
        [id]
      );

      const announcements = await pool.query(
        `
        SELECT id, title, message, start_date, end_date, is_active
        FROM announcements
        WHERE residency_id = $1
        ORDER BY created_at DESC
        `,
        [id]
      );

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

/* =========================================================
   FAQ CRUD (MANAGER VIEW)
========================================================= */
router.post(
  "/residencies/:id/faqs",
  authenticateUser,
  async (req, res) => {
    const { id } = req.params;
    const question = String(req.body?.question ?? "").trim();
    const answer = String(req.body?.answer ?? "").trim();
    const displayOrder = Number.isFinite(Number(req.body?.display_order))
      ? Number(req.body.display_order)
      : 0;
    const isActive = req.body?.is_active ?? true;

    if (!question || !answer) {
      return res.status(400).json({
        error: "Question and answer are required"
      });
    }

    if (typeof isActive !== "boolean") {
      return res.status(400).json({ error: "is_active must be a boolean" });
    }

    try {
      const managerDbId = await getManagerDbId(req.user.id);

      if (!managerDbId) {
        return res.status(404).json({ error: "Manager not found" });
      }

      const hasAccess = await managerHasResidencyAccess(managerDbId, id);

      if (!hasAccess) {
        return res.status(403).json({ error: "Residency access denied" });
      }

      const result = await pool.query(
        `
        INSERT INTO faqs
          (residency_id, question, answer, display_order, is_active)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, question, answer, display_order, is_active
        `,
        [id, question, answer, displayOrder, isActive]
      );

      return res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error("Create FAQ error:", err);
      return res.status(500).json({ error: "Failed to create FAQ" });
    }
  }
);

router.patch(
  "/residencies/:id/faqs/:faqId",
  authenticateUser,
  async (req, res) => {
    const { id, faqId } = req.params;
    const updates = [];
    const values = [];

    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "question")) {
      const question = String(req.body.question ?? "").trim();
      if (!question) {
        return res.status(400).json({ error: "Question cannot be blank" });
      }
      values.push(question);
      updates.push(`question = $${values.length}`);
    }

    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "answer")) {
      const answer = String(req.body.answer ?? "").trim();
      if (!answer) {
        return res.status(400).json({ error: "Answer cannot be blank" });
      }
      values.push(answer);
      updates.push(`answer = $${values.length}`);
    }

    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "display_order")) {
      const displayOrder = Number(req.body.display_order);
      if (!Number.isFinite(displayOrder)) {
        return res.status(400).json({ error: "display_order must be a number" });
      }
      values.push(displayOrder);
      updates.push(`display_order = $${values.length}`);
    }

    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "is_active")) {
      if (typeof req.body.is_active !== "boolean") {
        return res.status(400).json({ error: "is_active must be a boolean" });
      }
      values.push(req.body.is_active);
      updates.push(`is_active = $${values.length}`);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No valid FAQ fields supplied" });
    }

    try {
      const managerDbId = await getManagerDbId(req.user.id);

      if (!managerDbId) {
        return res.status(404).json({ error: "Manager not found" });
      }

      const hasAccess = await managerHasResidencyAccess(managerDbId, id);

      if (!hasAccess) {
        return res.status(403).json({ error: "Residency access denied" });
      }

      values.push(faqId);
      const faqIdParam = values.length;
      values.push(id);
      const residencyIdParam = values.length;

      const result = await pool.query(
        `
        UPDATE faqs
        SET ${updates.join(", ")}
        WHERE id = $${faqIdParam}
          AND residency_id = $${residencyIdParam}
        RETURNING id, question, answer, display_order, is_active
        `,
        values
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "FAQ not found" });
      }

      return res.json(result.rows[0]);
    } catch (err) {
      console.error("Update FAQ error:", err);
      return res.status(500).json({ error: "Failed to update FAQ" });
    }
  }
);

router.delete(
  "/residencies/:id/faqs/:faqId",
  authenticateUser,
  async (req, res) => {
    const { id, faqId } = req.params;

    try {
      const managerDbId = await getManagerDbId(req.user.id);

      if (!managerDbId) {
        return res.status(404).json({ error: "Manager not found" });
      }

      const hasAccess = await managerHasResidencyAccess(managerDbId, id);

      if (!hasAccess) {
        return res.status(403).json({ error: "Residency access denied" });
      }

      const result = await pool.query(
        `
        DELETE FROM faqs
        WHERE id = $1
          AND residency_id = $2
        RETURNING id
        `,
        [faqId, id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "FAQ not found" });
      }

      return res.json({ success: true });
    } catch (err) {
      console.error("Delete FAQ error:", err);
      return res.status(500).json({ error: "Failed to delete FAQ" });
    }
  }
);

/* =========================================================
   RULE CRUD (MANAGER VIEW)
========================================================= */
router.post(
  "/residencies/:id/rules",
  authenticateUser,
  async (req, res) => {
    const { id } = req.params;
    const title = String(req.body?.title ?? "").trim();
    const description = String(req.body?.description ?? "").trim();
    const displayOrder = Number.isFinite(Number(req.body?.display_order))
      ? Number(req.body.display_order)
      : 0;
    const isActive = req.body?.is_active ?? true;

    if (!title || !description) {
      return res.status(400).json({ error: "Title and description are required" });
    }

    if (typeof isActive !== "boolean") {
      return res.status(400).json({ error: "is_active must be a boolean" });
    }

    try {
      if (!(await requireManagerResidencyAccessForRequest(req, res, id))) return;

      const result = await pool.query(
        `
        INSERT INTO rules
          (residency_id, title, description, display_order, is_active)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, title, description, display_order, is_active
        `,
        [id, title, description, displayOrder, isActive]
      );

      return res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error("Create rule error:", err);
      return res.status(500).json({ error: "Failed to create rule" });
    }
  }
);

router.patch(
  "/residencies/:id/rules/:ruleId",
  authenticateUser,
  async (req, res) => {
    const { id, ruleId } = req.params;
    const updates = [];
    const values = [];

    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "title")) {
      const title = String(req.body.title ?? "").trim();
      if (!title) return res.status(400).json({ error: "Title cannot be blank" });
      values.push(title);
      updates.push(`title = $${values.length}`);
    }

    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "description")) {
      const description = String(req.body.description ?? "").trim();
      if (!description) return res.status(400).json({ error: "Description cannot be blank" });
      values.push(description);
      updates.push(`description = $${values.length}`);
    }

    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "display_order")) {
      const displayOrder = Number(req.body.display_order);
      if (!Number.isFinite(displayOrder)) {
        return res.status(400).json({ error: "display_order must be a number" });
      }
      values.push(displayOrder);
      updates.push(`display_order = $${values.length}`);
    }

    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "is_active")) {
      if (typeof req.body.is_active !== "boolean") {
        return res.status(400).json({ error: "is_active must be a boolean" });
      }
      values.push(req.body.is_active);
      updates.push(`is_active = $${values.length}`);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No valid rule fields supplied" });
    }

    try {
      if (!(await requireManagerResidencyAccessForRequest(req, res, id))) return;

      values.push(ruleId);
      const ruleIdParam = values.length;
      values.push(id);
      const residencyIdParam = values.length;

      const result = await pool.query(
        `
        UPDATE rules
        SET ${updates.join(", ")}
        WHERE id = $${ruleIdParam}
          AND residency_id = $${residencyIdParam}
        RETURNING id, title, description, display_order, is_active
        `,
        values
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Rule not found" });
      }

      return res.json(result.rows[0]);
    } catch (err) {
      console.error("Update rule error:", err);
      return res.status(500).json({ error: "Failed to update rule" });
    }
  }
);

router.delete(
  "/residencies/:id/rules/:ruleId",
  authenticateUser,
  async (req, res) => {
    const { id, ruleId } = req.params;

    try {
      if (!(await requireManagerResidencyAccessForRequest(req, res, id))) return;

      const result = await pool.query(
        `
        DELETE FROM rules
        WHERE id = $1
          AND residency_id = $2
        RETURNING id
        `,
        [ruleId, id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Rule not found" });
      }

      return res.json({ success: true });
    } catch (err) {
      console.error("Delete rule error:", err);
      return res.status(500).json({ error: "Failed to delete rule" });
    }
  }
);

/* =========================================================
   EMERGENCY CONTACT CRUD (MANAGER VIEW)
========================================================= */
router.post(
  "/residencies/:id/emergency-contacts",
  authenticateUser,
  async (req, res) => {
    const { id } = req.params;
    const name = String(req.body?.name ?? "").trim();
    const phone = String(req.body?.phone ?? "").trim();
    const email = String(req.body?.email ?? "").trim() || null;
    const description = String(req.body?.description ?? "").trim() || null;
    const isActive = req.body?.is_active ?? true;

    if (!name || !phone) {
      return res.status(400).json({ error: "Name and phone are required" });
    }

    if (typeof isActive !== "boolean") {
      return res.status(400).json({ error: "is_active must be a boolean" });
    }

    try {
      if (!(await requireManagerResidencyAccessForRequest(req, res, id))) return;

      const result = await pool.query(
        `
        INSERT INTO emergency_contacts
          (residency_id, name, phone, email, description, is_active)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, name, phone, email, description, is_active
        `,
        [id, name, phone, email, description, isActive]
      );

      return res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error("Create emergency contact error:", err);
      return res.status(500).json({ error: "Failed to create emergency contact" });
    }
  }
);

router.patch(
  "/residencies/:id/emergency-contacts/:contactId",
  authenticateUser,
  async (req, res) => {
    const { id, contactId } = req.params;
    const updates = [];
    const values = [];

    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "name")) {
      const name = String(req.body.name ?? "").trim();
      if (!name) return res.status(400).json({ error: "Name cannot be blank" });
      values.push(name);
      updates.push(`name = $${values.length}`);
    }

    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "phone")) {
      const phone = String(req.body.phone ?? "").trim();
      if (!phone) return res.status(400).json({ error: "Phone cannot be blank" });
      values.push(phone);
      updates.push(`phone = $${values.length}`);
    }

    for (const field of ["email", "description"]) {
      if (Object.prototype.hasOwnProperty.call(req.body ?? {}, field)) {
        const value = String(req.body[field] ?? "").trim() || null;
        values.push(value);
        updates.push(`${field} = $${values.length}`);
      }
    }

    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "is_active")) {
      if (typeof req.body.is_active !== "boolean") {
        return res.status(400).json({ error: "is_active must be a boolean" });
      }
      values.push(req.body.is_active);
      updates.push(`is_active = $${values.length}`);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No valid emergency contact fields supplied" });
    }

    try {
      if (!(await requireManagerResidencyAccessForRequest(req, res, id))) return;

      values.push(contactId);
      const contactIdParam = values.length;
      values.push(id);
      const residencyIdParam = values.length;

      const result = await pool.query(
        `
        UPDATE emergency_contacts
        SET ${updates.join(", ")}
        WHERE id = $${contactIdParam}
          AND residency_id = $${residencyIdParam}
        RETURNING id, name, phone, email, description, is_active
        `,
        values
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Emergency contact not found" });
      }

      return res.json(result.rows[0]);
    } catch (err) {
      console.error("Update emergency contact error:", err);
      return res.status(500).json({ error: "Failed to update emergency contact" });
    }
  }
);

router.delete(
  "/residencies/:id/emergency-contacts/:contactId",
  authenticateUser,
  async (req, res) => {
    const { id, contactId } = req.params;

    try {
      if (!(await requireManagerResidencyAccessForRequest(req, res, id))) return;

      const result = await pool.query(
        `
        DELETE FROM emergency_contacts
        WHERE id = $1
          AND residency_id = $2
        RETURNING id
        `,
        [contactId, id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Emergency contact not found" });
      }

      return res.json({ success: true });
    } catch (err) {
      console.error("Delete emergency contact error:", err);
      return res.status(500).json({ error: "Failed to delete emergency contact" });
    }
  }
);

/* =========================================================
   INFO ITEM CRUD (SECURITY / ESTATE INFO)
========================================================= */
router.post(
  "/residencies/:id/info-items",
  authenticateUser,
  async (req, res) => {
    const { id } = req.params;
    const category = String(req.body?.category ?? "").trim();
    const title = String(req.body?.title ?? "").trim();
    const content = String(req.body?.content ?? "").trim();
    const displayOrder = Number.isFinite(Number(req.body?.display_order))
      ? Number(req.body.display_order)
      : 0;
    const isActive = req.body?.is_active ?? true;

    if (!category || !title || !content) {
      return res.status(400).json({ error: "Category, title and content are required" });
    }

    if (typeof isActive !== "boolean") {
      return res.status(400).json({ error: "is_active must be a boolean" });
    }

    try {
      if (!(await requireManagerResidencyAccessForRequest(req, res, id))) return;

      const result = await pool.query(
        `
        INSERT INTO info_items
          (residency_id, category, title, content, display_order, is_active)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, category, title, content, display_order, is_active
        `,
        [id, category, title, content, displayOrder, isActive]
      );

      return res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error("Create info item error:", err);
      return res.status(500).json({ error: "Failed to create info item" });
    }
  }
);

router.patch(
  "/residencies/:id/info-items/:infoItemId",
  authenticateUser,
  async (req, res) => {
    const { id, infoItemId } = req.params;
    const updates = [];
    const values = [];

    for (const field of ["category", "title", "content"]) {
      if (Object.prototype.hasOwnProperty.call(req.body ?? {}, field)) {
        const value = String(req.body[field] ?? "").trim();
        if (!value) return res.status(400).json({ error: `${field} cannot be blank` });
        values.push(value);
        updates.push(`${field} = $${values.length}`);
      }
    }

    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "display_order")) {
      const displayOrder = Number(req.body.display_order);
      if (!Number.isFinite(displayOrder)) {
        return res.status(400).json({ error: "display_order must be a number" });
      }
      values.push(displayOrder);
      updates.push(`display_order = $${values.length}`);
    }

    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "is_active")) {
      if (typeof req.body.is_active !== "boolean") {
        return res.status(400).json({ error: "is_active must be a boolean" });
      }
      values.push(req.body.is_active);
      updates.push(`is_active = $${values.length}`);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No valid info item fields supplied" });
    }

    try {
      if (!(await requireManagerResidencyAccessForRequest(req, res, id))) return;

      values.push(infoItemId);
      const infoItemIdParam = values.length;
      values.push(id);
      const residencyIdParam = values.length;

      const result = await pool.query(
        `
        UPDATE info_items
        SET ${updates.join(", ")}
        WHERE id = $${infoItemIdParam}
          AND residency_id = $${residencyIdParam}
        RETURNING id, category, title, content, display_order, is_active
        `,
        values
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Info item not found" });
      }

      return res.json(result.rows[0]);
    } catch (err) {
      console.error("Update info item error:", err);
      return res.status(500).json({ error: "Failed to update info item" });
    }
  }
);

router.delete(
  "/residencies/:id/info-items/:infoItemId",
  authenticateUser,
  async (req, res) => {
    const { id, infoItemId } = req.params;

    try {
      if (!(await requireManagerResidencyAccessForRequest(req, res, id))) return;

      const result = await pool.query(
        `
        DELETE FROM info_items
        WHERE id = $1
          AND residency_id = $2
        RETURNING id
        `,
        [infoItemId, id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Info item not found" });
      }

      return res.json({ success: true });
    } catch (err) {
      console.error("Delete info item error:", err);
      return res.status(500).json({ error: "Failed to delete info item" });
    }
  }
);

/* =========================================================
   ANNOUNCEMENT CRUD (MANAGER VIEW)
========================================================= */
router.post(
  "/residencies/:id/announcements",
  authenticateUser,
  async (req, res) => {
    const { id } = req.params;
    const title = String(req.body?.title ?? "").trim();
    const message = String(req.body?.message ?? "").trim();
    const startDate = req.body?.start_date || null;
    const endDate = req.body?.end_date || null;
    const isActive = req.body?.is_active ?? true;

    if (!title || !message) {
      return res.status(400).json({ error: "Title and message are required" });
    }

    if (typeof isActive !== "boolean") {
      return res.status(400).json({ error: "is_active must be a boolean" });
    }

    if (startDate && endDate && String(endDate) < String(startDate)) {
      return res.status(400).json({ error: "end_date cannot be before start_date" });
    }

    try {
      if (!(await requireManagerResidencyAccessForRequest(req, res, id))) return;

      const result = await pool.query(
        `
        INSERT INTO announcements
          (residency_id, title, message, start_date, end_date, is_active, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        RETURNING id, title, message, start_date, end_date, is_active
        `,
        [id, title, message, startDate, endDate, isActive]
      );

      return res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error("Create announcement error:", err);
      return res.status(500).json({ error: "Failed to create announcement" });
    }
  }
);

router.patch(
  "/residencies/:id/announcements/:announcementId",
  authenticateUser,
  async (req, res) => {
    const { id, announcementId } = req.params;
    const updates = [];
    const values = [];

    for (const field of ["title", "message"]) {
      if (Object.prototype.hasOwnProperty.call(req.body ?? {}, field)) {
        const value = String(req.body[field] ?? "").trim();
        if (!value) return res.status(400).json({ error: `${field} cannot be blank` });
        values.push(value);
        updates.push(`${field} = $${values.length}`);
      }
    }

    for (const field of ["start_date", "end_date"]) {
      if (Object.prototype.hasOwnProperty.call(req.body ?? {}, field)) {
        values.push(req.body[field] || null);
        updates.push(`${field} = $${values.length}`);
      }
    }

    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "is_active")) {
      if (typeof req.body.is_active !== "boolean") {
        return res.status(400).json({ error: "is_active must be a boolean" });
      }
      values.push(req.body.is_active);
      updates.push(`is_active = $${values.length}`);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No valid announcement fields supplied" });
    }

    try {
      if (!(await requireManagerResidencyAccessForRequest(req, res, id))) return;

      if (
        Object.prototype.hasOwnProperty.call(req.body ?? {}, "start_date") ||
        Object.prototype.hasOwnProperty.call(req.body ?? {}, "end_date")
      ) {
        const existing = await pool.query(
          `
          SELECT start_date, end_date
          FROM announcements
          WHERE id = $1
            AND residency_id = $2
          LIMIT 1
          `,
          [announcementId, id]
        );

        if (existing.rows.length === 0) {
          return res.status(404).json({ error: "Announcement not found" });
        }

        const effectiveStart = Object.prototype.hasOwnProperty.call(req.body ?? {}, "start_date")
          ? req.body.start_date || null
          : existing.rows[0].start_date;
        const effectiveEnd = Object.prototype.hasOwnProperty.call(req.body ?? {}, "end_date")
          ? req.body.end_date || null
          : existing.rows[0].end_date;

        const startKey = effectiveStart ? String(effectiveStart).slice(0, 10) : null;
        const endKey = effectiveEnd ? String(effectiveEnd).slice(0, 10) : null;

        if (startKey && endKey && endKey < startKey) {
          return res.status(400).json({ error: "end_date cannot be before start_date" });
        }
      }

      values.push(announcementId);
      const announcementIdParam = values.length;
      values.push(id);
      const residencyIdParam = values.length;

      const result = await pool.query(
        `
        UPDATE announcements
        SET ${updates.join(", ")}
        WHERE id = $${announcementIdParam}
          AND residency_id = $${residencyIdParam}
        RETURNING id, title, message, start_date, end_date, is_active
        `,
        values
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Announcement not found" });
      }

      return res.json(result.rows[0]);
    } catch (err) {
      console.error("Update announcement error:", err);
      return res.status(500).json({ error: "Failed to update announcement" });
    }
  }
);

router.delete(
  "/residencies/:id/announcements/:announcementId",
  authenticateUser,
  async (req, res) => {
    const { id, announcementId } = req.params;

    try {
      if (!(await requireManagerResidencyAccessForRequest(req, res, id))) return;

      const result = await pool.query(
        `
        DELETE FROM announcements
        WHERE id = $1
          AND residency_id = $2
        RETURNING id
        `,
        [announcementId, id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Announcement not found" });
      }

      return res.json({ success: true });
    } catch (err) {
      console.error("Delete announcement error:", err);
      return res.status(500).json({ error: "Failed to delete announcement" });
    }
  }
);

export default router;
