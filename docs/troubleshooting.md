# Troubleshooting

## API or web server does not start

- Use Node.js 20 or newer and reinstall each package from the project root: `npm install`, then `npm install --prefix packages/shared`, `npm install --prefix apps/api`, and `npm install --prefix apps/web`.
- Check whether ports 4100 or 5173 are already in use. Stop the existing process or adjust `PORT` and the Vite server configuration.
- Review `.env` and keep `DEMO_MODE=true` for the local preview. Production mode is unavailable until Supabase authentication and storage are implemented.

## Demo data does not reset

The API stores records in `apps/api/data/local.json`. Run `npm run db:reset` from the project root. The reset replaces the local demo records with fictional seed records.

## AI suggestions use a fallback

The API uses a template fallback unless a server-side `OPENAI_API_KEY` and supported `OPENAI_MODEL` are configured. This does not block other CRM workflows.

## Playwright cannot launch Chromium

From `apps/web`, run `npx playwright install chromium`, then run `npx playwright test`. Browser download requires network access. The UI test starts its own API and Vite servers and uses only fictional demo records.

## External integrations are unavailable

Supabase variables are placeholders only. Microsoft Graph, telephony, and a backend reminder scheduler are not configured in this build. The email action uses a `mailto:` draft, calls are logged manually after opening `tel:`, and browser notifications appear only while the app is open.
