import fetch from "node-fetch";

export async function authenticateUser(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing token" });
    }

    const token = authHeader.split(" ")[1];

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error("Supabase environment variables missing");
      return res.status(500).json({ error: "Server misconfigured" });
    }

    const response = await fetch(
      `${supabaseUrl}/auth/v1/user`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: supabaseAnonKey,
        },
      }
    );

    if (!response.ok) {
      return res.status(401).json({ error: "Invalid token" });
    }

    const user = await response.json();

    if (!user || !user.id) {
      return res.status(401).json({ error: "Invalid token" });
    }

    // Attach Supabase user info to request
    req.user = {
      sub: user.id,
      email: user.email,
    };

    next();
  } catch (err) {
    console.error("Auth middleware error:", err);
    return res.status(500).json({ error: "Authentication failed" });
  }
}
