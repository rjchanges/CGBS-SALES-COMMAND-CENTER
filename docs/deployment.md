# Deployment and configuration

## Current state

This repository is a local CRM demo and is not ready for production deployment. It currently uses a local demo token and JSON persistence. Setting DEMO_MODE=false intentionally blocks API access because Supabase Auth and database adapters are not connected.

Do not deploy the local JSON API for multi-user use, and do not enter real client contact details in demo mode.

## Supabase production work

1. Create a dedicated Supabase project and apply the included migration.
2. Configure Auth redirect URLs and disable open sign-up unless user provisioning is intentional.
3. Add the first Auth user and promote its profile to admin through a trusted SQL editor.
4. Implement Auth login/session renewal in the frontend and verify JWTs on every protected API route.
5. Replace JSON storage with Postgres queries under the user's JWT so RLS remains active. Never expose a service-role key to the browser.
6. Add tests with separate salesperson, manager and administrator accounts to verify access boundaries.
7. Add transactional writes for calls, stage history, opportunity changes and audit logs.

SUPABASE_URL and SUPABASE_ANON_KEY in the environment example are placeholders and are not read by the current app.

## Hosting plan after that work

- Host the static Vite frontend on a static web host.
- Host the Express API on a Node service with HTTPS, restricted CORS, safe request logging and rate limits.
- Use managed Supabase PostgreSQL and Auth.
- Store AI and Microsoft OAuth secrets only in the API host's secret manager.
- Use a durable job service for scheduled reminders; browser alerts are not sufficient.
- Use secure OAuth token storage and explicit user action before sending Microsoft Graph email.

## Optional services

- AI outreach can call the OpenAI Responses API from the server when OPENAI_API_KEY is set. The selected lead fields are sent only when a user asks for generation. The template fallback works without a key.
- Calling opens a draft through the Outlook compose deeplink; saved templates use mailto drafts. Microsoft Graph OAuth, token storage and sent-message logging are not implemented.
- Telephony is not integrated. Telephone links only open a calling application.
- Desktop notifications require permission and an open browser tab. No backend scheduler is configured.
