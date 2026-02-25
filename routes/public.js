import express from "express";
import pool from "../db.js";

const router = express.Router();

/**
 * GET Public FAQs for a residency
 * Optional search: ?q=keyword
 *
 * GET /api/public/residencies/:residencyId/faqs
 * GET /api/public/residencies/:residencyId/faqs?q=parking
 */
router.get("/residencies/:residencyId/faqs", async (req, res) => {
  const { residencyId } = req.params;
  const { q } = req.query;

  try {
    // Strict UUID validation (safer than length check)
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

    // Optional search support (MVP simple search)
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

    // Group results into array format (frontend-friendly)
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