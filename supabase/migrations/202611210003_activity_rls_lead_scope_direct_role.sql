-- Replace the lead access helper with a direct active-profile role check.
-- This avoids chaining SECURITY DEFINER team-management helpers while retaining
-- the scoped boolean API and existing lead/creator restrictions.
create or replace function public.can_access_lead(p_lead_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.leads as l
    left join public.profiles as p
      on p.id = auth.uid()
     and p.active = true
    where l.id = p_lead_id
      and (
        p.role in ('admin','manager')
        or l.assigned_to = auth.uid()
        or l.is_shared = true
      )
  );
$$;

revoke all on function public.can_access_lead(uuid) from public;
grant execute on function public.can_access_lead(uuid) to authenticated;

drop policy if exists leads_read_assigned_or_shared on public.leads;
create policy leads_read_assigned_or_shared on public.leads for select to authenticated
  using (public.can_access_lead(id));

drop policy if exists activities_insert on public.activities;
create policy activities_insert on public.activities for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.can_access_lead(lead_id)
  );
