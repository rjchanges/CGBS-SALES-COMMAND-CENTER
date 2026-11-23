-- Columns and RLS-backed tables required by the current CRM API contracts.
-- This migration is review-only until explicitly applied to the hosted project.

alter table public.leads
  add column if not exists alternative_contact_method text,
  add column if not exists alternative_contact_notes text not null default '',
  add column if not exists actual_close_at timestamptz,
  add column if not exists closed_by uuid references public.profiles(id) on delete set null,
  add column if not exists loss_reason text not null default '',
  add column if not exists pre_close_opportunity_stages jsonb not null default '[]'::jsonb;

alter table public.calls
  add column if not exists client_mutation_id text,
  add column if not exists contact_method text,
  add column if not exists provider text,
  add column if not exists provider_call_id text,
  add column if not exists started_at timestamptz,
  add column if not exists ended_at timestamptz,
  add column if not exists duration_seconds integer;
create unique index if not exists calls_creator_mutation_unique
  on public.calls (created_by, client_mutation_id) where client_mutation_id is not null;
drop policy if exists calls_update_creator on public.calls;
create policy calls_update_creator on public.calls for update to authenticated
  using (created_by = auth.uid() or public.can_manage_team())
  with check (created_by = auth.uid() or public.can_manage_team());
grant update on public.calls to authenticated;

alter table public.activities drop constraint if exists activities_activity_type_check;
alter table public.activities add constraint activities_activity_type_check
  check (activity_type in ('Call','Stage change','Follow-up','Note','Opportunity','Lead update','Email','Meeting'));

alter table public.follow_up_tasks
  add column if not exists completed_by uuid references public.profiles(id) on delete set null,
  add column if not exists schedule_history jsonb not null default '[]'::jsonb;

alter table public.opportunities
  add column if not exists loss_reason text not null default '',
  add column if not exists pre_close_stage text,
  add column if not exists accomplished_by_name text;

alter table public.calendar_events
  add column if not exists source_type text,
  add column if not exists source_notes text not null default '';

alter table public.user_preferences
  add column if not exists daily_call_target integer not null default 40,
  add column if not exists daily_followup_target integer not null default 8,
  add column if not exists daily_meeting_target integer not null default 3,
  add column if not exists monthly_revenue_target numeric(16,2) not null default 0;

create table if not exists public.calling_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  phone text not null default '',
  verified_at timestamptz,
  pending_phone text not null default '',
  verification_code_hash text not null default '',
  verification_expires_at timestamptz,
  verification_attempts integer not null default 0 check (verification_attempts >= 0),
  updated_at timestamptz not null default now()
);
alter table public.calling_profiles enable row level security;
drop policy if exists calling_profiles_owner on public.calling_profiles;
create policy calling_profiles_owner on public.calling_profiles for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.voice_calls (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  user_name text not null,
  from_number text not null,
  to_number text not null,
  provider text not null check (provider = 'exotel'),
  provider_call_id text,
  status text not null check (status in ('Request Submitted','Calling You','Connecting to Client','Connected','Completed','No Answer','Busy','Failed','Cancelled')),
  idempotency_key text not null,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  last_provider_event_id text,
  error_message text not null default '',
  outcome_recorded_at timestamptz,
  unique (user_id, idempotency_key)
);
create index if not exists voice_calls_lead_requested_idx on public.voice_calls (lead_id, requested_at desc);
create index if not exists voice_calls_provider_id_idx on public.voice_calls (provider_call_id) where provider_call_id is not null;
alter table public.voice_calls enable row level security;
drop policy if exists voice_calls_read on public.voice_calls;
create policy voice_calls_read on public.voice_calls for select to authenticated
  using (user_id = auth.uid() or public.can_manage_team());
drop policy if exists voice_calls_insert on public.voice_calls;
create policy voice_calls_insert on public.voice_calls for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.leads l where l.id = lead_id));
drop policy if exists voice_calls_update on public.voice_calls;
create policy voice_calls_update on public.voice_calls for update to authenticated
  using (user_id = auth.uid() or public.can_manage_team())
  with check (user_id = auth.uid() or public.can_manage_team());

create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('task','event')),
  source_id uuid not null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  owner_name text not null,
  send_at timestamptz not null,
  minutes_before integer,
  channels jsonb not null default '["in-app"]'::jsonb,
  enabled boolean not null default true,
  status text not null default 'Pending' check (status in ('Pending','Delivered','Failed','Cancelled')),
  idempotency_key text not null unique,
  attempts integer not null default 0 check (attempts >= 0),
  delivered_at timestamptz,
  last_error text not null default '',
  event_start_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists reminders_due_idx on public.reminders (send_at) where enabled and status = 'Pending';
create index if not exists reminders_source_idx on public.reminders (source_type, source_id);
alter table public.reminders enable row level security;
drop policy if exists reminders_owner on public.reminders;
create policy reminders_owner on public.reminders for all to authenticated
  using (owner_id = auth.uid() or public.can_manage_team())
  with check (owner_id = auth.uid() or public.can_manage_team());
alter table public.notifications
  add column if not exists reminder_id uuid references public.reminders(id) on delete set null;
create unique index if not exists notifications_reminder_once
  on public.notifications (reminder_id) where reminder_id is not null;

grant select, insert, update, delete on public.calling_profiles, public.voice_calls, public.reminders to authenticated;

-- Authenticated employees may create company records for leads. Updates remain
-- restricted to an admin/manager or an owner of a lead attached to that company.
drop policy if exists companies_insert_authenticated on public.companies;
create policy companies_insert_authenticated on public.companies for insert to authenticated
  with check (auth.uid() is not null);
drop policy if exists companies_update_authorized on public.companies;
create policy companies_update_authorized on public.companies for update to authenticated
  using (public.can_manage_team() or exists (select 1 from public.leads l where l.company_id = companies.id and l.assigned_to = auth.uid()))
  with check (public.can_manage_team() or exists (select 1 from public.leads l where l.company_id = companies.id and l.assigned_to = auth.uid()));
grant select, insert, update on public.companies to authenticated;

do $$ begin
  drop trigger if exists set_updated_at on public.calling_profiles;
  create trigger set_updated_at before update on public.calling_profiles for each row execute function public.set_updated_at();
  drop trigger if exists set_updated_at on public.reminders;
  create trigger set_updated_at before update on public.reminders for each row execute function public.set_updated_at();
end $$;
