# CGBS Sales Command Center

CGBS CRM for sales team.

A responsive sales CRM workspace based on the supplied screenshot. The app supports an explicitly enabled fictional local demo and Supabase email/password authentication. Outside local demo/test mode, the Express API persists CRM records to Supabase PostgreSQL in per-user transactions with the `authenticated` database role and JWT claims, so existing RLS policies apply.

## Local demo features

- Dashboard KPIs and charts calculated from saved demo records.
- Lead search, filters, sorting, create/edit/archive/restore/delete, detail tabs, verified-link handling, multi-select archive, CSV/Excel preview import, duplicate skipping, and export.
- Searchable calling workspace with manual outcomes, notes, and reschedulable callbacks. Optional Exotel click-to-call verifies each user's own number, calls the agent first, then bridges the lead after the agent answers; provider statuses are retained with the call record. Provider calls remain disabled until Exotel is configured.
- Follow-up queues with completion/cancellation notes, call backs, proposals, meetings, and a day, work-week, week, month, and agenda calendar.
- Reports, editable email drafts, AI outreach fallback, browser notification permission, and configurable call, follow-up, meeting, and revenue targets.

The sample contacts and companies are fictional and use reserved example/test domains.

## Run locally

Use Node.js 20 or newer with npm. From the project root, install packages and start both development servers:

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Configure Supabase Auth and the server-only PostgreSQL connection in root `.env`, and Supabase web variables in `apps/web/.env.local`, as described in [SUPABASE_SETUP.md](SUPABASE_SETUP.md). Set `DEMO_MODE=false` to use Supabase Auth and PostgreSQL; new users receive only the Sales Executive role. Set `DEMO_MODE=true` only for the fictional local JSON demo. Production never falls back to JSON when database settings are missing.

For a production build, use `npm run build`. Run shared/API unit tests with `npm test`. For browser tests, run `Set-Location apps/web`, then `npx playwright install chromium` and `npx playwright test`.

## Deployment limits

The local demo uses a fixed demo session and a JSON file. It is a single-user preview, not a secure multi-user CRM. Do not enter real customer information. In Supabase mode, the backend verifies API access tokens and executes database work under each request's authenticated user role. Configure `DATABASE_URL` and apply the reviewed storage migration before enabling persistent CRM use. `GET /api/health` reports storage configuration, connectivity, and missing required tables without exposing credentials.

The root environment example contains local API settings and placeholders for optional services. `OPENAI_API_KEY` and `OPENAI_MODEL` enable server-side outreach generation when configured. Generation sends the selected lead details only after the user requests suggestions. Without a key, a local template fallback is used. See [EXOTEL_CALLING.md](EXOTEL_CALLING.md) for the optional Exotel click-to-call and verified phone setup.

Supabase public key variables are used by the authentication flow. Microsoft Graph OAuth is not implemented; the calling page opens an Outlook compose deeplink and saved templates fall back to mailto drafts. Never put service keys or provider secrets in frontend variables.

## Database schema

The repository contains ordered migrations under `supabase/migrations`. The seven existing migrations are already applied to the user's remote project; `202611210001_storage_adapter.sql` adds the extra fields and RLS-backed tables needed by current CRM features. It has not been applied remotely. Preview only the pending migration with the Supabase CLI and review it before applying. See [SUPABASE_SETUP.md](SUPABASE_SETUP.md) for setup steps.

## Project map

- `apps/web`: React, Vite, TypeScript, Tailwind, React Router, Recharts, form validation, import/export UI.
- `apps/api`: Express REST API, validation, rate limiting, RLS-scoped PostgreSQL persistence, explicit local demo persistence, optional server-side AI call.
- `packages/shared`: shared schemas, calculations, safe URL handling, and CSV injection protection.
- `supabase/migrations`: PostgreSQL schema and row-level policies.
- `docs`: API reference, architecture, schema, deployment and troubleshooting details.
