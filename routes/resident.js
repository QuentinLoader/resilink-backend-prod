import express from "express";
import pool from "../config/db.js";

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

    /* -----------------------------------------
       Convert category + unit into title
    ----------------------------------------- */

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

    res.json({
      success: true,
      request_id: insert.rows[0].id
    });

  } catch (error) {
    console.error("Maintenance submission error:", error);
    res.status(500).json({
      error: "Server error"
    });
  }
});