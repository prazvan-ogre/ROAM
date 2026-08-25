-- Demo/development seed data: Kassandra 2026 pilot trip.
-- Marked is_demo = true so it's identifiable and easy to exclude/replace
-- before the real pilot content is loaded. Safe to re-run: it deletes any
-- existing "kassandra-2026" trip (cascades to its children) and reinserts.
--
-- Run with: supabase db reset (local) or psql < supabase/seed.sql
-- Do NOT run against production unless you intend to (re)load demo content.

delete from trips where slug = 'kassandra-2026';

with new_trip as (
  insert into trips (slug, name, language, start_date, duration_days, is_active, is_demo)
  values ('kassandra-2026', 'Kassandra 2026', 'ro', '2026-09-01', 5, true, true)
  returning id
),
new_extras as (
  insert into extras (trip_id, day_number, title, description, order_index, is_active)
  select id, d.day, d.title, d.description, d.day, true
  from new_trip, (values
    (1, 'Bine ai venit!', '[demo] Extra de start de zi 1 - inlocuieste cu continut real.'),
    (2, 'Explorare locala', '[demo] Extra de start de zi 2 - inlocuieste cu continut real.'),
    (3, 'Aventura zilei', '[demo] Extra de start de zi 3 - inlocuieste cu continut real.'),
    (4, 'Descopera plaja', '[demo] Extra de start de zi 4 - inlocuieste cu continut real.'),
    (5, 'Ultima zi', '[demo] Extra de start de zi 5 - inlocuieste cu continut real.')
  ) as d(day, title, description)
  returning id, trip_id, day_number
),
new_discover_questions as (
  insert into questions (trip_id, kind, day_number, order_index, prompt, question_type, points, is_active)
  select id, 'discover', d.day, 1, d.prompt, 'single_choice', 10, true
  from new_trip, (values
    (1, '[demo] Ce culoare are steagul Greciei?'),
    (2, '[demo] Cum se spune "multumesc" in greaca?'),
    (3, '[demo] Care e capitala Greciei?')
  ) as d(day, prompt)
  returning id, day_number
),
new_options as (
  insert into answer_options (question_id, order_index, label, is_correct)
  select q.id, o.order_index, o.label, o.is_correct
  from new_discover_questions q
  join (values
    (1, 1, 'Albastru si alb', true),
    (1, 2, 'Rosu si galben', false),
    (2, 1, 'Efharisto', true),
    (2, 2, 'Kalimera', false),
    (3, 1, 'Atena', true),
    (3, 2, 'Salonic', false)
  ) as o(day, order_index, label, is_correct) on o.day = q.day_number
  returning id
),
new_battle as (
  insert into battles (trip_id, day_number, title, is_final, order_index, is_active)
  select id, 5, '[demo] Parinti vs Copii - Marea Finala', true, 1, true
  from new_trip
  returning id, trip_id
),
new_battle_questions as (
  insert into questions (trip_id, battle_id, kind, day_number, order_index, prompt, question_type, points, is_active)
  select b.trip_id, b.id, 'battle', 5, o.order_index, o.prompt, 'single_choice', 20, true
  from new_battle b
  join (values
    (1, '[demo] Intrebare finala 1: Cate zile a durat excursia?'),
    (2, '[demo] Intrebare finala 2: Cine a castigat cele mai multe Extras?')
  ) as o(order_index, prompt) on true
  returning id, order_index
)
insert into answer_options (question_id, order_index, label, is_correct)
select bq.id, o.order_index, o.label, o.is_correct
from new_battle_questions bq
join (values
  (1, 1, '5 zile', true),
  (1, 2, '7 zile', false),
  (2, 1, 'Copiii', true),
  (2, 2, 'Parintii', false)
) as o(question_order, order_index, label, is_correct) on o.question_order = bq.order_index;

insert into explore_links (trip_id, title, url, description, order_index)
select id, '[demo] Harta Kassandra', 'https://maps.google.com', 'Inlocuieste cu link real.', 1
from trips where slug = 'kassandra-2026';
