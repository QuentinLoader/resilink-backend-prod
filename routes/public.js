import express from "express";
import pool from "../db.js";

const router = express.Router();

/**
 * GET FAQs by residency code
 * GET /api/public/:code/faqs
 */
router.get("/:code/faqs", async (req, res) => {
  const { code } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT *
      FROM residency_pack_items
      WHERE residency_code = $1
      ORDER BY section, display_order
      `,
      [code]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching FAQs:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
