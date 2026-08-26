-- Product owner request: the wizard's prize step becomes a vote instead
-- of a static text. 3 prize options per trip; each participant picks
-- their favourite once (1 point). 12 hours after the *first* vote is
-- cast, the window closes and the option with the most votes becomes the
-- competition's prize -- computed on read (getPrizeStatus in
-- src/lib/prize.ts), not by a background job. trips.prize (added in
-- settings_and_scoring) is superseded by this and no longer read by the
-- app, but left in place rather than dropped.

create table prize_options (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips (id) on delete cascade,
  title text not null,
  description text,
  order_index int not null default 0,
  created_at timestamptz not null default now()
);

create index prize_options_trip_id_idx on prize_options (trip_id);

create table prize_votes (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips (id) on delete cascade,
  prize_option_id uuid not null references prize_options (id) on delete cascade,
  participant_id uuid not null references participants (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (participant_id)
);

create index prize_votes_trip_id_idx on prize_votes (trip_id);

alter table prize_options enable row level security;
alter table prize_votes enable row level security;

-- Same accepted-risk model as the rest of the activity tables
-- (docs/DATABASE.md "Security model"): no auth, so no server-verifiable
-- "this vote is mine" -- low-stakes for a private pilot.
create policy "prize_options are publicly readable" on prize_options
  for select using (true);
create policy "prize_votes are publicly readable" on prize_votes
  for select using (true);
create policy "anyone can cast a prize vote" on prize_votes
  for insert with check (true);
