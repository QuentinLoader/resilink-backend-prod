import express from "express";
import pool from "../config/db.js";
import { authenticateUser } from "../middleware/auth.js";

const router = express.Router();

/* =========================================
   CREATE MAINTENANCE REQUEST
   POST /api/resident/maintenance
========================================= */

router.post("/", authenticateUser, async (req, res) => {
  try {
    const { title, description, priority, property_id } = req.body;

    if (!title || !description || !priority) {
      return res.status(400).json({
        error: "Title, description and priority are required",
      });
    }

    // 1️⃣ Get resident by supabase_user_id
    const residentResult = await pool.query(
      `
      SELECT id, residency_id
      FROM residents
      WHERE supabase_user_id = $1
      LIMIT 1
      `,
      [req.user.id]
    );

    if (residentResult.rows.length === 0) {
      return res.status(403).json({ error: "Resident not found" });
    }

    const resident = residentResult.rows[0];
    const residentId = resident.id;
    const residencyId = resident.residency_id;

    // 2️⃣ If property provided, validate it belongs to same residency
    if (property_id) {
      const propertyCheck = await pool.query(
        `
        SELECT id
        FROM properties
        WHERE id = $1
          AND residency_id = $2
        LIMIT 1
        `,
        [property_id, residencyId]
      );

      if (propertyCheck.rows.length === 0) {
        return res.status(400).json({
          error: "Invalid property for this residency",
        });
      }
    }

    // 3️⃣ Insert maintenance (residency + resident derived server-side)
    const result = await pool.query(
      `
      INSERT INTO maintenance_requests
        (title, description, priority, status, resident_id, residency_id, property_id)
      VALUES
        ($1, $2, $3, 'pending', $4, $5, $6)
      RETURNING *;
      `,
      [
        title,
        description,
        priority,
        residentId,
        residencyId,
        property_id || null,
      ]
    );

    res.status(201).json(result.rows[0]);

  } catch (error) {
    console.error("Create maintenance error:", error);
    res.status(500).json({ error: "Failed to create maintenance request" });
  }
});

export default router;