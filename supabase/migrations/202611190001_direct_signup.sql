-- Enable immediate sign-in after public signup when Supabase Auth's Confirm email
-- setting is disabled. Keep email/password authentication and all existing RLS.
-- Every new profile is still created with the lowest-privilege salesperson role.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role, active, pending_approval)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1)),
    'salesperson',
    true,
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Direct signup no longer needs a separate email-confirmation activation trigger.
drop trigger if exists on_auth_user_email_verified on auth.users;
drop function if exists public.activate_verified_salesperson();

-- Allow existing self-registered accounts that were waiting for verification or
-- approval to sign in immediately. Do not activate disabled Admin/Manager users,
-- change any role, or delete existing records.
update public.profiles
   set active = true,
       pending_approval = false
 where role = 'salesperson'
   and active = false
   and pending_approval = true;
