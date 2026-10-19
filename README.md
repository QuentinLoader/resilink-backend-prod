# ResLink backend

Express API deployed from this repository's `main` branch to Railway service
`resilink-backend-prod` in the `Reslink_SA` production environment.
Source control, hosting, authentication and email delivery operate independently
of Lovable. Only current application source and operational configuration belong
in this repository; production records and backups do not.

## Architecture

- **Railway Postgres:** managers, residencies, maintenance, artisans and Knowledge
  Base records. Keep credentials in Railway variables, never GitHub.
- **Supabase Authentication Cluster:** `nysyurwlggaklhskmzma`. Manager/admin tokens
  are verified by `middleware/auth.js`. Asymmetric JWTs use this cluster's JWKS,
  issuer and authenticated audience; legacy tokens use the same cluster's
  `/auth/v1/user` endpoint with its matching anon key.
- **Resend:** application notifications use the existing Addvision Shared Auth
  sending key through `utils/mailer.js`. Auth confirmation/recovery emails are
  sent centrally by the shared Supabase Auth configuration through Resend SMTP.
- **Resident/artisan portals:** existing access-code endpoints are served by this
  API; these portal users do not need separate Supabase login accounts.

## Configuration and local use

Use Node.js 24 and npm. Copy `.env.example` to a gitignored `.env.local`, supply
local credentials for the intended environment, then run:

```sh
npm ci
node --env-file=.env.local index.js
```

`npm start` starts the server with variables already supplied by the environment,
as Railway does. Local scripts do not automatically load `.env.local`.

| Variable | Purpose |
| --- | --- |
| DATABASE_URL | Postgres connection for the intended environment |
| SUPABASE_URL | Current Authentication Cluster URL; required at startup |
| SUPABASE_ANON_KEY | Matching cluster public anon key for legacy verification |
| RESEND_API_KEY | Existing Addvision Shared Auth sending credential |
| EMAIL_FROM | Verified sender, currently `ResLink <no-reply@addvision.co.za>` |
| APP_URL | Public frontend origin used in notification links |
| INTERNAL_JOB_SECRET | Protects trial-notification job requests |
| SYSTEM_SAFE_MODE | `true` blocks mutation requests; normally `false` |
| SUPPORT_EMAIL | Defaults to `support@addvision.co.za` |
| ADDVISION_ADMIN_EMAIL | Defaults to `quentin@addvision.co.za`; checked server-side |
| PORT | Railway supplies the listening port; local default is 3000 |

Do not change shared-cluster configuration for another application's benefit or
remove its existing redirect URLs. See the frontend operations guide for the
ResLink redirect patterns and custom-domain cutover.

## Checks and release

```sh
npm run check
npm test
git diff --check
```

`check` covers all application and tooling JavaScript files. Tests cover Knowledge
Base contracts, commercial access, default maintenance contacts and maintenance
status history. Push tested changes to `main`; Railway's existing Git connection
builds and deploys them. Confirm deployment success and `GET /api/health` returning
`{"status":"OK"}` before considering a release complete. The root route also
responds with an API status message. Keep registered routes and migrations unless
their replacement and compatibility requirements have been assessed.

## Operational routes

| Prefix | Purpose |
| --- | --- |
| /api/manager | Authenticated manager accounts and workspaces |
| /api/admin | Server-authorised AddVision administration |
| /api/public/register-manager | Authenticated, idempotent manager setup after email confirmation |
| /api/resident | Access-code resident information and maintenance |
| /api/artisan | Access-code artisan profiles and assigned jobs |
| /api/internal/run-trial-notifications | POST with `x-internal-key` matching INTERNAL_JOB_SECRET |
| /api/whatsapp/webhook | Existing registered webhook; preserve its current contract |

Trial notifications are invoked through the protected internal route, not by a
process-local timer. Do not manually trigger it during a read-only check because
it sends real customer emails.

## Identity repair and repository policy

When a migrated, confirmed email cannot load its existing manager account, compare
the shared-cluster Auth ID with `managers.supabase_user_id`. Repair only an
unambiguous matching record in a transaction, preserving the manager primary key,
trial dates and `manager_residencies` links. Do not duplicate the manager or grant
administrator permission as a workaround.

`main` is the production branch. Superseded branches are removed after review;
historical branches were archived offline during the October 2026 cleanup.
Normal Git history remains available. Do not upload database snapshots, API keys,
passwords, portal access codes, customer records or Git backup bundles.
