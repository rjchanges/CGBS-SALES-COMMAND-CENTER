-- Activity inserts must honor lead access without relying on a nested SELECT
-- that is itself filtered by the leads table's RLS policies.
-- This function exposes only a scoped boolean; it does not return lead data.
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
    where l.id = p_lead_id
      and (
        public.can_manage_team()
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
