# Database schema

The initial Supabase migration creates profiles, companies, leads, lead_stage_history, opportunities, activities, calls, follow_up_tasks, email_templates, email_logs, notifications, daily_targets, audit_logs and user_preferences. The workflow upgrade migration adds company net worth, opportunity close date and closer attribution, completion notes, task end times, and follow-up/meeting targets.

Monetary fields use numeric types. Identifiers use UUIDs. Timestamps use timestamptz. Currency uses three-character codes. Leads store progression separately from win probability. Opportunities store generated weighted value. Unique indexes check lead email and normalized phone values. A partial unique index prevents multiple active RNR callbacks for one lead.

RLS is enabled on every table. Helper functions derive a user's role from profiles. Lead and related-record policies restrict salesperson access to assigned or shared leads. Managers and admins can read team records; destructive actions are manager/admin-only. Notifications and preferences are user-scoped.

The public.log_call function records the call, updates last-contacted and stage state, writes activity and stage history, and upserts one active RNR callback in a database transaction.

Apply the migration in a separate Supabase development project. Create an Auth user, then provision the matching profiles row and admin role from a trusted SQL editor. Run supabase/seed.sql only in a disposable project; it inserts fictional names, reserved example websites and test email addresses.

In Supabase mode, the current API uses the PostgreSQL adapter for CRM persistence. Each authenticated request is executed in a transaction after setting the database role to `authenticated` and supplying the verified user's JWT claims, so the database's RLS policies remain in force. Verify that the migrations required by the deployed application have been applied before treating the live database as ready.
