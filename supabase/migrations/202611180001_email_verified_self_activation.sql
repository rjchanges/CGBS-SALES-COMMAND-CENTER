-- Remove manual approval from self-registration without granting elevated roles.
-- Email verification remains the activation boundary. Existing administrator and
-- manager profiles are deliberately excluded from the backfill and auth triggers.

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
    new.email_confirmed_at is not null,
    new.email_confirmed_at is null
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function public.activate_verified_salesperson()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    update public.profiles
       set active = true,
           pending_approval = false
     where id = new.id
       and role = 'salesperson'
       and active = false
       and pending_approval = true;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_verified on auth.users;
create trigger on_auth_user_email_verified
  after update of email_confirmed_at on auth.users
  for each row execute function public.activate_verified_salesperson();

-- Activate already-verified self-registered salesperson accounts that were left
-- waiting for approval. Unverified accounts and all other roles are untouched.
update public.profiles p
   set active = true,
       pending_approval = false
  from auth.users u
 where u.id = p.id
   and u.email_confirmed_at is not null
   and p.role = 'salesperson'
   and p.active = false
   and p.pending_approval = true;
