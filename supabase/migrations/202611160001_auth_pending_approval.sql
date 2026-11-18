-- Auth: pending approval flow and last login tracking
-- Safe to re-run.

alter table public.profiles
  add column if not exists pending_approval boolean not null default false,
  add column if not exists last_login_at timestamptz;

-- Profile auto-creation on signup: new users are inactive pending admin approval
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, role, active, pending_approval)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      split_part(new.email, '@', 1)
    ),
    'salesperson',
    false,
    true
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Allow users to always read their own profile (even when inactive/pending)
drop policy if exists profiles_read_self on public.profiles;
create policy profiles_read_self on public.profiles for select to authenticated
  using (id = auth.uid());

-- Admins can update pending_approval and active status
drop policy if exists profiles_admin_manage on public.profiles;
create policy profiles_admin_manage on public.profiles for update to authenticated
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');
