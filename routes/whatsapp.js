import express from "express";
import pool from "../db.js";

const router = express.Router();

/* ======================================================
   WHATSAPP WEBHOOK (MVP CLEAN VERSION)
   ====================================================== */

router.post("/webhook", async (req, res) => {
  try {
    // ⚠️ Adjust these depending on provider (Twilio/Meta/etc)
    const phone = req.body.from;
    const messageText = req.body.text?.trim();

    if (!phone || !messageText) {
      return res.sendStatus(200);
    }

    /* ======================================================
       1️⃣ CHECK IF MANAGER
    ====================================================== */
    const managerResult = await pool.query(
      `SELECT id FROM managers WHERE whatsapp_number = $1 LIMIT 1`,
      [phone]
    );

    if (managerResult.rows.length > 0) {
      const managerId = managerResult.rows[0].id;

      const residencies = await pool.query(
        `
        SELECT r.id, r.name
        FROM residencies r
        JOIN manager_residencies mr
          ON mr.residency_id = r.id
        WHERE mr.manager_id = $1
        `,
        [managerId]
      );

      if (residencies.rows.length === 0) {
        return reply(res, "No residencies linked to your account.");
      }

      if (residencies.rows.length === 1) {
        return reply(
          res,
          `Manager Mode (${residencies.rows[0].name})\nFeature coming next.`
        );
      }

      // Multiple residencies
      let response = "You manage multiple residencies:\n\n";
      residencies.rows.forEach((r, index) => {
        response += `${index + 1}. ${r.name}\n`;
      });

      response += "\nReply with the number to select.";

      return reply(res, response);
    }

    /* ======================================================
       2️⃣ CHECK IF RESIDENT
    ====================================================== */
    const residentResult = await pool.query(
      `SELECT r.id, r.residency_id, rs.name
       FROM residents r
       JOIN residencies rs ON rs.id = r.residency_id
       WHERE r.phone = $1
       LIMIT 1`,
      [phone]
    );

    if (residentResult.rows.length > 0) {
      const residencyName = residentResult.rows[0].name;

      return reply(
        res,
        `Welcome back 👋\nResidency: ${residencyName}\n\nFeature flow coming next.`
      );
    }

    /* ======================================================
       3️⃣ NEW USER → EXPECT JOIN
    ====================================================== */
    const joinResponse = await handleJoin(phone, messageText);
    return reply(res, joinResponse);

  } catch (error) {
    console.error("WhatsApp webhook error:", error);
    return res.sendStatus(200);
  }
});

/* ======================================================
   JOIN HANDLER
   ====================================================== */

async function handleJoin(phone, messageText) {
  const parts = messageText.split(" ");

  if (parts.length !== 2 || parts[0].toUpperCase() !== "JOIN") {
    return "To join your residency, reply:\n\nJOIN <ACCESS_CODE>";
  }

  const accessCode = parts[1].toUpperCase();

  // Validate residency
  const residencyResult = await pool.query(
    `SELECT id, name FROM residencies WHERE access_code = $1 LIMIT 1`,
    [accessCode]
  );

  if (residencyResult.rows.length === 0) {
    return "Invalid access code. Please check and try again.";
  }

  const residency = residencyResult.rows[0];

  // Double-check phone not already registered (safety)
  const existing = await pool.query(
    `SELECT id FROM residents WHERE phone = $1 LIMIT 1`,
    [phone]
  );

  if (existing.rows.length > 0) {
    return "You are already linked to a residency.";
  }

  // Insert resident
  await pool.query(
    `
    INSERT INTO residents (phone, full_name, residency_id)
    VALUES ($1, $2, $3)
    `,
    [phone, "WhatsApp User", residency.id]
  );

  return `Welcome 🎉\nYou are now linked to ${residency.name}.`;
}

/* ======================================================
   SIMPLE REPLY WRAPPER
   (Adjust depending on WhatsApp provider)
   ====================================================== */

function reply(res, message) {
  return res.json({
    reply: message
  });
}

export default router;