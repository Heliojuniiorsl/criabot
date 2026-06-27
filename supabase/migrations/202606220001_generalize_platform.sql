-- Atualiza um banco CriaBot criado com o schema adulto antigo.
-- Também recupera usuários do Auth que ficaram sem perfil.

alter table public.profiles
  add column if not exists phone text;

update public.profiles as profile
set phone = nullif(auth_user.raw_user_meta_data ->> 'phone', '')
from auth.users as auth_user
where auth_user.id = profile.id
  and profile.phone is null;

insert into public.profiles (id, display_name, phone)
select
  auth_user.id,
  coalesce(
    nullif(auth_user.raw_user_meta_data ->> 'display_name', ''),
    split_part(auth_user.email, '@', 1)
  ),
  nullif(auth_user.raw_user_meta_data ->> 'phone', '')
from auth.users as auth_user
left join public.profiles as profile on profile.id = auth_user.id
where profile.id is null;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, phone)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'display_name', ''),
      split_part(new.email, '@', 1)
    ),
    nullif(new.raw_user_meta_data ->> 'phone', '')
  )
  on conflict (id) do update
  set
    display_name = excluded.display_name,
    phone = coalesce(excluded.phone, public.profiles.phone),
    updated_at = now();

  return new;
end;
$$;

drop policy if exists "adult verified users create bots" on public.bots;
drop policy if exists "users create own bots" on public.bots;
create policy "users create own bots" on public.bots
for insert to authenticated
with check ((select auth.uid()) = owner_id);

drop policy if exists "users update own bots" on public.bots;
create policy "users update own bots" on public.bots
for update to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

revoke update on public.profiles from authenticated;
grant update(display_name, phone, updated_at) on public.profiles to authenticated;

alter table public.profiles
  drop column if exists birth_date,
  drop column if exists adult_verified_at;

alter table public.bots
  drop column if exists age_gate_enabled,
  drop column if exists consent_guard_enabled;

notify pgrst, 'reload schema';
