-- CriaBot: onboarding inicial por Telegram/BotFather.

alter table public.bot_integrations
  add column if not exists external_id text,
  add column if not exists external_name text,
  add column if not exists webhook_url text,
  add column if not exists webhook_registered_at timestamptz,
  add column if not exists error_message text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists public.bot_integration_secrets (
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

alter table public.bot_integration_secrets enable row level security;

create index if not exists bot_integration_secrets_owner_id_idx
  on public.bot_integration_secrets(owner_id);

drop policy if exists "users create own integration secrets" on public.bot_integration_secrets;
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

drop policy if exists "users update own integration secrets" on public.bot_integration_secrets;
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

revoke all on public.bot_integration_secrets from anon, authenticated;
grant insert, update on public.bot_integration_secrets to authenticated;

notify pgrst, 'reload schema';
