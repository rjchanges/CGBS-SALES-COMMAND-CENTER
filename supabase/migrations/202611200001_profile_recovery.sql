-- Ensure Auth users have a usable CRM profile. Existing profiles are never
-- overwritten, so existing Admin/Manager roles and disabled states are kept.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role, active)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Sales Executive'
    ),
    'salesperson'::public.user_role,
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill Auth identities that have no profile. ON CONFLICT preserves all
-- existing profile values, including elevated roles and disabled accounts.
insert into public.profiles (id, full_name, role, active)
select
  u.id,
  coalesce(
    nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
    nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
    'Sales Executive'
  ),
  'salesperson'::public.user_role,
  true
from auth.users as u
on conflict (id) do nothing;

alter table public.profiles enable row level security;
drop policy if exists profiles_read_self on public.profiles;
create policy profiles_read_self on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

-- An authenticated salesperson/manager cannot update their own role or any
-- other protected profile fields. Admin-only changes remain governed by the
-- existing profiles_admin_all / profiles_admin_manage policies.
drop policy if exists profiles_update_admin_guard on public.profiles;
create policy profiles_update_admin_guard on public.profiles
  as restrictive for update to authenticated
  using (public.current_role() = 'admin'::public.user_role)
  with check (public.current_role() = 'admin'::public.user_role);

-- Recovery is only callable by an authenticated session and always derives
-- the profile id from auth.uid(); callers cannot pass another user's id or role.
create or replace function public.ensure_own_profile()
returns table (id uuid, full_name text, role public.user_role, active boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  auth_user auth.users%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into auth_user
    from auth.users
   where auth.users.id = auth.uid();

  if not found then
    raise exception 'Authenticated user not found' using errcode = '42501';
  end if;

  insert into public.profiles (id, full_name, role, active)
  values (
    auth_user.id,
    coalesce(
      nullif(trim(auth_user.raw_user_meta_data->>'full_name'), ''),
      nullif(split_part(coalesce(auth_user.email, ''), '@', 1), ''),
      'Sales Executive'
    ),
    'salesperson'::public.user_role,
    true
  )
  on conflict (id) do nothing;

  return query
    select p.id, p.full_name, p.role, p.active
      from public.profiles as p
     where p.id = auth_user.id;
end;
$$;

revoke all on function public.ensure_own_profile() from public, anon;
grant execute on function public.ensure_own_profile() to authenticated;
