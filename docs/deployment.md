# Deployment and configuration

## Production architecture

The Vite frontend is a static site. The Express API verifies Supabase Auth access tokens and performs CRM transactions through the PostgreSQL adapter using the authenticated database role, allowing Supabase RLS policies to remain active. Production does not fall back to local JSON storage.

## Render monorepo settings

For the API web service, use the repository root as its Root Directory:

- Build command: `npm ci && npm run build`
- Start command: `npm --prefix apps/api start`
- Health check path: `/api/health`

The API trusts one immediate Render-managed proxy hop for Express client-IP and rate-limit handling. It does not trust an arbitrary proxy chain.

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
- `DATABASE_SSL_CA_FILE=/etc/secrets/supabase-prod-ca.crt` (if the Render runtime does not trust the Supabase chain)
- `WEB_ORIGIN` (the deployed frontend origin)

Set frontend build variables on the static site:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_API_URL` (the public API origin)

Obtain the PostgreSQL URI from Supabase Dashboard → **Connect**. `DATABASE_URL` is server-only. The API enforces verified TLS through `pg`. It removes URI SSL options before configuring the driver so they cannot replace the explicit TLS object. If Node cannot validate the endpoint chain, download the project's CA certificate from Supabase **Database → Settings → SSL Configuration** and add it to the API service as a Render secret file named `supabase-prod-ca.crt`; set `DATABASE_SSL_CA_FILE=/etc/secrets/supabase-prod-ca.crt`. Alternatively, configure the full PEM in the API-only `DATABASE_SSL_CA` environment variable. Use one CA input only. The API validates the CA PEM and leaves `rejectUnauthorized: true`; it has no insecure fallback. Never put a database URI, database password, or CA contents in frontend variables.

## Health and troubleshooting

After deploy, request `https://<api-host>/api/health`. It returns whether the storage URL is configured, whether PostgreSQL is reachable, and whether required schema tables/columns exist. The response never contains the connection URI or credentials.

- Missing or invalid URL: correct the API service's `DATABASE_URL` value.
- Rejected credentials: replace the username/password using the URI from Supabase Connect.
- Host resolution or timeout: check the selected Supabase direct/session-pooler connection mode and host networking.
- Untrusted TLS chain: configure the exact project's downloaded CA as a Render secret file or server-only environment variable; do not disable certificate verification.
- Connected but incomplete schema: inspect the missing items and the migration plan before applying any migration.

Do not reset the Supabase database or automatically apply migrations from a deployment. Preserve existing data and review the remote migration plan first.

## Local demo

`DEMO_MODE=true` enables the fictional local JSON demo only outside production. Do not enter real customer information in demo mode. With `NODE_ENV=production`, the API ignores demo mode and requires real authentication and PostgreSQL storage.
