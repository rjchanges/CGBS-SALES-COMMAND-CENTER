# Exotel click-to-call setup

The CRM calls Exotel's **Connect Two Numbers** endpoint. Exotel calls the verified salesperson first; after the agent answers, Exotel calls the lead and bridges the call. The browser never receives Exotel credentials. Call recording is explicitly disabled (`Record=false`).

## Environment

Set these variables in the API server environment (the root `.env` is used for local development):

- `EXOTEL_REGION`: `india` for Mumbai accounts or `singapore` for Singapore accounts. The API host is selected by this value.
- `EXOTEL_ACCOUNT_SID`, `EXOTEL_API_KEY`, `EXOTEL_API_TOKEN`: Exotel API credentials.
- `EXOTEL_CALLER_ID`: the ExoPhone/virtual number authorized for outbound calls.
- `EXOTEL_WEBHOOK_BASE_URL`: public HTTPS origin for this API. Exotel is sent `{origin}/api/exotel/callback`.
- `EXOTEL_WEBHOOK_USERNAME` and `EXOTEL_WEBHOOK_PASSWORD`: callback Basic Auth credentials. Have Exotel configure the same credentials for this endpoint. Callback handling rejects unauthenticated requests.
- `EXOTEL_SMS_FROM`: Exotel SMS sender used for phone verification OTPs.
- `EXOTEL_DLT_ENTITY_ID` and `EXOTEL_DLT_TEMPLATE_ID`: approved Indian DLT values required for India SMS verification.
- `CALLING_OTP_SECRET`: optional strong random secret used to hash temporary OTPs. If unset, the server derives the HMAC key from the Exotel API token.

Never add these values to `VITE_*` variables or frontend code. Keep `.env` out of source control.

## Exotel account setup

1. Obtain the Account SID, API key/token, and an outbound-enabled ExoPhone from the Exotel dashboard.
2. Set `EXOTEL_REGION` to the region where the account is provisioned. India uses `api.in.exotel.com`; Singapore uses `api.exotel.com`.
3. Provision a public HTTPS API URL with a trusted certificate. Localhost is not reachable by Exotel, so callbacks cannot be verified locally unless a secured HTTPS tunnel is configured.
4. Ask Exotel to configure HTTP Basic Auth on the callback URL with the webhook username/password above. Configure the SMS sender and approved DLT entity/template for India OTP delivery.
5. Restart the API and open **Settings → Calling**. A salesperson requests a code, verifies the code sent to their own number, then uses the Calling Workspace phone action.

The API uses `POST /v1/Accounts/{sid}/Calls/connect` with the verified agent number as `From`, the lead number as `To`, the configured ExoPhone as `CallerId`, `Record=false`, and callbacks for `answered` and `terminal`. It uses Call Details (`?details=true`) to distinguish the agent leg from the bridged client leg when the workspace refreshes call status. Exotel callbacks are idempotently applied and final provider calls are logged once to CRM calls and activity history.

## Current deployment limitation

This repository currently runs a local demo user and stores records in `apps/api/data/local.json`; the runtime does not connect to Supabase Auth/Postgres. Phone profiles and calls are therefore persisted in that existing local JSON store and scoped by the authenticated server actor ID. Configure real authentication and a transactional production database before using this for multiple employees in production. No real Exotel credentials were available in this workspace, so provider requests and webhook handling are covered with mocks; a real outbound call and live SMS verification still require an authorized Exotel account and public HTTPS deployment.

## References

- [Connect Two Numbers](https://developer.exotel.com/docs/voice-v1/api-reference/connect-two-numbers)
- [Call Details and status callbacks](https://developer.exotel.com/docs/voice-v1/api-reference/call-details)
- [Regional API hosts](https://developer.exotel.com/docs/voice)
- [Exotel callback Basic Auth](https://docs.exotel.com/voice-apis/implementing-your-https-event-endpoint-for-real-time-call-events)
- [Exotel SMS API and regional hosts](https://developer.exotel.com/docs/sms-api/overview)
