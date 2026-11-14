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

-- этап 3: история по дням (для сезонов и дуэлей), лента, дуэли, Врата
create table if not exists public.player_days (
  player_id uuid not null references public.players(id) on delete cascade,
  day date not null,
  xp int not null default 0,
  norm boolean not null default false,
  workout boolean not null default false,
  quests int not null default 0,
  primary key (player_id, day)
);
alter table public.player_days enable row level security;

create table if not exists public.events (
  id bigserial primary key,
  player_id uuid not null references public.players(id) on delete cascade,
  kind text not null,
  text text not null,
  created_at timestamptz not null default now()
);
create index if not exists events_time on public.events (created_at desc);
alter table public.events enable row level security;

create table if not exists public.duels (
  id uuid primary key default gen_random_uuid(),
  a uuid not null references public.players(id) on delete cascade,
  b uuid not null references public.players(id) on delete cascade,
  metric text not null,
  stake int not null default 100,
  start_day date,
  end_day date,
  status text not null default 'pending',
  winner uuid,
  created_at timestamptz not null default now()
);
alter table public.duels enable row level security;

create table if not exists public.gate_runs (
  gate_key text not null,
  player_id uuid not null references public.players(id) on delete cascade,
  status text not null default 'active',
  progress int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (gate_key, player_id)
);
alter table public.gate_runs enable row level security;

create or replace function public.season_board(p_from date, p_to date)
returns table (player_id uuid, xp bigint)
language sql stable as $$
  select player_id, sum(xp)::bigint from public.player_days where day between p_from and p_to group by player_id
$$;

-- этап 4: уведомления
create table if not exists public.app_config (key text primary key, value text not null);
alter table public.app_config enable row level security;
insert into public.app_config (key, value) values ('cron_secret', gen_random_uuid()::text) on conflict (key) do nothing;

create table if not exists public.push_subs (
  endpoint text primary key,
  player_id uuid not null references public.players(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subs enable row level security;

alter table public.players add column if not exists skill_state text not null default 'none';
alter table public.players add column if not exists skill_date date;

-- этап 4b: живые дуэли (60 секунд, камера)
create table if not exists public.live_duels (
  id uuid primary key default gen_random_uuid(),
  a uuid not null references public.players(id) on delete cascade,
  b uuid not null references public.players(id) on delete cascade,
  exercise text not null,
  seconds int not null default 60,
  stake int not null default 50,
  status text not null default 'pending',
  start_at timestamptz,
  a_reps int not null default 0,
  b_reps int not null default 0,
  winner uuid,
  created_at timestamptz not null default now()
);
alter table public.live_duels enable row level security;
