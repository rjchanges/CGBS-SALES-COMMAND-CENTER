# CGBS Sales Command Center

CGBS CRM for sales team.

A responsive sales CRM workspace based on the supplied screenshot. This build provides a local demo with a React + Vite frontend, Express REST API, and fictional JSON records.

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
npm install --prefix packages/shared
npm install --prefix apps/api
npm install --prefix apps/web
Copy-Item .env.example .env
npm run dev
```

Open the Vite address shown in the terminal and choose **Continue to demo workspace**. The API seeds fictional records on first access. Data is stored in `apps/api/data/local.json`. Run `npm run db:reset` to restore the starting records.

For a production build, use `npm run build`. Run shared/API unit tests with `npm test`. For browser tests, run `Set-Location apps/web`, then `npx playwright install chromium` and `npx playwright test`.

## Deployment limits

The local demo uses a fixed demo session and a JSON file. It is a single-user preview, not a secure multi-user CRM. Do not enter real customer information. The Supabase schema and RLS migration are included, but the app does not yet connect to Supabase Auth or Postgres and does not enforce those policies at runtime. Production authentication and database integration remain required. Setting the local demo flag off disables API access.

The root environment example contains local API settings and placeholders for optional services. `OPENAI_API_KEY` and `OPENAI_MODEL` enable server-side outreach generation when configured. Generation sends the selected lead details only after the user requests suggestions. Without a key, a local template fallback is used. See [EXOTEL_CALLING.md](EXOTEL_CALLING.md) for the optional Exotel click-to-call and verified phone setup.

Supabase URL and public key variables are placeholders and are not consumed by the current app. Microsoft Graph OAuth is not implemented; the calling page opens an Outlook compose deeplink and saved templates fall back to mailto drafts. No telephony provider or backend reminder scheduler is configured. Never put service keys or provider secrets in frontend variables.

## Database schema

The initial migration is supabase/migrations/202610230001_initial_schema.sql. The workflow upgrade migration is supabase/migrations/202610250001_workflow_upgrade.sql; it adds company net worth, close attribution, completion details, event end times, and daily targets. Apply these only to a dedicated development project and provision administrator roles through a trusted SQL editor.

## Project map

- `apps/web`: React, Vite, TypeScript, Tailwind, React Router, Recharts, form validation, import/export UI.
- `apps/api`: Express REST API, validation, rate limiting, local demo persistence, optional server-side AI call.
- `packages/shared`: shared schemas, calculations, safe URL handling, and CSV injection protection.
- `supabase/migrations`: PostgreSQL schema and row-level policies.
- `docs`: API reference, architecture, schema, deployment and troubleshooting details.
