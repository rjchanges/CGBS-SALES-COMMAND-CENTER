# Supabase configuration status

Project: `ibashryxeakbrbqvovtj` (`https://ibashryxeakbrbqvovtj.supabase.co`).

The project's public Auth settings were queried during this task: email signup is enabled, but email auto-confirm is currently **off**. Supabase therefore will not issue a session directly from registration until the project setting is changed.

## Current implementation boundary

- The frontend has Supabase email/password sign-in, direct sign-up, password reset, and session restoration.
- The Express API verifies Supabase access tokens and loads the active user's role from `public.profiles`.
- New sign-ups receive the lowest-privilege `salesperson` role and can sign in immediately when Supabase Auth's Confirm email setting is off. No administrator approval is required.
- CRM routes now use a server-side PostgreSQL adapter when `DEMO_MODE=false`; transactions run as the database role `authenticated` with the verified user's JWT claims so RLS remains active. The adapter does not use a service-role connection for user CRUD.
- The storage adapter requires `DATABASE_URL` and the pending `202611210001_storage_adapter.sql` migration. No remote migration was applied by this workspace.
- No Supabase migration was applied from this workspace. The remote migration state was not inspected because no Supabase CLI, database password, or configured publishable key was available here.
- The previous `/auth/me` implementation queried `profiles` with `.single()` and converted every query error (missing row, RLS denial, missing table, or database/network error) into the same 403 message. That is the confirmed application bug. The exact remote database condition cannot be confirmed until the remote migration history/schema is inspected.
- Migration `202611200001_profile_recovery.sql` reasserts the Auth signup trigger, safely backfills missing profiles, and adds an authenticated `ensure_own_profile()` recovery RPC. Existing profiles are left untouched; a missing/new profile receives only the `salesperson` role.
- The adapter uses existing normalized tables for CRM entities. The seven migrations do not contain provider call state, verified calling profiles, scheduled reminder records, several API metadata fields, or reminder-to-notification linkage; the pending storage migration adds those missing pieces.

## Local environment

The root `.env` and `apps/web/.env.local` are ignored by Git. Keep the publishable key out of Git and never put a Supabase secret/service-role key in a `VITE_*` variable.

Backend, in root `.env`:

```env
DEMO_MODE=false
SUPABASE_URL=https://ibashryxeakbrbqvovtj.supabase.co
SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key
WEB_ORIGIN=http://localhost:5173
DATABASE_URL=postgresql://postgres:<db-password>@db.ibashryxeakbrbqvovtj.supabase.co:5432/postgres?sslmode=require
DATABASE_POOL_MAX=5
# Set one only when the runtime cannot verify Supabase with its system trust store.
DATABASE_SSL_CA_FILE=/etc/secrets/supabase-prod-ca.crt
```

Frontend, in `apps/web/.env.local`:

```env
VITE_SUPABASE_URL=https://ibashryxeakbrbqvovtj.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key
VITE_API_URL=http://localhost:4100
VITE_DEMO_MODE=false
```

The frontend key and server-side publishable key are the same public key. A secret/service-role key is not needed for Auth or ordinary CRM data requests. `DATABASE_URL` is server-only; never put it in a `VITE_*` variable. Obtain it in Supabase Dashboard → **Connect** → **App Frameworks/Connection string** → **URI**, or choose the Supavisor session pooler if the host cannot connect over IPv6. Replace the password placeholder. The adapter enforces TLS with certificate verification; it removes URI SSL parameters before constructing the `pg` pool so they cannot override explicit TLS options. If Node reports an untrusted Supabase CA chain, download the project's PostgreSQL CA from **Database → Settings → SSL Configuration** and configure it using either `DATABASE_SSL_CA` (full PEM value) or a Render secret file with `DATABASE_SSL_CA_FILE=/etc/secrets/<filename>`. Do not disable certificate checks. `DATABASE_POOL_MAX` defaults to 5 and can be lowered for small Render instances. The app can still run in local demo mode by setting `DEMO_MODE=true` in root `.env`; production ignores demo mode and never falls back to the JSON file.

## Local migration inventory

The repository has these eight migrations, in order:

1. `supabase/migrations/202610230001_initial_schema.sql`
2. `supabase/migrations/202610250001_workflow_upgrade.sql`
3. `supabase/migrations/202610260001_targets_calendar.sql`
4. `supabase/migrations/202611160001_auth_pending_approval.sql`
5. `supabase/migrations/202611180001_email_verified_self_activation.sql`
6. `supabase/migrations/202611190001_direct_signup.sql`
7. `supabase/migrations/202611200001_profile_recovery.sql`
8. `supabase/migrations/202611210001_storage_adapter.sql`

