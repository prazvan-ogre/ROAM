-- ROAM initial schema: content tables (admin-managed, publicly readable).
-- No authentication in the MVP: writes to these tables happen only via the
-- Supabase service-role key (Studio, seed scripts, migrations), never via
-- the anon key used by the app. See docs/DATABASE.md for the full model.

create extension if not exists "pgcrypto";

create table trips (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  language text not null default 'ro',
  start_date date,
  duration_days int not null,
  is_active boolean not null default true,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table battles (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips (id) on delete cascade,
  day_number int,
  title text not null,
  is_final boolean not null default false,
  order_index int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index battles_trip_id_idx on battles (trip_id);

-- Shared by Discover questions and Battle questions: same shape (a prompt
-- plus options), so one table with a `kind` discriminator avoids
-- duplicating schema and UI logic across two near-identical tables.
create table questions (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips (id) on delete cascade,
  battle_id uuid references battles (id) on delete cascade,
  kind text not null check (kind in ('discover', 'battle')),
  day_number int,
  order_index int not null default 0,
  prompt text not null,
  question_type text not null default 'single_choice'
    check (question_type in ('single_choice', 'multi_choice', 'text')),
  media_url text,
  points int not null default 10,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint battle_questions_need_battle
    check (kind <> 'battle' or battle_id is not null)
);

create index questions_trip_id_idx on questions (trip_id);
create index questions_battle_id_idx on questions (battle_id);

create table answer_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references questions (id) on delete cascade,
  order_index int not null default 0,
  label text not null,
  is_correct boolean not null default false,
  created_at timestamptz not null default now()
);

create index answer_options_question_id_idx on answer_options (question_id);

create table extras (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips (id) on delete cascade,
  day_number int,
  title text not null,
  description text,
  media_url text,
  order_index int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index extras_trip_id_idx on extras (trip_id);

create table explore_links (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips (id) on delete cascade,
  extra_id uuid references extras (id) on delete set null,
  title text not null,
  url text not null,
  description text,
  order_index int not null default 0,
  created_at timestamptz not null default now()
);

create index explore_links_trip_id_idx on explore_links (trip_id);

-- Row Level Security: content is public-readable, never anon-writable.
alter table trips enable row level security;
alter table battles enable row level security;
alter table questions enable row level security;
alter table answer_options enable row level security;
alter table extras enable row level security;
alter table explore_links enable row level security;

create policy "trips are publicly readable" on trips
  for select using (true);
create policy "battles are publicly readable" on battles
  for select using (true);
create policy "questions are publicly readable" on questions
  for select using (true);
create policy "answer_options are publicly readable" on answer_options
  for select using (true);
create policy "extras are publicly readable" on extras
  for select using (true);
create policy "explore_links are publicly readable" on explore_links
  for select using (true);

-- Deliberately no insert/update/delete policies for anon/authenticated:
-- content changes go through the service-role key only.
