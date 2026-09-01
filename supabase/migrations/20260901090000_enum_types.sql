-- Converts the "enum-like" text + check-constraint columns into real
-- Postgres enum types. Purely a type-system change -- every existing
-- value already satisfies its check constraint (that's what enforced it
-- until now), so this only re-encodes storage, it never changes or
-- loses data.
--
-- Why: `supabase gen types` reads the actual Postgres column type. A
-- `text` column with a `check (col in (...))` constraint has no way for
-- the generator to know the allowed values, so it comes out typed as
-- plain `string` -- which is exactly why src/lib/supabase/types.ts has
-- stayed hand-written instead of generated (see its own header comment).
-- A real Postgres enum, by contrast, generates as the exact literal
-- union (e.g. "morning" | "lunch"), matching the hand-written
-- QuestionSlot/BattleTeam/etc. types in that file exactly. This
-- migration is what makes `supabase gen types typescript --linked`
-- finally safe to run as the source of truth for that file, without
-- silently widening those columns to `string` and breaking every
-- Record<QuestionSlot, ...>-shaped usage across the app.
--
-- Three things had to be dropped and recreated around each ALTER COLUMN
-- TYPE, verified against a scratch Postgres with all prior migrations
-- applied:
--   1. The check constraint itself (redundant once the column has an
--      enum type -- the type enforces the same values).
--   2. Two cross-column checks on `questions` that compare `kind` to a
--      string literal with <>/= (battle_questions_need_battle,
--      discover_needs_slot) -- Postgres can't reuse a constraint
--      expression typed against the old `text` column once it's an
--      enum, even though a plain `col = 'literal'` continues to work
--      fine elsewhere (RLS policies, battle_team_score()/
--      trip_battle_win_tally(), seed.sql's bare literals) since an
--      unknown-type string literal still coerces to whatever type
--      context needs.
--   3. One partial unique index (participants_one_adult_per_device)
--      whose WHERE clause references `role = 'adult'`, same reasoning.
--
-- supabase/seed.sql needed one further fix alongside this migration:
-- every `extras.extra_type` value there is selected from a `values
-- (...) as e(...)` derived table, which fixes its column type as `text`
-- (not an unknown literal) -- unlike every other enum-ish column in
-- that file, which is always a bare literal in the SELECT list. Text
-- has no automatic cast to a user-defined enum, so those 21 references
-- now read `e.extra_type::extra_type_enum` explicitly.

create type question_kind as enum ('discover', 'battle');
create type question_type_enum as enum ('single_choice', 'multi_choice', 'text');
create type question_slot as enum ('morning', 'lunch');
create type participant_role as enum ('adult', 'child');
create type assignment_status as enum ('assigned', 'viewed', 'completed');
create type battle_team as enum ('adults', 'kids');
create type extra_type_enum as enum ('know', 'think', 'connect', 'ask', 'explore');
create type extra_audience as enum ('all', 'adult', 'child');
create type feedback_anticipated_next as enum ('da', 'uneori', 'nu');
create type feedback_would_use_again as enum ('sigur', 'probabil', 'probabil_nu', 'nu');
create type trip_content_status as enum ('pending', 'generating', 'ready', 'failed');

alter table questions drop constraint questions_kind_check;
alter table questions drop constraint questions_question_type_check;
alter table questions drop constraint questions_slot_check;
alter table questions drop constraint battle_questions_need_battle;
alter table questions drop constraint discover_needs_slot;
alter table questions alter column question_type drop default;

alter table questions
  alter column kind type question_kind using kind::question_kind,
  alter column question_type type question_type_enum using question_type::question_type_enum,
  alter column slot type question_slot using slot::question_slot;

alter table questions alter column question_type set default 'single_choice'::question_type_enum;
alter table questions add constraint battle_questions_need_battle
  check (kind <> 'battle'::question_kind or battle_id is not null);
alter table questions add constraint discover_needs_slot
  check (kind <> 'discover'::question_kind or slot is not null) not valid;

drop index participants_one_adult_per_device;
alter table participants drop constraint participants_role_check;
alter table participants
  alter column role type participant_role using role::participant_role;
create unique index participants_one_adult_per_device
  on participants (trip_id, device_id) where (role = 'adult'::participant_role);

alter table extra_assignments drop constraint extra_assignments_status_check;
alter table extra_assignments alter column status drop default;
alter table extra_assignments
  alter column status type assignment_status using status::assignment_status;
alter table extra_assignments alter column status set default 'assigned'::assignment_status;

alter table battle_scores drop constraint battle_scores_team_check;
alter table battle_scores
  alter column team type battle_team using team::battle_team;

alter table extras drop constraint extras_extra_type_check;
alter table extras drop constraint extras_audience_check;
alter table extras alter column audience drop default;
alter table extras
  alter column extra_type type extra_type_enum using extra_type::extra_type_enum,
  alter column audience type extra_audience using audience::extra_audience;
alter table extras alter column audience set default 'all'::extra_audience;

alter table feedback drop constraint feedback_anticipated_next_check;
alter table feedback drop constraint feedback_would_use_again_check;
alter table feedback
  alter column anticipated_next type feedback_anticipated_next using anticipated_next::feedback_anticipated_next,
  alter column would_use_again type feedback_would_use_again using would_use_again::feedback_would_use_again;

alter table trips drop constraint trips_content_status_check;
alter table trips alter column content_status drop default;
alter table trips
  alter column content_status type trip_content_status using content_status::trip_content_status;
alter table trips alter column content_status set default 'ready'::trip_content_status;