The first seven migrations have already been applied to the remote project according to the user. Migration 8 adds fields/tables absent from the existing schema that the current application uses (voice calls, calling profiles, reminders, user target preferences, and API metadata), plus RLS policies for those entities. It has not been applied. Do not reapply migrations 1–7. Preview the remote plan and confirm that only migration 8 is pending before any separate approval to apply it.

## Inspect the remote migration plan (do not apply yet)

Install the Supabase CLI, authenticate, and link the project from the repository root. Since migrations 1–7 are already applied, confirm the dry-run lists only migration 8:

```powershell
npx supabase login
npx supabase link --project-ref ibashryxeakbrbqvovtj
npx supabase db push --dry-run --remote
```

Review the complete dry-run output and compare it with the Supabase dashboard before applying anything. `db push --dry-run` only previews. Applying migrations requires a separate, explicit approval and command:

```powershell
npx supabase db push --remote
```

Do not run `db reset`, `db push --remote`, or SQL Editor scripts without separate approval. If the remote history does not recognize migrations 1–7, stop and reconcile the migration history instead of replaying them. The Supabase CLI is not installed in this workspace, so no remote migration dry run has been run.

## First administrator and team onboarding

1. Apply the reviewed migrations after approval.
2. In Supabase Dashboard → **Authentication → Sign In / Providers → Email**, turn **Confirm email** off to enable direct signup. This setting is currently off for auto-confirm (meaning email confirmation is required). Set the local Site URL to `http://localhost:5173`; allow `/reset-password` in redirect URLs.
3. Register the first user in the app. Supabase should return a session immediately.
4. A trusted project administrator promotes the first profile through Supabase SQL Editor. Replace the email before running:

```sql
update public.profiles p
set role = 'admin', active = true, pending_approval = false
from auth.users u
where p.id = u.id and u.email = 'admin@example.com';
```

5. Additional accounts are active immediately with the `salesperson` role. Public registration cannot assign `manager` or `admin`; those roles remain administrator-managed.

## Run locally

After configuring the environment and applying migration 8 after review/approval:

```powershell
npm install
npm run dev
```

This starts the web app at `http://localhost:5173` and API at `http://localhost:4100`. Direct signup can be tested after Supabase **Confirm email** is disabled. Set `DATABASE_URL` before using CRM pages. Check `http://localhost:4100/api/health`; it reports if the database connects and whether required tables are missing.

## Render configuration and storage diagnostics

Backend web service: set `NODE_ENV=production`, `DEMO_MODE=false`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `WEB_ORIGIN`, `DATABASE_URL`, and optionally `DATABASE_POOL_MAX=5` in the Render service's **Environment** settings. `DATABASE_URL` must be the PostgreSQL URI from Supabase Connect; it is not the Supabase project URL. Never add it as a `VITE_*` variable. The API recognizes a valid PostgreSQL URI even when it has no `sslmode` parameter. For the current certificate-chain error, add the exact CA downloaded for this Supabase project as a Render secret file (for example filename `supabase-prod-ca.crt`) and set `DATABASE_SSL_CA_FILE=/etc/secrets/supabase-prod-ca.crt`. Alternatively, paste the complete PEM into a server-only `DATABASE_SSL_CA` variable. Do not set both. The API validates that the supplied file contains CA certificate(s), and still rejects untrusted, expired, or hostname-mismatched certificates.

For a monorepo Render API service with the repository root as its Root Directory, use build command `npm ci && npm run build` and start command `npm --prefix apps/api start`. The API start script runs the compiled `apps/api/dist/server.js` build. Set `WEB_ORIGIN` to the deployed frontend origin.

Frontend static site: set build-time `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and `VITE_API_URL=https://cgbs-sales-command-center.onrender.com`. With the repository root as Root Directory, use build command `npm ci && npm run build` and publish directory `apps/web/dist`.

Check `https://cgbs-sales-command-center.onrender.com/api/health` after redeploying. It distinguishes missing/invalid URL configuration, TLS trust errors, rejected credentials, connection failures, and an incomplete schema without returning connection details. If it connects but required tables or columns are missing, review migration 8 below. The last health check before this fix reported an untrusted certificate chain; production remains unverified until the official project CA is configured and `/api/health` returns HTTP 200.

The user reports that migrations 1–7 are applied. Migration `202611210001_storage_adapter.sql` is still pending locally and is needed for current CRM fields/tables; preview it using the dry-run steps above, and apply only after separately reviewing and approving the plan. This code change does not apply migrations or alter production data.
