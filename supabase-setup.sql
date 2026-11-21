-- MetalFlix : synchro des comptes (à coller une fois dans Supabase → SQL Editor → Run)
create table if not exists public.libraries (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.libraries enable row level security;

drop policy if exists "lire sa ligne" on public.libraries;
drop policy if exists "creer sa ligne" on public.libraries;
drop policy if exists "modifier sa ligne" on public.libraries;

create policy "lire sa ligne" on public.libraries
  for select using (auth.uid() = user_id);
create policy "creer sa ligne" on public.libraries
  for insert with check (auth.uid() = user_id);
create policy "modifier sa ligne" on public.libraries
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
