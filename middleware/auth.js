import { jwtVerify, createRemoteJWKSet } from "jose";

const SUPABASE_PROJECT_URL = "https://uxygywxiwkkaokbofvob.supabase.co";

/* =====================================================
   SUPABASE JWKS (PUBLIC ENDPOINT)
===================================================== */

const JWKS = createRemoteJWKSet(
  new URL(`${SUPABASE_PROJECT_URL}/auth/v1/.well-known/jwks.json`)
);

/* =====================================================
   AUTHENTICATE USER
===================================================== */

export async function authenticateUser(req, res, next) {
  try {

    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Missing authorization header"
      });
    }

    const token = authHeader.split(" ")[1];

    const { payload } = await jwtVerify(token, JWKS);

    /* -----------------------------------------
       Map Supabase user
    ----------------------------------------- */

    req.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role || null
    };

    next();

  } catch (err) {

    console.error("JWT verification failed:", err);

    return res.status(401).json({
      error: "Invalid or expired token"
    });

  }
}