import express from "express";
import pool from "../db.js";
import { authenticateUser } from "../middleware/auth.js";

const router = express.Router();

/* ===============================
   REGISTER MANAGER + RESIDENCY
   POST /api/public/register-manager
================================ */
router.post("/register-manager", authenticateUser, async (req, res) => {
  const { residency_name, property_type } = req.body;
  const managerId = req.user.id; // Supabase user ID

  if (!residency_name || !property_type) {
    return res.status(400).json({
      error: "Residency name and property type are required",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1️⃣ Insert manager if not exists
    await client.query(
      `
      INSERT INTO managers (id)
      VALUES ($1)
      ON CONFLICT (id) DO NOTHING;
      `,
      [managerId]
    );

    // 2️⃣ Create residency
    const residencyResult = await client.query(
      `
      INSERT INTO residencies (name)
      VALUES ($1)
      RETURNING id;
      `,
      [residency_name]
    );

    const residencyId = residencyResult.rows[0].id;

    // 3️⃣ Link manager to residency
    await client.query(
      `
      INSERT INTO manager_residencies (manager_id, residency_id)
      VALUES ($1, $2);
      `,
      [managerId, residencyId]
    );

    await client.query("COMMIT");

    return res.status(201).json({
      message: "Manager registered successfully",
      residency_id: residencyId,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Register manager error:", error);
    return res.status(500).json({ error: "Registration failed" });
  } finally {
    client.release();
  }
});

/* ===============================
   PUBLIC FAQ ENDPOINT
================================ */

router.get("/residencies/:residencyId/faqs", async (req, res) => {
  const { residencyId } = req.params;
  const { q } = req.query;

  try {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (!residencyId || !uuidRegex.test(residencyId)) {
      return res.status(400).json({ error: "Invalid residency ID" });
    }

    let query = `
      SELECT 
        c.name AS category,
        f.id,
        f.question,
        f.answer
      FROM residency_faqs f
      JOIN categories c ON f.category_id = c.id
      WHERE f.residency_id = $1
    `;

    const params = [residencyId];

    if (q && q.trim() !== "") {
      query += `
        AND (
          f.question ILIKE $2
          OR f.answer ILIKE $2
        )
      `;
      params.push(`%${q}%`);
    }

    query += `
      ORDER BY c.name ASC, f.created_at ASC;
    `;

    const { rows } = await pool.query(query, params);

    const grouped = Object.values(
      rows.reduce((acc, row) => {
        if (!acc[row.category]) {
          acc[row.category] = {
            category: row.category,
            faqs: [],
          };
        }

        acc[row.category].faqs.push({
          id: row.id,
          question: row.question,
          answer: row.answer,
        });

        return acc;
      }, {})
    );

    return res.json(grouped);
  } catch (error) {
    console.error("Error fetching public FAQs:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;