import { jwtVerify, createRemoteJWKSet, decodeProtectedHeader } from "jose";

const SUPABASE_PROJECT_URL = "https://uxygywxiwkkaokbofvob.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

/* =====================================================
   SUPABASE JWKS (FOR ASYMMETRIC TOKENS ONLY)
===================================================== */

const JWKS = createRemoteJWKSet(
  new URL(`${SUPABASE_PROJECT_URL}/auth/v1/.well-known/jwks.json`)
);

/* =====================================================
   VERIFY HS256 / LEGACY TOKENS VIA SUPABASE AUTH
===================================================== */

async function verifyWithSupabaseAuthServer(token) {
  const response = await fetch(`${SUPABASE_PROJECT_URL}/auth/v1/user`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON_KEY
    }
  });

  if (!response.ok) {
    throw new Error(`Supabase auth verification failed (${response.status})`);
  }

  const user = await response.json();

  return {
    sub: user.id,
    email: user.email,
    role: user.role || "authenticated"
  };
}

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

    if (!token) {
      return res.status(401).json({
        error: "Missing token"
      });
    }

    const header = decodeProtectedHeader(token);
    let payload;

    // RS256 / ES256 / other asymmetric algs → verify against JWKS
    if (header.alg && header.alg.startsWith("RS")) {
      const verified = await jwtVerify(token, JWKS, {
        issuer: `${SUPABASE_PROJECT_URL}/auth/v1`,
        audience: "authenticated"
      });

      payload = verified.payload;
    } else {
      // HS256 / legacy shared-secret tokens → verify with Supabase Auth server
      if (!SUPABASE_ANON_KEY) {
        throw new Error("SUPABASE_ANON_KEY is required for HS256 token verification");
      }

      payload = await verifyWithSupabaseAuthServer(token);
    }

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