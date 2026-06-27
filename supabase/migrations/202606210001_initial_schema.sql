-- CriaBot: estrutura inicial para Supabase/Postgres.

create extension if not exists "pgcrypto";
create type public.bot_status as enum ('draft', 'active', 'paused', 'archived');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.bots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  handle text not null check (handle ~ '^@[a-zA-Z0-9_]{3,32}$'),
  description text not null default '',
  personality text not null default '',
  tone text not null default 'Casual',
  platform text not null default 'Telegram',
  status public.bot_status not null default 'draft',
  watermark_enabled boolean not null default true,
  configuration jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, handle)
);

create table public.bot_metrics_daily (
  bot_id uuid not null references public.bots(id) on delete cascade,
  metric_date date not null default current_date,
  messages_count integer not null default 0 check (messages_count >= 0),
  audience_count integer not null default 0 check (audience_count >= 0),
  blocked_requests_count integer not null default 0 check (blocked_requests_count >= 0),
  primary key (bot_id, metric_date)
);

create table public.bot_integrations (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references public.bots(id) on delete cascade,
  provider text not null check (provider in ('telegram', 'whatsapp', 'webchat')),
  status text not null default 'pending'
    check (status in ('pending', 'connected', 'error', 'disabled')),
  external_id text,
  external_name text,
  external_username text,
  credentials_reference text,
  webhook_url text,
  webhook_registered_at timestamptz,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(bot_id, provider)
);

create table public.bot_integration_secrets (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.bot_integrations(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null check (provider = 'telegram'),
  secret_token text not null,
  secret_hint text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(integration_id)
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  bot_id uuid references public.bots(id) on delete set null,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.bots enable row level security;
alter table public.bot_metrics_daily enable row level security;
alter table public.bot_integrations enable row level security;
alter table public.bot_integration_secrets enable row level security;
alter table public.audit_logs enable row level security;

create index bots_owner_id_idx on public.bots(owner_id);
create index bot_integrations_bot_id_idx on public.bot_integrations(bot_id);
create index bot_integration_secrets_owner_id_idx on public.bot_integration_secrets(owner_id);
create index audit_logs_owner_id_idx on public.audit_logs(owner_id);

create policy "users read own profile" on public.profiles
for select to authenticated
using ((select auth.uid()) = id);

create policy "users update own profile" on public.profiles
for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy "users read own bots" on public.bots
for select to authenticated
using ((select auth.uid()) = owner_id);

create policy "users create own bots" on public.bots
for insert to authenticated
with check ((select auth.uid()) = owner_id);

create policy "users update own bots" on public.bots
for update to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy "users delete own draft bots" on public.bots
for delete to authenticated
using ((select auth.uid()) = owner_id and status in ('draft', 'archived'));

create policy "users read metrics for own bots" on public.bot_metrics_daily
for select to authenticated
using (
  exists (
    select 1 from public.bots
    where bots.id = bot_metrics_daily.bot_id
      and bots.owner_id = (select auth.uid())
  )
);

create policy "users read integrations for own bots" on public.bot_integrations
for select to authenticated
using (
  exists (
    select 1 from public.bots
    where bots.id = bot_integrations.bot_id
      and bots.owner_id = (select auth.uid())
  )
);

create policy "users create integrations for own bots" on public.bot_integrations
for insert to authenticated
with check (
  exists (
    select 1 from public.bots
    where bots.id = bot_integrations.bot_id
      and bots.owner_id = (select auth.uid())
  )
);

create policy "users update integrations for own bots" on public.bot_integrations
for update to authenticated
using (
  exists (
    select 1 from public.bots
    where bots.id = bot_integrations.bot_id
      and bots.owner_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.bots
    where bots.id = bot_integrations.bot_id
      and bots.owner_id = (select auth.uid())
  )
);

create policy "users create own integration secrets" on public.bot_integration_secrets
for insert to authenticated
with check (
  (select auth.uid()) = owner_id
  and exists (
    select 1
    from public.bot_integrations
    join public.bots on bots.id = bot_integrations.bot_id
    where bot_integrations.id = bot_integration_secrets.integration_id
      and bots.owner_id = (select auth.uid())
  )
);

create policy "users update own integration secrets" on public.bot_integration_secrets
for update to authenticated
using ((select auth.uid()) = owner_id)
with check (
  (select auth.uid()) = owner_id
  and exists (
    select 1
    from public.bot_integrations
    join public.bots on bots.id = bot_integrations.bot_id
    where bot_integrations.id = bot_integration_secrets.integration_id
      and bots.owner_id = (select auth.uid())
  )
);

create policy "users read own audit logs" on public.audit_logs
for select to authenticated
using ((select auth.uid()) = owner_id);

revoke update on public.profiles from authenticated;
grant update(display_name, phone, updated_at) on public.profiles to authenticated;

revoke all on public.bot_integration_secrets from anon, authenticated;
grant insert, update on public.bot_integration_secrets to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (
    id,
    display_name,
    phone
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    nullif(new.raw_user_meta_data ->> 'phone', '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
