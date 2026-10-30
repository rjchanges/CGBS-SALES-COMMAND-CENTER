create extension if not exists pgcrypto;

do $$ begin
  create type public.user_role as enum ('admin', 'manager', 'salesperson');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role public.user_role not null default 'salesperson',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  website text,
  logo_url text,
  industry text,
  size text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name)
);
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  lead_number bigint generated always as identity unique,
  company_id uuid references public.companies(id) on delete set null,
  full_name text not null,
  role_title text,
  email text,
  phone text,
  linkedin_url text,
  source text not null default 'Other',
  status text not null default 'New Lead' check (status in ('New Lead','Contacted','Interested','Follow-up Required','RNR','Meeting Scheduled','Qualified','Proposal Sent','Negotiation','Won','Lost')),
  priority text not null default 'Medium' check (priority in ('Low','Medium','High','Critical')),
  estimated_revenue numeric(16,2) not null default 0 check (estimated_revenue >= 0),
  currency char(3) not null default 'INR',
  progression numeric(5,2) not null default 5 check (progression between 0 and 100),
  win_probability numeric(5,2) not null default 10 check (win_probability between 0 and 100),
  assigned_to uuid references public.profiles(id) on delete set null,
  is_shared boolean not null default false,
  next_follow_up_at timestamptz,
  last_contacted_at timestamptz,
  expected_close_at timestamptz,
  ai_outreach_topic text,
  ai_opening_message text,
  ai_email_subject text,
  ai_follow_up_approach text,
  notes text not null default '',
  archived boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists leads_email_unique on public.leads (lower(email)) where email is not null and email <> '';
create unique index if not exists leads_phone_unique on public.leads (regexp_replace(phone, '[^0-9]', '', 'g')) where phone is not null and regexp_replace(phone, '[^0-9]', '', 'g') <> '';
create index if not exists leads_owner_stage_idx on public.leads (assigned_to, status, priority);
create index if not exists leads_company_idx on public.leads (company_id);
create index if not exists leads_followup_idx on public.leads (next_follow_up_at) where archived = false;
create index if not exists leads_search_idx on public.leads using gin (to_tsvector('simple', coalesce(full_name,'') || ' ' || coalesce(email,'') || ' ' || coalesce(phone,'')));

create table if not exists public.lead_stage_history (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  from_stage text,
  to_stage text not null,
  entered_at timestamptz not null default now(),
  exited_at timestamptz,
  changed_by uuid references public.profiles(id) on delete set null,
  reason text
);
create index if not exists lead_stage_history_lead_idx on public.lead_stage_history (lead_id, entered_at desc);

create table if not exists public.opportunities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  lead_id uuid not null references public.leads(id) on delete cascade,
  amount numeric(16,2) not null check (amount >= 0),
  currency char(3) not null default 'INR',
  probability numeric(5,2) not null default 10 check (probability between 0 and 100),
  weighted_value numeric(16,2) generated always as (round(amount * probability / 100, 2)) stored,
  stage text not null default 'Qualification' check (stage in ('Qualification','Discovery','Proposal','Negotiation','Closed Won','Closed Lost')),
  expected_close_at timestamptz,
  assigned_to uuid references public.profiles(id) on delete set null,
  notes text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists opportunities_owner_stage_idx on public.opportunities (assigned_to, stage, expected_close_at);
create index if not exists opportunities_lead_idx on public.opportunities (lead_id);

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  activity_type text not null check (activity_type in ('Call','Stage change','Follow-up','Note','Opportunity','Email','Meeting')),
  title text not null,
  detail text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists activities_lead_time_idx on public.activities (lead_id, created_at desc);
create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  outcome text not null check (outcome in ('Answered','No Answer','Busy','RNR','Interested','Not Interested','Meeting Scheduled','Invalid Number','Call Back Later')),
  notes text not null default '',
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists calls_lead_time_idx on public.calls (lead_id, created_at desc);
create index if not exists calls_creator_time_idx on public.calls (created_by, created_at desc);

