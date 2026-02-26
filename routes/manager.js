import express from "express";
import pool from "../db.js";
import { authenticateUser } from "../middleware/auth.js";
import crypto from "crypto";

const router = express.Router();

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
   Helper: Generate Access Code
================================ */
function generateAccessCode() {
  return "R-" + crypto.randomBytes(3).toString("hex").toUpperCase();
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
      SELECT r.*
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

    const accessCode = generateAccessCode();

    // Create residency
    const residencyResult = await client.query(
      `
      INSERT INTO residencies (name, property_type, access_code)
      VALUES ($1, $2, $3)
      RETURNING *;
      `,
      [name, property_type, accessCode]
    );

    const residency = residencyResult.rows[0];

    // Link manager
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

export default router;