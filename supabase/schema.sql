-- ARISE: таблица игроков. Доступ только через функцию arise (service role), напрямую из браузера — нельзя.
create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  token_hash text unique not null,
  name text not null,
  level int not null default 1,
  rank text not null default 'E',
  xp int not null default 0,
  streak int not null default 0,
  best_streak int not null default 0,
  perfect_days int not null default 0,
  workouts int not null default 0,
  title text,
  today_quests int not null default 0,
  today_total int not null default 4,
  stats_date date,
  save jsonb,
  photo_day date,
  photo_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists players_name_lower on public.players (lower(name));
create index if not exists players_xp on public.players (xp desc);
alter table public.players enable row level security;

-- этап 1: лимит текстовых расчётов КБЖУ
alter table public.players add column if not exists text_day date;
alter table public.players add column if not exists text_count int not null default 0;

-- этап 2: лимит запросов к наставнику навыков
alter table public.players add column if not exists skill_day date;
alter table public.players add column if not exists skill_count int not null default 0;