create table if not exists public.follow_up_tasks (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  task_type text not null check (task_type in ('Call','Email','Meeting','RNR callback','Other')),
  due_at timestamptz not null,
  priority text not null default 'Medium' check (priority in ('Low','Medium','High','Critical')),
  assigned_to uuid references public.profiles(id) on delete set null,
  notes text not null default '',
  status text not null default 'Due' check (status in ('Due','Completed','Cancelled')),
  cancelled_reason text,
  completed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists followups_owner_due_idx on public.follow_up_tasks (assigned_to, due_at) where status = 'Due';
create index if not exists followups_lead_active_idx on public.follow_up_tasks (lead_id, task_type) where status = 'Due';
create unique index if not exists one_active_rnr_callback on public.follow_up_tasks (lead_id) where status = 'Due' and task_type = 'RNR callback';

create table if not exists public.email_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subject text not null,
  body text not null,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.email_logs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  template_id uuid references public.email_templates(id) on delete set null,
  recipient text not null,
  subject text not null,
  provider_message_id text,
  status text not null check (status in ('Draft','Sent','Failed')),
  sent_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists email_logs_lead_time_idx on public.email_logs (lead_id, created_at desc);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  task_id uuid references public.follow_up_tasks(id) on delete cascade,
  title text not null,
  body text not null default '',
  channel text not null default 'in_app' check (channel in ('in_app','desktop','email')),
  read_at timestamptz,
  scheduled_for timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_unread_idx on public.notifications (user_id, created_at desc) where read_at is null;

create table if not exists public.daily_targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  target_date date not null,
  calls_target integer not null default 40 check (calls_target >= 0),
  revenue_target numeric(16,2) not null default 0 check (revenue_target >= 0),
  currency char(3) not null default 'INR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, target_date)
);
create table if not exists public.user_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  timezone text not null default 'Asia/Kolkata',
  currency char(3) not null default 'INR',
  notification_preferences jsonb not null default '{"in_app":true,"desktop":false}'::jsonb,
  visible_lead_columns jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_entity_idx on public.audit_logs (entity_type, entity_id, created_at desc);
