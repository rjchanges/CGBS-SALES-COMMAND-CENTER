# Deployment and configuration

## Production architecture

The Vite frontend is a static site. The Express API verifies Supabase Auth access tokens and performs CRM transactions through the PostgreSQL adapter using the authenticated database role, allowing Supabase RLS policies to remain active. Production does not fall back to local JSON storage.

## Render monorepo settings

For the API web service, use the repository root as its Root Directory:

- Build command: `npm ci && npm run build`
- Start command: `npm --prefix apps/api start`
- Health check path: `/api/health`

For the frontend static site, use the same root:

- Build command: `npm ci && npm run build`
- Publish directory: `apps/web/dist`
- Configure the `VITE_*` values at build time.

Set API environment variables on the API service only:

- `NODE_ENV=production`
- `DEMO_MODE=false`
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `DATABASE_URL`
- `DATABASE_POOL_MAX=5` (optional)
- `WEB_ORIGIN` (the deployed frontend origin)

Set frontend build variables on the static site:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_API_URL` (the public API origin)

Obtain the PostgreSQL URI from Supabase Dashboard → **Connect**. `DATABASE_URL` is server-only. The API enforces verified TLS through `pg`; an explicit `sslmode` parameter, if present, must request TLS (`require`, `verify-ca`, or `verify-full`). Never put a database URI, database password, or service-role key in frontend variables.

## Health and troubleshooting

After deploy, request `https://<api-host>/api/health`. It returns whether the storage URL is configured, whether PostgreSQL is reachable, and whether required schema tables/columns exist. The response never contains the connection URI or credentials.

- Missing or invalid URL: correct the API service's `DATABASE_URL` value.
- Rejected credentials: replace the username/password using the URI from Supabase Connect.
- Host resolution, timeout, or TLS error: check the selected Supabase direct/pooler connection mode and host networking.
- Connected but incomplete schema: inspect the missing items and the migration plan before applying any migration.

Do not reset the Supabase database or automatically apply migrations from a deployment. Preserve existing data and review the remote migration plan first.

## Local demo

`DEMO_MODE=true` enables the fictional local JSON demo only outside production. Do not enter real customer information in demo mode. With `NODE_ENV=production`, the API ignores demo mode and requires real authentication and PostgreSQL storage.
