// middleware/safeMode.js

export function enforceSafeMode(req, res, next) {
  if (process.env.SYSTEM_SAFE_MODE === "true") {
    const isMutation =
      req.method === "POST" ||
      req.method === "PUT" ||
      req.method === "PATCH" ||
      req.method === "DELETE";

    if (isMutation) {
      return res.status(503).json({
        error: "System is currently in safe mode (read-only).",
      });
    }
  }

  next();
}