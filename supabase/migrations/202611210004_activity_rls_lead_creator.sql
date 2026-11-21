-- Allow a lead creator to pass the lead-access helper for the creator's own lead.
-- This preserves isolation: a salesperson still cannot access another person's lead
-- unless that lead is assigned/shared and the role checks below pass.
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
        or l.created_by = auth.uid()
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
