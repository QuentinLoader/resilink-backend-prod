export default function requireAuth(req, res, next) {
  const supabaseUserId = req.headers["x-user-id"];

  if (!supabaseUserId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  req.user = {
    supabase_user_id: supabaseUserId,
  };

  next();
}
