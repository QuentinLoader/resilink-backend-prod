import { jwtVerify, createRemoteJWKSet } from "jose";

const SUPABASE_PROJECT_URL = "https://uxygywxiwkkaokbofvob.supabase.co";

// ✅ Correct JWKS endpoint
const JWKS = createRemoteJWKSet(
  new URL(`${SUPABASE_PROJECT_URL}/auth/v1/.well-known/jwks.json`)
);

export async function authenticateUser(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing token" });
    }

    const token = authHeader.split(" ")[1];

    const { payload } = await jwtVerify(token, JWKS);

    req.user = payload;

    next();
  } catch (err) {
    console.error("JWT verification failed:", err.message);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
