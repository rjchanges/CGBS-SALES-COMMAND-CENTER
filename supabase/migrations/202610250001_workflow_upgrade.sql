-- Add workflow fields while keeping this schema migration safe to re-run.
alter table public.companies
  add column if not exists net_worth numeric(18,2) not null default 0 check (net_worth >= 0);

alter table public.leads
  add column if not exists change_history jsonb not null default '[]'::jsonb;

alter table public.opportunities
  add column if not exists actual_close_at timestamptz,
  add column if not exists accomplished_by uuid references public.profiles(id) on delete set null;

update public.opportunities set actual_close_at = updated_at, accomplished_by = assigned_to where stage = 'Closed Won' and actual_close_at is null;

create index if not exists opportunities_actual_close_idx
  on public.opportunities (actual_close_at desc) where stage = 'Closed Won';
create index if not exists opportunities_accomplished_by_idx
  on public.opportunities (accomplished_by, actual_close_at desc) where stage = 'Closed Won';

alter table public.follow_up_tasks
  add column if not exists completion_notes text not null default '',
  add column if not exists ends_at timestamptz;

alter table public.follow_up_tasks
  drop constraint if exists follow_up_tasks_task_type_check;
alter table public.follow_up_tasks
  add constraint follow_up_tasks_task_type_check
  check (task_type in ('Call','Email','Meeting','RNR callback','Call Back Later','Proposal Follow-up','Other'));

create index if not exists active_callbacks_per_lead_idx
  on public.follow_up_tasks (lead_id)
  where status = 'Due' and task_type in ('RNR callback','Call Back Later');

alter table public.daily_targets
  add column if not exists followups_target integer not null default 8 check (followups_target >= 0),
  add column if not exists meetings_target integer not null default 3 check (meetings_target >= 0);

create index if not exists followups_completed_time_idx
  on public.follow_up_tasks (completed_at desc) where status = 'Completed';
