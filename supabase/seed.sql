-- Kassandra 2026 pilot trip seed data (ro, 5 days).
-- Day 1 (Morning + Lunch Discover, plus a Day-1 Battle question) is
-- written as real draft content in the ROAM voice (spec section 36.1),
-- not throwaway placeholder text. It is intentionally left
-- verified = false, published = false everywhere: per spec section 13
-- ("Content Integrity"), only a human fact-check + approval pass may flip
-- those flags -- an AI assistant seeding a migration is not that pass.
-- Explore links use search-query URLs rather than guessed article URLs,
-- to avoid seeding a dead/wrong link; swap in curated sources on review.
--
-- To publish Day 1 after review:
--   update questions set verified = true, published = true
--     where trip_id = (select id from trips where slug = 'kassandra-2026') and day_number = 1;
--   update extras set verified = true, published = true
--     where trip_id = (select id from trips where slug = 'kassandra-2026') and day_number = 1;
--
-- Safe to re-run: deletes any existing "kassandra-2026" trip (cascades to
-- its children) and reinserts. Do not run against production once real
-- pilot activity (participants/responses) exists for this trip.

delete from trips where slug = 'kassandra-2026';

with new_trip as (
  insert into trips (slug, name, language, start_date, duration_days, destination, location_info, is_active, is_demo)
  values (
    'kassandra-2026', 'Kassandra 2026', 'ro', '2026-09-01', 5,
    'Kassandra, Halkidiki, Grecia',
    'O peninsulă din nordul Greciei, cunoscută pentru plaje, măsline și istorie antică — pe aici au trecut fenicieni, greci și romani cu mii de ani în urmă.',
    true, false
  )
  returning id
),

-- ---------------------------------------------------------------------
-- Day 1 Morning Discover
-- ---------------------------------------------------------------------
morning_q as (
  insert into questions (
    trip_id, kind, day_number, slot, order_index, prompt, question_type, points,
    common_core, one_thing, correct_reveal_message, alternative_reveal_message
  )
  select
    id, 'discover', 1, 'morning', 1,
    'Suntem în Grecia acum 2.500 de ani. Nu există autostrăzi, mașini autonome sau easybox. Ai 500 kg de măsline de trimis la câteva sute de kilometri distanță. Cum le trimiți?',
    'single_choice', 10,
    'Grecia antică era acoperită de munți greu de traversat, dar înconjurată de o mare calmă și plină de insule. O corabie putea transporta mult mai multă marfă, mult mai repede, decât un car tras de animale pe drumuri de piatră. De-asta grecii au devenit navigatori și comercianți excelenți, iar orașele lor s-au răspândit pe coaste, nu în interiorul uscatului.',
    '🌊 Pentru grecii antici, marea nu era o graniță. Era un drum.',
    '🎯 Ai nimerit-o. Marea era autostrada antichității — mai rapidă și mai ieftină decât orice drum de munte.',
    '🌊 Plot twist... răspunsul e marea. Cu munți greu de trecut și coaste pline de porturi, o corabie bătea orice car cu catâri.'
  from new_trip
  returning id
),
morning_opts as (
  insert into answer_options (question_id, order_index, label, is_correct)
  select morning_q.id, o.order_index, o.label, o.is_correct
  from morning_q
  join (values
    (1, 'Cu o corabie, pe mare', true),
    (2, 'Pe un car tras de catâri, pe drumuri de munte', false),
    (3, 'Trimise pe rând, cu alergători', false),
    (4, 'Aștept ca cel care cumpără să vină la mine', false)
  ) as o(order_index, label, is_correct) on true
  returning id
),

-- ---------------------------------------------------------------------
-- Day 1 Lunch Discover
-- ---------------------------------------------------------------------
lunch_q as (
  insert into questions (
    trip_id, kind, day_number, slot, order_index, prompt, question_type, points,
    common_core, one_thing, correct_reveal_message, alternative_reveal_message
  )
  select
    id, 'discover', 1, 'lunch', 1,
    'Dacă Jocurile Olimpice ar fi avut live streaming acum 2.500 de ani, cine ar fi avut voie să participe și cine ar fi rămas spectator?',
    'single_choice', 10,
    'Jocurile Olimpice antice erau un festival religios dedicat lui Zeus, deschis doar bărbaților liberi, cetățeni ai unui oraș grecesc — femeile nu aveau voie nici măcar să asiste. Pe durata jocurilor se declara un armistițiu: cetățile grecești, chiar și cele aflate în război, opreau temporar luptele.',
    '🏛️ Grecia antică era mai degrabă o familie complicată de orașe decât o singură țară.',
    '🧠 Cineva a fost atent la orele de istorie. Doar bărbații liberi, cetățeni greci, aveau voie să concureze — sau chiar să privească.',
    '👀 Ai fost aproape. De fapt doar bărbații liberi, cetățeni ai unui oraș grecesc, aveau voie să participe — femeile nu aveau voie nici să privească.'
  from new_trip
  returning id
),
lunch_opts as (
  insert into answer_options (question_id, order_index, label, is_correct)
  select lunch_q.id, o.order_index, o.label, o.is_correct
  from lunch_q
  join (values
    (1, 'Doar bărbați liberi, cetățeni ai unui oraș grecesc', true),
    (2, 'Oricine din Grecia, femei incluse', false),
    (3, 'Doar reprezentanți aleși prin tragere la sorți din fiecare oraș', false),
    (4, 'Doar preoții și nobilii', false)
  ) as o(order_index, label, is_correct) on true
  returning id
),

