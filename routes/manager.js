import express from "express";
import pool from "../db.js";
import auth from "../middleware/auth.js";
import residencyAccess from "../middleware/residencyAccess.js";

const router = express.Router();

/**
 * GET All FAQs for a residency (Manager View)
 */
router.get(
  "/residencies/:residencyId/faqs",
  auth,
  residencyAccess,
  async (req, res) => {
    const { residencyId } = req.params;

    try {
      const { rows } = await pool.query(
        `
        SELECT 
          f.id,
          f.question,
          f.answer,
          f.category_id,
          c.name AS category
        FROM residency_faqs f
        JOIN categories c ON f.category_id = c.id
        WHERE f.residency_id = $1
        ORDER BY c.name ASC, f.created_at ASC;
        `,
        [residencyId]
      );

      return res.json(rows);
    } catch (error) {
      console.error("Error fetching manager FAQs:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

/**
 * CREATE FAQ
 */
router.post(
  "/residencies/:residencyId/faqs",
  auth,
  residencyAccess,
  async (req, res) => {
    const { residencyId } = req.params;
    const { categoryId, question, answer } = req.body;

    if (!categoryId || !question || !answer) {
      return res
        .status(400)
        .json({ error: "categoryId, question and answer are required" });
    }

    try {
      const { rows } = await pool.query(
        `
        INSERT INTO residency_faqs (
          residency_id,
          category_id,
          question,
          answer
        )
        VALUES ($1, $2, $3, $4)
        RETURNING *;
        `,
        [residencyId, categoryId, question.trim(), answer.trim()]
      );

      return res.status(201).json(rows[0]);
    } catch (error) {
      console.error("Error creating FAQ:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

/**
 * UPDATE FAQ
 */
router.put(
  "/faqs/:faqId",
  auth,
  async (req, res) => {
    const { faqId } = req.params;
    const { categoryId, question, answer } = req.body;

    try {
      const { rows } = await pool.query(
        `
        UPDATE residency_faqs
        SET
          category_id = COALESCE($1, category_id),
          question = COALESCE($2, question),
          answer = COALESCE($3, answer),
          updated_at = NOW()
        WHERE id = $4
        RETURNING *;
        `,
        [
          categoryId || null,
          question?.trim() || null,
          answer?.trim() || null,
          faqId,
        ]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: "FAQ not found" });
      }

      return res.json(rows[0]);
    } catch (error) {
      console.error("Error updating FAQ:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

/**
 * DELETE FAQ
 */
router.delete(
  "/faqs/:faqId",
  auth,
  async (req, res) => {
    const { faqId } = req.params;

    try {
      const { rowCount } = await pool.query(
        `
        DELETE FROM residency_faqs
        WHERE id = $1;
        `,
        [faqId]
      );

      if (rowCount === 0) {
        return res.status(404).json({ error: "FAQ not found" });
      }

      return res.json({ message: "FAQ deleted successfully" });
    } catch (error) {
      console.error("Error deleting FAQ:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;