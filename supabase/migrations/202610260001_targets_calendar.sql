-- Persistent custom sales targets and linked calendar events.
create table if not exists public.sales_targets (
  id uuid primary key default gen_random_uuid(),
  metric text not null check (metric in ('calls','new_leads','followups_completed','meetings_scheduled','meetings_completed','qualified_leads','proposals_sent','revenue','deals_closed')),
  target_value numeric(18,2) not null check (target_value >= 0),
  period text not null check (period in ('daily','weekly','monthly','quarterly','custom')),
  starts_on date not null,
  ends_on date not null,
  owner_scope text not null check (owner_scope in ('self','team','employee')),
  owner_user_id uuid references public.profiles(id) on delete cascade,
  owner_label text not null,
  enabled boolean not null default true,
  revision_history jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  check ((owner_scope = 'team' and owner_user_id is null) or (owner_scope <> 'team' and owner_user_id is not null))
);
create index if not exists sales_targets_enabled_range_idx on public.sales_targets (enabled, starts_on, ends_on);
create index if not exists sales_targets_owner_metric_idx on public.sales_targets (owner_user_id, metric, enabled);
alter table public.sales_targets enable row level security;
create policy sales_targets_read on public.sales_targets for select to authenticated
  using (public.can_manage_team() or owner_scope = 'team' or owner_user_id = auth.uid());
create policy sales_targets_insert on public.sales_targets for insert to authenticated
  with check (created_by = auth.uid() and (public.can_manage_team() or (owner_scope = 'self' and owner_user_id = auth.uid())));
create policy sales_targets_update on public.sales_targets for update to authenticated
  using (public.can_manage_team() or (owner_scope = 'self' and owner_user_id = auth.uid()))
  with check (public.can_manage_team() or (owner_scope = 'self' and owner_user_id = auth.uid()));

create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  description text not null default '',
  event_type text not null check (event_type in ('Call','Follow-up','Meeting','Proposal','Opportunity','Other')),
  status text not null default 'Scheduled' check (status in ('Scheduled','Completed','Cancelled')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  lead_id uuid references public.leads(id) on delete set null,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  assigned_to uuid not null references public.profiles(id) on delete cascade,
  priority text not null default 'Medium' check (priority in ('Low','Medium','High','Critical')),
  location text not null default '',
  meeting_link text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists calendar_events_range_idx on public.calendar_events (starts_at, ends_at);
create index if not exists calendar_events_assignee_range_idx on public.calendar_events (assigned_to, starts_at);
alter table public.calendar_events enable row level security;
create policy calendar_events_read on public.calendar_events for select to authenticated
  using (public.can_manage_team() or assigned_to = auth.uid() or created_by = auth.uid());
create policy calendar_events_insert on public.calendar_events for insert to authenticated
  with check (created_by = auth.uid() and (public.can_manage_team() or assigned_to = auth.uid()));
create policy calendar_events_update on public.calendar_events for update to authenticated
  using (public.can_manage_team() or (assigned_to = auth.uid() and created_by = auth.uid()))
  with check (public.can_manage_team() or (assigned_to = auth.uid() and created_by = auth.uid()));
create policy calendar_events_delete on public.calendar_events for delete to authenticated
  using (public.can_manage_team() or created_by = auth.uid());

do $$ begin
  drop trigger if exists set_updated_at on public.sales_targets;
  create trigger set_updated_at before update on public.sales_targets for each row execute function public.set_updated_at();
  drop trigger if exists set_updated_at on public.calendar_events;
  create trigger set_updated_at before update on public.calendar_events for each row execute function public.set_updated_at();
end $$;