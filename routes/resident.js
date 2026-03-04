import express from "express";
import pool from "../config/db.js";
import { getNextAvailableSlot } from "../services/scheduling.service.js";

export const router = express.Router();

/* =====================================================
   RESOLVE RESIDENCY FROM ACCESS CODE
===================================================== */

async function getResidencyFromAccessCode(accessCode) {
  const result = await pool.query(
    `
    SELECT id, name, access_code
    FROM residencies
    WHERE access_code = $1
    LIMIT 1
    `,
    [accessCode]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0];
}

/* =====================================================
   GET RESIDENT PORTAL INFO
   GET /api/resident/:accessCode/info
===================================================== */

router.get("/:accessCode/info", async (req, res) => {
  try {
    const { accessCode } = req.params;

    const residency = await getResidencyFromAccessCode(accessCode);

    if (!residency) {
      return res.status(404).json({
        error: "Invalid access code"
      });
    }

    res.json({
      residency_id: residency.id,
      residency_name: residency.name,
      access_code: residency.access_code
    });

  } catch (error) {
    console.error("Resident info error:", error);
    res.status(500).json({
      error: "Server error"
    });
  }
});

/* =====================================================
   GET RESIDENT KNOWLEDGE TEMPLATE
   GET /api/resident/:accessCode/template
===================================================== */

router.get("/:accessCode/template", async (req, res) => {
  try {
    const { accessCode } = req.params;

    const residency = await getResidencyFromAccessCode(accessCode);

    if (!residency) {
      return res.status(404).json({
        error: "Invalid access code"
      });
    }

    const result = await pool.query(
      `
      SELECT
        id,
        section,
        title,
        content
      FROM template_items
      WHERE residency_id = $1
      ORDER BY section
      `,
      [residency.id]
    );

    res.json({
      residency_id: residency.id,
      items: result.rows
    });

  } catch (error) {
    console.error("Template load error:", error);
    res.status(500).json({
      error: "Server error"
    });
  }
});

/* =====================================================
   GET NEXT AVAILABLE MAINTENANCE SLOT
   GET /api/resident/:accessCode/maintenance/next-slot
===================================================== */

router.get("/:accessCode/maintenance/next-slot", async (req, res) => {

  try {

    const { accessCode } = req.params;

    const residency = await getResidencyFromAccessCode(accessCode);

    if (!residency) {
      return res.status(404).json({
        error: "Invalid access code"
      });
    }

    const slot = await getNextAvailableSlot(residency.id);

    if (!slot) {
      return res.json({
        available: false
      });
    }

    return res.json({
      available: true,
      suggested_slot: slot
    });

  } catch (error) {

    console.error("Slot calculation error:", error);

    res.status(500).json({
      error: "Failed to calculate next available slot"
    });

  }

});

/* =====================================================
   CREATE MAINTENANCE REQUEST
   POST /api/resident/:accessCode/maintenance
===================================================== */

router.post("/:accessCode/maintenance", async (req, res) => {

  try {

    const { accessCode } = req.params;

    const {
      category,
      description,
      unit_number,
      priority
    } = req.body;

    if (!category || !description || !unit_number) {
      return res.status(400).json({
        error: "Missing required fields"
      });
    }

    const residency = await getResidencyFromAccessCode(accessCode);

    if (!residency) {
      return res.status(404).json({
        error: "Invalid access code"
      });
    }

    const title = `${category} - Unit ${unit_number}`;

    const insert = await pool.query(
      `
      INSERT INTO maintenance_requests
      (
        residency_id,
        title,
        description,
        priority,
        status
      )
      VALUES ($1,$2,$3,$4,'pending')
      RETURNING id
      `,
      [
        residency.id,
        title,
        description,
        priority || "normal"
      ]
    );

    const requestId = insert.rows[0].id;

    /* -----------------------------------------
       URGENT REQUEST HANDLING
    ----------------------------------------- */

    if (priority === "urgent") {

      return res.json({
        success: true,
        request_id: requestId,
        urgent: true,
        message: "Emergency request submitted. Manager will be notified."
      });

    }

    /* -----------------------------------------
       SUGGEST NEXT AVAILABLE SLOT
    ----------------------------------------- */

    const suggestedSlot = await getNextAvailableSlot(residency.id);

    res.json({
      success: true,
      request_id: requestId,
      suggested_slot: suggestedSlot || null
    });

  } catch (error) {

    console.error("Maintenance submission error:", error);

    res.status(500).json({
      error: "Server error"
    });

  }

});

/* =====================================================
   RESIDENT CONFIRM MAINTENANCE SLOT
   PUT /api/resident/maintenance/:id/confirm
===================================================== */

router.put("/maintenance/:id/confirm", async (req, res) => {

  try {

    const { id } = req.params;
    const { scheduled_date, scheduled_time } = req.body;

    if (!scheduled_date || !scheduled_time) {
      return res.status(400).json({
        error: "Missing scheduling information"
      });
    }

    await pool.query(
      `
      UPDATE maintenance_requests
      SET
        scheduled_date = $1,
        scheduled_time = $2,
        schedule_status = 'confirmed'
      WHERE id = $3
      `,
      [scheduled_date, scheduled_time, id]
    );

    res.json({
      success: true
    });

  } catch (error) {

    console.error("Resident confirm schedule error:", error);

    res.status(500).json({
      error: "Scheduling failed"
    });

  }

});