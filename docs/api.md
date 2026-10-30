# API reference

The demo API listens on `http://localhost:4100`. All application routes use the `/api` prefix. Send JSON request bodies with `Content-Type: application/json`; authenticated demo routes require `Authorization: Bearer demo-session`.

## Session and status

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Health and current demo mode |
| `GET` | `/api/auth/config` | Reports which auth/email providers are configured |
| `POST` | `/api/auth/demo` | Starts a local fictional demo session |

## Workspace data

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/bootstrap` | Seeded workspace records and derived metrics |
| `GET` | `/api/leads` | Searchable/filterable lead list |
| `POST` | `/api/leads` | Create a lead |
| `PATCH` | `/api/leads/:id` | Update lead details |
| `DELETE` | `/api/leads/:id` | Delete a lead and related demo activity |
| `POST` | `/api/leads/:id/archive` | Archive or restore a lead |
| `POST` | `/api/import` | Validate and import rows, skipping duplicates |
| `GET` | `/api/calls` | Call log |
| `POST` | `/api/calls` | Log a call and create/reschedule an RNR callback |
| `GET` | `/api/tasks` | Follow-up tasks, optionally filtered by status/type |
| `POST` | `/api/tasks` | Create a follow-up task |
| `PATCH` | `/api/tasks/:id` | Reschedule, complete, or cancel a task |
| `GET` | `/api/opportunities` | Opportunity records |
| `POST` | `/api/opportunities` | Create an opportunity |
| `PATCH` | `/api/opportunities/:id` | Edit an opportunity or move its stage |
| `GET` | `/api/activities` | Activity history |
| `GET` | `/api/calendar` | Calendar events for an optional date range |
| `GET` | `/api/reports/summary` | Derived sales and activity metrics |
| `GET` | `/api/templates` | Email templates |
| `PUT` | `/api/templates/:id` | Update an email template |
| `GET` | `/api/settings` | Demo targets and preferences |
| `PUT` | `/api/settings` | Update demo settings |
| `POST` | `/api/ai/outreach` | Generate optional AI outreach suggestions or a local fallback |

The demo API uses a fixed, single-user token and local JSON persistence. It is not suitable for real customer data or deployment. Supabase Auth, PostgreSQL-backed repositories, permission checks, user administration, and production session handling are not connected yet. See [deployment notes](deployment.md) for the remaining configuration boundary.
