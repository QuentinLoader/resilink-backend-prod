import express from "express";
import { runTrialNotifications } from "../jobs/trialNotifications.js";

const router = express.Router();

function requireInternalKey(req, res, next) {
  const incomingKey = req.headers["x-internal-key"];
  const expectedKey = process.env.INTERNAL_JOB_SECRET;

  if (!expectedKey) {
    return res.status(500).json({ error: "INTERNAL_JOB_SECRET not configured" });
  }

  if (!incomingKey || incomingKey !== expectedKey) {
    return res.status(403).json({ error: "Forbidden" });
  }

  next();
}

router.post("/run-trial-notifications", requireInternalKey, async (req, res) => {
  try {
    const result = await runTrialNotifications();
    return res.json({
      success: true,
      result
    });
  } catch (error) {
    console.error("Internal trial notification route error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to run trial notifications"
    });
  }
});

export default router;