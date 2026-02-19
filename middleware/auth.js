import { jwtVerify, createRemoteJWKSet } from "jose";

const SUPABASE_URL = "https://uxygywxiwkkaokbofvob.supabase.co";

const JWKS = createRemoteJWKSet(
  new URL(`${SUPABASE_URL}/auth/v1/keys`)
);

export async function authenticateUser(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing token" });
    }

    const token = authHeader.split(" ")[1];

    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `${SUPABASE_URL}/auth/v1`,
      audience: "authenticated",
    });

    // Attach verified JWT payload
    req.user = payload;

    next();
  } catch (err) {
    console.error("JWT verification failed:", err);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