create index if not exists audit_logs_actor_idx on public.audit_logs (actor_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end $$;
do $$ declare tab text; begin
  foreach tab in array array['profiles','companies','leads','opportunities','follow_up_tasks','email_templates','daily_targets','user_preferences'] loop
    execute format('drop trigger if exists set_updated_at on public.%I', tab);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', tab);
  end loop;
end $$;

create or replace function public.current_role()
returns public.user_role language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid() and active = true $$;
create or replace function public.can_manage_team()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(public.current_role() in ('admin','manager'), false) $$;
alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.leads enable row level security;
alter table public.lead_stage_history enable row level security;
alter table public.opportunities enable row level security;
alter table public.activities enable row level security;
alter table public.calls enable row level security;
alter table public.follow_up_tasks enable row level security;
alter table public.email_templates enable row level security;
alter table public.email_logs enable row level security;
alter table public.notifications enable row level security;
alter table public.daily_targets enable row level security;
alter table public.user_preferences enable row level security;
alter table public.audit_logs enable row level security;

create policy profiles_read_self_or_manager on public.profiles for select to authenticated
  using (id = auth.uid() or public.can_manage_team());
create policy profiles_admin_all on public.profiles for all to authenticated
  using (public.current_role() = 'admin') with check (public.current_role() = 'admin');

create policy companies_read_authenticated on public.companies for select to authenticated using (true);
create policy companies_manage_admin on public.companies for all to authenticated
  using (public.current_role() = 'admin') with check (public.current_role() = 'admin');

create policy leads_read_assigned_or_shared on public.leads for select to authenticated
  using (public.can_manage_team() or assigned_to = auth.uid() or is_shared = true);
create policy leads_insert_assigned on public.leads for insert to authenticated
  with check (public.can_manage_team() or assigned_to = auth.uid());
create policy leads_update_assigned on public.leads for update to authenticated
  using (public.can_manage_team() or assigned_to = auth.uid())
  with check (public.can_manage_team() or assigned_to = auth.uid());
create policy leads_delete_managers on public.leads for delete to authenticated
  using (public.current_role() in ('admin','manager'));

create policy stage_history_read on public.lead_stage_history for select to authenticated
  using (exists (select 1 from public.leads l where l.id = lead_id));
create policy stage_history_insert on public.lead_stage_history for insert to authenticated
  with check (changed_by = auth.uid() and exists (select 1 from public.leads l where l.id = lead_id));
create policy stage_history_manage on public.lead_stage_history for delete to authenticated
  using (public.current_role() in ('admin','manager'));

create policy opportunities_read on public.opportunities for select to authenticated
  using (public.can_manage_team() or assigned_to = auth.uid() or exists (select 1 from public.leads l where l.id = lead_id and (l.assigned_to = auth.uid() or l.is_shared)));
create policy opportunities_insert on public.opportunities for insert to authenticated
  with check (public.can_manage_team() or assigned_to = auth.uid());
create policy opportunities_update on public.opportunities for update to authenticated
  using (public.can_manage_team() or assigned_to = auth.uid())
  with check (public.can_manage_team() or assigned_to = auth.uid());
create policy opportunities_delete on public.opportunities for delete to authenticated
  using (public.current_role() in ('admin','manager'));

create policy activities_read on public.activities for select to authenticated
  using (exists (select 1 from public.leads l where l.id = lead_id));
create policy activities_insert on public.activities for insert to authenticated
  with check (created_by = auth.uid() and exists (select 1 from public.leads l where l.id = lead_id));
create policy activities_manage on public.activities for delete to authenticated
  using (public.current_role() in ('admin','manager'));

create policy calls_read on public.calls for select to authenticated
  using (exists (select 1 from public.leads l where l.id = lead_id));
create policy calls_insert on public.calls for insert to authenticated
  with check (created_by = auth.uid() and exists (select 1 from public.leads l where l.id = lead_id));
create policy calls_manage on public.calls for delete to authenticated
  using (public.current_role() in ('admin','manager'));

create policy followups_read on public.follow_up_tasks for select to authenticated
  using (public.can_manage_team() or assigned_to = auth.uid() or exists (select 1 from public.leads l where l.id = lead_id and (l.assigned_to = auth.uid() or l.is_shared)));
create policy followups_insert on public.follow_up_tasks for insert to authenticated
  with check (public.can_manage_team() or assigned_to = auth.uid());
create policy followups_update on public.follow_up_tasks for update to authenticated
  using (public.can_manage_team() or assigned_to = auth.uid())
  with check (public.can_manage_team() or assigned_to = auth.uid());
create policy followups_delete_managers on public.follow_up_tasks for delete to authenticated
  using (public.current_role() in ('admin','manager'));

create policy templates_read_authenticated on public.email_templates for select to authenticated
  using (is_active or public.can_manage_team());
create policy templates_manage on public.email_templates for all to authenticated
  using (public.can_manage_team()) with check (public.can_manage_team());
create policy email_logs_read on public.email_logs for select to authenticated
  using (exists (select 1 from public.leads l where l.id = lead_id));
create policy email_logs_insert on public.email_logs for insert to authenticated
  with check (created_by = auth.uid() and exists (select 1 from public.leads l where l.id = lead_id));

create policy notifications_owner on public.notifications for all to authenticated
  using (user_id = auth.uid() or public.can_manage_team())
  with check (user_id = auth.uid() or public.can_manage_team());
create policy daily_targets_owner on public.daily_targets for all to authenticated
  using (user_id = auth.uid() or public.can_manage_team())
  with check (user_id = auth.uid() or public.can_manage_team());
create policy preferences_owner on public.user_preferences for all to authenticated
  using (user_id = auth.uid() or public.current_role() = 'admin')
  with check (user_id = auth.uid() or public.current_role() = 'admin');
create policy audit_read_admin_manager on public.audit_logs for select to authenticated
  using (public.can_manage_team());
create policy audit_insert_authenticated on public.audit_logs for insert to authenticated
  with check (actor_id = auth.uid());

create or replace function public.log_call(
  p_lead_id uuid,
  p_outcome text,
  p_notes text default '',
  p_duration_seconds integer default 0,
  p_callback_at timestamptz default null
) returns public.calls
language plpgsql security invoker set search_path = public as $$
declare
  lead_row public.leads;
  call_row public.calls;
  new_stage text;
  callback_time timestamptz;
begin
  select * into lead_row from public.leads where id = p_lead_id for update;
  if not found then raise exception 'Lead not found'; end if;
  if not (public.can_manage_team() or lead_row.assigned_to = auth.uid() or lead_row.is_shared) then
    raise exception 'Not authorized to log activity for this lead' using errcode = '42501';
  end if;
  insert into public.calls(lead_id,outcome,notes,duration_seconds,created_by)
    values(p_lead_id,p_outcome,left(coalesce(p_notes,''),3000),greatest(0,p_duration_seconds),auth.uid()) returning * into call_row;
  new_stage := case p_outcome when 'Interested' then 'Interested' when 'RNR' then 'RNR' when 'Meeting Scheduled' then 'Meeting Scheduled' when 'Not Interested' then 'Lost' else null end;
  update public.leads set last_contacted_at = now(), updated_by = auth.uid(),
    status = coalesce(new_stage,status),
    progression = case when new_stage = 'Lost' then 0 else progression end
    where id = p_lead_id;
  insert into public.activities(lead_id,activity_type,title,detail,created_by)
    values(p_lead_id,'Call','Call logged · ' || p_outcome,left(coalesce(p_notes,''),3000),auth.uid());
  if new_stage is not null and new_stage is distinct from lead_row.status then
    update public.lead_stage_history set exited_at = now() where lead_id = p_lead_id and exited_at is null;
    insert into public.lead_stage_history(lead_id,from_stage,to_stage,changed_by)
      values(p_lead_id,lead_row.status,new_stage,auth.uid());
    insert into public.activities(lead_id,activity_type,title,detail,created_by)
      values(p_lead_id,'Stage change','Stage changed to ' || new_stage,'Call outcome: ' || p_outcome,auth.uid());
  end if;
  if p_outcome in ('RNR','Call Back Later') then
    callback_time := coalesce(p_callback_at,now() + interval '30 minutes');
    insert into public.follow_up_tasks(lead_id,task_type,due_at,priority,assigned_to,notes,created_by)
      values(p_lead_id,'RNR callback',callback_time,lead_row.priority,coalesce(lead_row.assigned_to,auth.uid()),'Callback after ' || p_outcome || ' call.',auth.uid())
      on conflict (lead_id) where status = 'Due' and task_type = 'RNR callback'
      do update set due_at = excluded.due_at, updated_at = now(), notes = excluded.notes;
    update public.leads set next_follow_up_at = callback_time where id = p_lead_id;
  end if;
  return call_row;
end $$;
grant execute on function public.log_call(uuid,text,text,integer,timestamptz) to authenticated;