-- ---------------------------------------------------------------------
-- Extras pool (multiple per question so different participants can get
-- a different one -- see docs/DATABASE.md / spec section 11).
-- ---------------------------------------------------------------------
morning_extras as (
  insert into extras (trip_id, question_id, day_number, title, description, order_index, extra_type, audience)
  select nt.id, morning_q.id, 1, e.title, e.description, e.order_index, e.extra_type, e.audience
  from new_trip nt, morning_q
  join (values
    (1, 'Fără busolă', 'Grecii antici navigau după stele și vânturi, fără busolă. Fenicienii, vecinii lor comercianți, au inventat unul dintre primele alfabete — tot ca să țină evidența mărfurilor transportate pe mare.', 'connect', 'all'),
    (2, 'Întreabă-i pe ceilalți', 'Dacă azi am pierde pentru o zi toate hărțile digitale, cum am găsi drumul spre următoarea destinație?', 'ask', 'adult'),
    (3, 'Corabia ta', 'Dacă ai avea o corabie doar a ta, ce ai încărca în ea ca să faci schimb cu alți copii dintr-o altă țară?', 'think', 'child')
  ) as e(order_index, title, description, extra_type, audience) on true
  returning id, order_index
),
lunch_extras as (
  insert into extras (trip_id, question_id, day_number, title, description, order_index, extra_type, audience)
  select nt.id, lunch_q.id, 1, e.title, e.description, e.order_index, e.extra_type, e.audience
  from new_trip nt, lunch_q
  join (values
    (1, 'Gol la Olimpiada', 'Cuvântul „gimnastică” vine din grecescul „gymnos”, adică „gol” — sportivii antici concurau fără haine.', 'know', 'all'),
    (2, 'Armistițiu olimpic', 'La Jocurile Olimpice antice se declara Ekecheiria: orice război între cetățile grecești se oprea temporar cât dura competiția.', 'connect', 'adult'),
    (3, 'Regulile tale', 'Dacă ai organiza azi o competiție doar pentru prietenii tăi, ce reguli ai pune ca să fie corectă pentru toată lumea?', 'ask', 'child')
  ) as e(order_index, title, description, extra_type, audience) on true
  returning id, order_index
),

-- ---------------------------------------------------------------------
-- Explore links (search-query URLs -- swap for curated sources on review)
-- ---------------------------------------------------------------------
morning_explore as (
  insert into explore_links (trip_id, question_id, title, url, description, order_index)
  select nt.id, morning_q.id,
    'Cum navigau grecii antici pe mare',
    'https://www.google.com/search?q=navigatia+in+grecia+antica',
    null, 1
  from new_trip nt, morning_q
),
lunch_explore as (
  insert into explore_links (trip_id, question_id, title, url, description, order_index)
  select nt.id, lunch_q.id,
    'Regulile Jocurilor Olimpice antice',
    'https://www.google.com/search?q=regulile+jocurilor+olimpice+antice',
    null, 1
  from new_trip nt, lunch_q
),

-- ---------------------------------------------------------------------
-- Day 1 evening Battle (content ready ahead of the Battle UI build)
-- ---------------------------------------------------------------------
day1_battle as (
  insert into battles (trip_id, day_number, title, is_final, order_index)
  select id, 1, 'Battle — Ziua 1', false, 1
  from new_trip
  returning id, trip_id
),
day1_battle_q as (
  insert into questions (
    trip_id, battle_id, kind, day_number, order_index, prompt, question_type, points,
    correct_reveal_message, alternative_reveal_message
  )
  select
    b.trip_id, b.id, 'battle', 1, 1,
    'Câte zile ținea, în medie, o călătorie cu corabia de la Atena până în Egipt, în Grecia antică?',
    'single_choice', 20,
    '🎯 Ai nimerit-o. Cu vânt bun, drumul dura aproximativ o săptămână.',
    '👀 Ai fost aproape. Cu vânt bun, drumul dura aproximativ o săptămână — nu zile, nu luni.'
  from day1_battle b
  returning id
)
insert into answer_options (question_id, order_index, label, is_correct)
select day1_battle_q.id, o.order_index, o.label, o.is_correct
from day1_battle_q
join (values
  (1, '1-2 zile', false),
  (2, 'Aproximativ o săptămână', true),
  (3, 'O lună', false),
  (4, 'Trei luni', false)
) as o(order_index, label, is_correct) on true;
