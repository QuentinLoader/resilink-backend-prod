import express from "express";
import { pool } from "../db.js";

const router = express.Router();

/**
 * GET FAQs by residency code
 * /public/demo/faqs
 */
router.get("/:code/faqs", async (req, res) => {
  const { code } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT
        f.question,
        f.answer,
        c.name AS category
      FROM faqs f
      JOIN residencies r ON r.id = f.residency_id
      LEFT JOIN categories c ON c.id = f.category_id
      WHERE r.code = $1
        AND f.is_active = true
      ORDER BY c.display_order, f.display_order
      `,
      [code]
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
