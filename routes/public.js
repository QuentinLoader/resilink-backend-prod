import express from "express";
import pool from "../db.js";
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
   REGISTER MANAGER + RESIDENCY
================================ */
router.post("/register-manager", authenticateUser, async (req, res) => {
  const { residency_name, property_type } = req.body;

  const supabaseUserId = req.user.id;
  const email = req.user.email;

  if (!residency_name || !property_type) {
    return res.status(400).json({
      error: "Residency name and property type are required",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1️⃣ Insert manager
    const managerResult = await client.query(
      `
      INSERT INTO managers (supabase_user_id, email)
      VALUES ($1, $2)
      ON CONFLICT (supabase_user_id)
      DO UPDATE SET email = EXCLUDED.email
      RETURNING id;
      `,
      [supabaseUserId, email]
    );

    const managerDbId = managerResult.rows[0].id;

    // 2️⃣ Generate access code
    const accessCode = generateAccessCode();

    // 3️⃣ Create residency
    const residencyResult = await client.query(
      `
      INSERT INTO residencies (name, property_type, access_code)
      VALUES ($1, $2, $3)
      RETURNING id;
      `,
      [residency_name, property_type, accessCode]
    );

    const residencyId = residencyResult.rows[0].id;

    // 4️⃣ Link manager
    await client.query(
      `
      INSERT INTO manager_residencies (manager_id, residency_id)
      VALUES ($1, $2);
      `,
      [managerDbId, residencyId]
    );

    await client.query("COMMIT");

    return res.status(201).json({
      message: "Manager registered successfully",
      residency_id: residencyId,
      access_code: accessCode, // optionally return for display
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Register manager error:", error);
    return res.status(500).json({ error: "Registration failed" });
  } finally {
    client.release();
  }
});

export default router;