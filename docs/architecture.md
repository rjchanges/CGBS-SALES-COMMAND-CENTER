# Architecture

## Local demo runtime

The Vite application on port 5173 calls the Express API on port 4100 through a development proxy. The API uses a local demo token and persists its state to apps/api/data/local.json. Writes are serialized within one API process and written through a temporary file rename to reduce partial-file risk.

The demo dataset is fictional. It is seeded on first read and can be reset with the project reset script. This storage and authentication arrangement is for a single-user preview only.

## UI modules

React Router exposes Home Page, Leads, Calling Workspace, Follow-ups, Calendar, Opportunities, Reports, Notifications and Settings. Email template editing remains available through the legacy route but is not in the sidebar. Dashboard charts and KPIs are calculated by the API from saved records, including real daily and monthly aggregates.

Shared validation and calculations live in packages/shared. Forms use Zod and React Hook Form. CSV exports escape spreadsheet formula prefixes. Imports validate and preview rows, then skip duplicates rather than overwriting existing leads.

## API

Protected demo endpoints require Authorization: Bearer demo-session. The token is only valid while the local demo flag is enabled.

- POST /api/auth/demo starts the local demo session.
- GET /api/bootstrap returns workspace data and dashboard metrics.
- GET, POST, PATCH and DELETE /api/leads support lead operations.
- POST /api/leads/:id/archive archives or restores a lead.
- POST /api/import validates and deduplicates previewed rows.
- GET and POST /api/calls list and log manual call outcomes.
- GET, POST and PATCH /api/tasks manage follow-ups.
- GET, POST and PATCH /api/opportunities manage opportunities and stages.
- GET /api/activities returns activity history.
- GET and PUT /api/templates manage email templates.
- GET and PUT /api/settings manage local targets and locale.
- POST /api/ai/outreach returns AI suggestions or a template fallback.
- GET /api/reports/summary returns calculated metrics.
- GET /api/calendar returns scheduled activities.
- GET /api/health is an unauthenticated health check.

The API applies a JSON request size limit, CORS and rate limiting. The optional AI key is read by the server only.

## Production work still required

The migration and RLS policies are schema foundations, not an active adapter. Before deployment, replace local JSON storage and demo authentication with Supabase Auth and user-scoped PostgreSQL queries. Map profile roles to server authorization, test RLS with separate users, add audit-log writes, schedule reminders in a backend job service, and implement secure Microsoft OAuth token storage.
