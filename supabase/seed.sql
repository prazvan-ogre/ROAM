-- Kassandra 2026 pilot trip seed data (ro, 7 days).
-- Content supplied directly by the product owner (uploaded doc "Concurs
-- Kassandra - Parinti vs Copii"), not AI-drafted -- but per spec section
-- 13 ("Content Integrity") the verified/published flip is still a
-- deliberate human step, not something a seed script does on its own.
-- Everything below is left verified = false, published = false (column
-- defaults), and the trip itself starts content_status = 'pending'
-- (also the column default -- see 20260908090000_r7_content_publishing_
-- pipeline.sql). Review, then run:
--
--   update questions set verified = true, published = true
--     where trip_id = (select id from trips where slug = 'kassandra-2026');
--   update extras set verified = true, published = true
--     where trip_id = (select id from trips where slug = 'kassandra-2026');
--
-- Then, once every item above is actually reviewed (not just flipped
-- sight-unseen), run the R7 publish operation -- it re-validates the
-- whole trip (every required day's Morning/Lunch/Battle, the Final
-- Battle, cross-references, the prize vote) and only flips
-- content_status to 'ready' if nothing is missing; it reports exactly
-- what's still wrong otherwise, and changes nothing until it's clean:
--
--   select (publish_trip((select id from trips where slug = 'kassandra-2026'))).*;
--
-- (Or, from the app itself: Setări > Publicare, visible to an admin
-- account -- see docs/DATABASE.md's R7 section for the full operator
-- walkthrough and app/api/admin/trips/[slug]/{validate,publish}.)
-- Each Discover question's 4 "Variante de Explicații & Indicii" become its
-- Extras pool (one assigned per participant, spec section 11); the
-- Explicație + Indiciu are combined into a single Extra description.
-- extra_type (know/think/connect/ask/explore) is an editorial label we
-- chose per variant based on its content -- the source doc doesn't tag
-- these itself. No common_core/one_thing/reveal-message text or explore
-- links were supplied for this content, so those columns are left null;
-- the app already renders correctly without them.
--
-- Battle questions (daily + Final) each get one Extra too (product owner
-- request: supplementary info shouldn't stop at Discover) -- AI-drafted
-- here, unlike the Discover/Extra content above, since the source doc
-- didn't cover Battle; left verified = false / published = false the
-- same way, for the same human review pass before going live.
--
-- Safe to re-run: deletes any existing "kassandra-2026" trip (cascades to
-- its children) and reinserts. Do not run against production once real
-- pilot activity (participants/responses) exists for this trip.

delete from trips where slug = 'kassandra-2026';

-- prize is left unset: superseded by the prize_options vote below (the
-- wizard's prize step), not a fixed value anymore.
--
-- R7: timezone stamped explicitly as Europe/Athens -- the destination
-- (Kassandra, Halkidiki, Grecia) never had any other real timezone; this
-- was simply never set when R6 (20260907140000_r6_trip_timezone_and_
-- lifecycle.sql) added the column, since this trip predates it. Filling
-- it in here is completing a fact that was always true, not inventing
-- one -- see the R7 report's "date istorice" section. Explicitly NOT
-- run against production by this migration or any other (seed.sql is
-- never auto-applied -- see this file's own header); a live production
-- Kassandra row, if one still exists with timezone still null, is a
-- separate, deliberate operational decision, not made here.
insert into trips (slug, name, language, start_date, duration_days, destination, location_info, timezone, is_active, is_demo)
values (
  'kassandra-2026', 'Kassandra 2026', 'ro', '2026-09-01', 7,
  'Kassandra, Halkidiki, Grecia',
  'O peninsulă din nordul Greciei, cunoscută pentru plaje, măsline și istorie antică — pe aici au trecut fenicieni, greci și romani cu mii de ani în urmă.',
  'Europe/Athens',
  true, false
);

-- ---------------------------------------------------------------------
-- Prize vote (product owner's 3 recommendations, wizard step 5): each
-- participant votes for their favourite on first join; the option with
-- the most votes 12h after the first vote becomes the competition prize.
-- ---------------------------------------------------------------------
insert into prize_options (trip_id, title, description, order_index)
select id, o.title, o.description, o.order_index
from trips
join (values
  (1, 'Master of the Playlist (Controlul Muzicii)',
   'Echipa câștigătoare devine DJ-ul oficial al grupului pe tot drumul de întoarcere spre casă (sau în plimbările cu mașina), având control absolut asupra pieselor și melodiilor care rulează în difuzoare!'),
  (2, 'Misiunea „Curățenie la Plajă”',
   'Dacă părinții câștigă, copiii sunt responsabili să adune, să scuture și să strângă toate prosoapele, jucăriile de nisip și papucii la finalul zilei de plajă, fără nicio comentariu sau obiecție.'),
  (3, 'Bugetul pentru Suvenirul Secret',
   'Echipa câștigătoare primește dreptul de a-și alege un suvenir special și amuzant din piețele sau magazinele locale din Kassandra, finanțat/susținut de echipa învinsă!')
) as o(order_index, title, description) on true
where trips.slug = 'kassandra-2026';

-- =======================================================================
-- ZIUA 1: Sosirea în Kassandra & Legenda Tridentului
-- =======================================================================
with trip as (select id from trips where slug = 'kassandra-2026'),
morning_q as (
  insert into questions (trip_id, kind, day_number, slot, order_index, prompt, question_type, points)
  select id, 'discover', 1, 'morning', 1,
    'Cum explică mitologia greacă formarea celor trei „degete” ale peninsulei Halkidiki (Kassandra, Sithonia și Athos)?',
    'single_choice', 10
  from trip
  returning id
),
morning_opts as (
  insert into answer_options (question_id, order_index, label, is_correct)
  select morning_q.id, o.order_index, o.label, o.is_correct
  from morning_q
  join (values
    (1, 'Sunt pașii uriași ai unui titan.', false),
    (2, 'Sunt dinții tridentului aruncat de zeul mării, Poseidon.', true),
    (3, 'Sunt trei săbii căzute din cer după o luptă între zei.', false)
  ) as o(order_index, label, is_correct) on true
),
morning_extras as (
  insert into extras (trip_id, question_id, day_number, title, description, order_index, extra_type, audience)
  select t.id, morning_q.id, 1, e.title, e.description, e.order_index, e.extra_type::extra_type_enum, 'all'
  from trip t, morning_q
  join (values
    (1, 'Istorie & Geografie', 'Se spune că Poseidon s-a înfuriat pe titanii care locuiau aici și a lovit marea cu tridentul său. Prima peninsulă este Kassandra. 💡 Când traversați Canalul Nea Potidea la intrarea pe braț, priviți stâncile abrupte săpate de om pentru a lega Golful Thermaic de Golful Toroneos!', 'know'),
    (2, 'Spirit de Observație', 'Tridentul lui Poseidon este simbolul mării. 💡 Numărați câte poduri sau pontoane vedeți la sosire și căutați pe hartă locul unde se termină brațul Kassandra!', 'explore'),
    (3, 'Mitologie & Poveste', 'Părinții le pot povesti copiilor cum uriașii (titanii) aruncau cu bolovani în zei, iar Poseidon i-a împietrit sub formă de peninsule. 💡 Încercați să identificați de pe drum sau de pe plajă dacă puteți zări în zare al doilea braț, Sithonia!', 'connect'),
    (4, 'Interactivă / Provocare', 'Numele vechi al Kassandrei era Pallene. 💡 Găsiți o piatră plată pe plajă și aruncați-o în mare ca „tridentul lui Poseidon” – cine face cele mai multe „rățuște” pe apă?', 'explore')
  ) as e(order_index, title, description, extra_type) on true
),
lunch_q as (
  insert into questions (trip_id, kind, day_number, slot, order_index, prompt, question_type, points)
  select id, 'discover', 1, 'lunch', 1,
    'Cum se numește aperitivul grecesc răcoritor din iaurt strecurat, usturoi și castraveți pe care îl veți găsi la orice tavernă?',
    'single_choice', 10
  from trip
  returning id
),
lunch_opts as (
  insert into answer_options (question_id, order_index, label, is_correct)
  select lunch_q.id, o.order_index, o.label, o.is_correct
  from lunch_q
  join (values
    (1, 'Tzatziki', true),
    (2, 'Souvlaki', false),
    (3, 'Moussaka', false)
  ) as o(order_index, label, is_correct) on true
)
insert into extras (trip_id, question_id, day_number, title, description, order_index, extra_type, audience)
select t.id, lunch_q.id, 1, e.title, e.description, e.order_index, e.extra_type::extra_type_enum, 'all'
from trip t, lunch_q
join (values
  (1, 'Degustare & Textură', 'Tzatziki este făcut din iaurt grecesc gras (straggisto), castraveți rași scurși de apă, usturoi, ulei de măsline și uneori mărar. 💡 Întindeți-l pe lipie caldă și observați dacă simțiți mirosul intens de usturoi!', 'know'),
  (2, 'Brutărie & Patiserie', 'Pe lângă aperitivele de la tavernă, grecii adoră foietajele. 💡 Intrați la o brutărie (fournos) și căutați plăcinta dulce din foietaj cu cremă de griș numită Bougatsa sau varianta cu brânză, Tiropita!', 'explore'),
  (3, 'Ghicitoare culinară', 'Rețeta originală folosește usturoi proaspăt zdrobit. 💡 Întrebați chelnerul dacă sosul tzatziki este făcut în casă (spitiko)!', 'ask'),
  (4, 'Micii Bucătari', 'Este unul dintre cele mai ușor de preparat sosuri din lume. 💡 Identificați cele 3 ingrediente principale doar după gust și miros!', 'think')
) as e(order_index, title, description, extra_type) on true;

with trip as (select id from trips where slug = 'kassandra-2026'),
d1_battle as (
  insert into battles (trip_id, day_number, title, is_final, order_index)
  select id, 1, 'Battle — Ziua 1', false, 1
  from trip
  returning id, trip_id
),
d1_qs as (
  insert into questions (trip_id, battle_id, kind, day_number, order_index, prompt, question_type, points)
  select b.trip_id, b.id, 'battle', 1, v.order_index, v.prompt, 'single_choice', 10
  from d1_battle b
  join (values
    (1, 'Ce zeu al mării se spune că a format cele 3 brațe din Halkidiki aruncându-și tridentul?'),
    (2, 'Cum se numește canalul de apă săpat în stâncă prin care se intră pe brațul Kassandra?'),
    (3, 'Ce plăcintă tradițională caldă din foietaj cu cremă dulce de griș se găsește dimineața la brutăriile grecești (fournos)?')
  ) as v(order_index, prompt) on true
  returning id, order_index
)
insert into answer_options (question_id, order_index, label, is_correct)
select q.id, o.order_index, o.label, o.is_correct
from d1_qs q
join (values
  (1, 1, 'Zeus', false), (1, 2, 'Poseidon', true), (1, 3, 'Apollo', false),
  (2, 1, 'Canalul Nea Potidea', true), (2, 2, 'Canalul Suez', false), (2, 3, 'Canalul Corint', false),
  (3, 1, 'Bougatsa', true), (3, 2, 'Tiramisu', false), (3, 3, 'Croissant', false)
) as o(q_order, order_index, label, is_correct) on o.q_order = q.order_index;

-- Product owner: Battle questions get supplementary info too now, same
-- as Discover -- one Extra per question (no need for a 4-variant pool
-- like Discover's, a Battle round is a quick sprint, not a slow morning).
with trip as (select id from trips where slug = 'kassandra-2026'),
d1_battle as (select id from battles where trip_id = (select id from trip) and day_number = 1 and is_final = false),
d1_qs as (select id, order_index from questions where battle_id = (select id from d1_battle))
insert into extras (trip_id, question_id, day_number, title, description, order_index, extra_type, audience)
select (select id from trip), q.id, 1, e.title, e.description, 1, e.extra_type::extra_type_enum, 'all'
from d1_qs q
join (values
  (1, 'Trivia Val', 'Poseidon mai era supranumit și „Cel care scutură pământul” (Enosichthon), fiind zeul cutremurelor pe lângă cel al mării. 💡 Întrebați copiii ce alte puteri credeau vechii greci că are Poseidon, în afară de mare!', 'ask'),
  (2, 'Geografie Bonus', 'Canalul are doar câțiva metri lățime, dar transformă practic Kassandra într-o insulă legată de continent printr-un pod. 💡 Dacă treceți din nou pe acolo, numărați câte bărci de pescuit sunt ancorate în canal!', 'explore'),
  (3, 'Micul Dejun Grecesc', 'Bougatsa se vinde caldă, tăiată cu foarfeca chiar sub ochii clienților și pudrată din belșug cu zahăr și scorțișoară. 💡 Dacă mai gustați una, numărați câte straturi de foietaj vedeți în interior!', 'know')
) as e(q_order, title, description, extra_type) on e.q_order = q.order_index;

-- =======================================================================
-- ZIUA 2: Afitos – Satul de Piatră de pe Stâncă
-- =======================================================================
with trip as (select id from trips where slug = 'kassandra-2026'),
morning_q as (
  insert into questions (trip_id, kind, day_number, slot, order_index, prompt, question_type, points)
  select id, 'discover', 2, 'morning', 1,
    'Satul Afitos este considerat cel mai frumos sat tradițional din Kassandra. Prin ce este el deosebit față de alte stațiuni moderne?',
    'single_choice', 10
  from trip
  returning id
),
morning_opts as (
  insert into answer_options (question_id, order_index, label, is_correct)
  select morning_q.id, o.order_index, o.label, o.is_correct
  from morning_q
  join (values
    (1, 'Este construit complet din piatră locală pe o stâncă înaltă deasupra mării.', true),
    (2, 'Are doar case din sticlă.', false),
    (3, 'Este construit în întregime sub apă.', false)
  ) as o(order_index, label, is_correct) on true
),
morning_extras as (
  insert into extras (trip_id, question_id, day_number, title, description, order_index, extra_type, audience)
  select t.id, morning_q.id, 2, e.title, e.description, e.order_index, e.extra_type::extra_type_enum, 'all'
  from trip t, morning_q
  join (values
    (1, 'Arhitectură & Detalii', 'Casele din Afitos sunt ridicate din porolit (piatră de calcar locală). 💡 Priviți deasupra ușilor sau pe colțul caselor vechi: veți găsi sculptate anul construcției și simboluri speciale de protecție!', 'know'),
    (2, 'Belvedere / Balconul Egeei', 'Afitos are o faleză panoramică numită „Balconul din Afitos”. 💡 Mergeți la margine și priviți culoarea apei de sus: veți vedea cum nisipul deschis creează pete turcoaz spectaculoase!', 'explore'),
    (3, 'Atmosferă & Artizanat', 'În sat, mulți artiști locali au pictat pești și măslini pe ghivece din lut. 💡 Căutați cele mai colorate ghivece de flori puse de localnici în fața porților de piatră!', 'connect'),
    (4, 'Vânători de Pisici', 'Străduțele înguste umbroase păstrează răcoarea chiar și la amiază. 💡 Numărați câte pisici leneșe găsiți dormind la umbra balcoanelor din piatră!', 'explore')
  ) as e(order_index, title, description, extra_type) on true
),
lunch_q as (
  insert into questions (trip_id, kind, day_number, slot, order_index, prompt, question_type, points)
  select id, 'discover', 2, 'lunch', 1,
    'Ce fruct de mare deosebit este agățat pe frânghii la soare pe malul mării înainte de a fi pus pe grătar la tavernă?',
    'single_choice', 10
  from trip
  returning id
),
lunch_opts as (
  insert into answer_options (question_id, order_index, label, is_correct)
  select lunch_q.id, o.order_index, o.label, o.is_correct
  from lunch_q
  join (values
    (1, 'Creveții', false),
    (2, 'Caracatița', true),
    (3, 'Midiile', false)
  ) as o(order_index, label, is_correct) on true
)
insert into extras (trip_id, question_id, day_number, title, description, order_index, extra_type, audience)
select t.id, lunch_q.id, 2, e.title, e.description, e.order_index, e.extra_type::extra_type_enum, 'all'
from trip t, lunch_q
join (values
  (1, 'Pescărească', 'Caracatița este uscată la soare (liasto) pentru a elimina apa din carne, devenind crocantă la exterior și fragedă la interior pe grătar. 💡 Căutați frânghiile întinse lângă tavernele din port sau de pe plajă!', 'know'),
  (2, 'Fructe de Mare Crocante', 'Un alt fruct de mare foarte îndrăgit de copii sunt calamarii. 💡 Observați cum inelele de calamar prăjit (kalamarakia) se servesc întotdeauna cu feliuțe proaspete de lămâie!', 'connect'),
  (3, 'Măsline & Ulei', 'Mâncarea grecească se gătește cu ulei de măsline local. 💡 Turnați puțin ulei pe pâinea prăjită cu oregano și simțiți aroma fructată!', 'think'),
  (4, 'Biologie Marină', 'Caracatițele au 8 brațe și trei inimi. 💡 Încercați să numărați brațele sculptate sau desenate pe firmele tavernelor pescărești!', 'explore')
) as e(order_index, title, description, extra_type) on true;

with trip as (select id from trips where slug = 'kassandra-2026'),
d2_battle as (
  insert into battles (trip_id, day_number, title, is_final, order_index)
  select id, 2, 'Battle — Ziua 2', false, 1
  from trip
  returning id, trip_id
),
d2_qs as (
  insert into questions (trip_id, battle_id, kind, day_number, order_index, prompt, question_type, points)
  select b.trip_id, b.id, 'battle', 2, v.order_index, v.prompt, 'single_choice', 10
  from d2_battle b
  join (values
    (1, 'Ce detaliu puteți descoperi sculptat în piatră dacă priviți cu atenție fațadele caselor vechi din Afitos?'),
    (2, 'De ce agață pescarii caracatițele pe frânghii la soare înainte de a le pune pe grătar?'),
    (3, 'Cum se numesc inelele crocante prăjite dintr-un alt fruct de mare, servite la tavernă cu lămâie?')
  ) as v(order_index, prompt) on true
  returning id, order_index
)
insert into answer_options (question_id, order_index, label, is_correct)
select q.id, o.order_index, o.label, o.is_correct
from d2_qs q
join (values
  (1, 1, 'Anul în care au fost construite', true), (1, 2, 'Numele primarului', false), (1, 3, 'Prețul casei', false),
  (2, 1, 'Ca să se usuce apa din ele și carnea să devină fragedă', true), (2, 2, 'Ca să le vopsească', false), (2, 3, 'Ca să le joace', false),
  (3, 1, 'Inele de Calamar', true), (3, 2, 'Crochete de pește', false), (3, 3, 'Hamsii prăjite', false)
) as o(q_order, order_index, label, is_correct) on o.q_order = q.order_index;

with trip as (select id from trips where slug = 'kassandra-2026'),
d2_battle as (select id from battles where trip_id = (select id from trip) and day_number = 2 and is_final = false),
d2_qs as (select id, order_index from questions where battle_id = (select id from d2_battle))
insert into extras (trip_id, question_id, day_number, title, description, order_index, extra_type, audience)
select (select id from trip), q.id, 2, e.title, e.description, 1, e.extra_type::extra_type_enum, 'all'
from d2_qs q
join (values
  (1, 'Arhive de Piatră', 'Multe case vechi din Halkidiki poartă gravate nu doar anul, ci și inițialele familiei care a construit-o, ca o semnătură transmisă generațiilor următoare. 💡 Data viitoare când treceți printr-un sat de piatră, căutați și inițiale, nu doar cifre!', 'explore'),
  (2, 'Bucătărie Tradițională', 'Procesul se numește „liasto” și durează de obicei o zi întreagă la soare direct, fără sare — doar aerul și căldura fac treaba. 💡 Întrebați la tavernă cât timp a stat caracatița la uscat înainte de a ajunge pe grătar!', 'ask'),
  (3, 'Fripturi de Mare', 'Calamarii se curăță de o peliculă subțire înainte de a fi tăiați inele și dați prin făină, ca să rămână crocanți fără să absoarbă prea mult ulei. 💡 Comparați textura calamarului cu cea a caracatiței de la prânzul de ieri!', 'connect')
) as e(q_order, title, description, extra_type) on e.q_order = q.order_index;

-- =======================================================================
-- ZIUA 3: Capul Possidi & Limba Secretă de Nisip
-- =======================================================================
with trip as (select id from trips where slug = 'kassandra-2026'),
morning_q as (
  insert into questions (trip_id, kind, day_number, slot, order_index, prompt, question_type, points)
  select id, 'discover', 3, 'morning', 1,
    'La Capul Possidi se află o plajă extrem de specială numită Possidi Cape. Prin ce surprinde această limbă de nisip?',
    'single_choice', 10
  from trip
  returning id
),
morning_opts as (
  insert into answer_options (question_id, order_index, label, is_correct)
  select morning_q.id, o.order_index, o.label, o.is_correct
  from morning_q
  join (values
    (1, 'Își schimbă forma în funcție de valuri, curenți și maree.', true),
    (2, 'Este acoperită complet cu gheață.', false),
    (3, 'Are pietre care strălucesc în întuneric.', false)
  ) as o(order_index, label, is_correct) on true
),
morning_extras as (
  insert into extras (trip_id, question_id, day_number, title, description, order_index, extra_type, audience)
  select t.id, morning_q.id, 3, e.title, e.description, e.order_index, e.extra_type::extra_type_enum, 'all'
  from trip t, morning_q
  join (values
    (1, 'Fenomen Natural', 'Nisipul fin înaintează sute de metri în mare. 💡 Mergeți până în vârful limbei de nisip: veți observa că într-o parte apa poate avea valuri spumoase, iar pe cealaltă parte este lină ca o oglindă!', 'know'),
    (2, 'Farul Istoric', 'La marginea pădurii din Possidi se află un far alb construit în 1864 de o companie franceză. 💡 Căutați turnul alb al farului din piatră înconjurat de o grădină de pini!', 'explore'),
    (3, 'Vânătoare de Scoici', 'Curenții puternici aduc pe nisip scoici neobișnuite. 💡 Adunați 3 tipuri diferite de scoici de pe limba de nisip și comparați-le culorile!', 'explore'),
    (4, 'Mitologie', 'Zona Possidi își trage numele direct de la zeul Poseidon, aici fiind descoperit un sanctuar antic dedicat lui. 💡 Căutați pe hartă sau pe indicatoare denumirea veche „Poseidio”!', 'connect')
  ) as e(order_index, title, description, extra_type) on true
),
lunch_q as (
  insert into questions (trip_id, kind, day_number, slot, order_index, prompt, question_type, points)
  select id, 'discover', 3, 'lunch', 1,
    'Ce condiment aromat, care crește sălbatic pe dealurile din Kassandra, presară grecii peste cartofii prăjiți, pește și salate?',
    'single_choice', 10
  from trip
  returning id
),
lunch_opts as (
  insert into answer_options (question_id, order_index, label, is_correct)
  select lunch_q.id, o.order_index, o.label, o.is_correct
  from lunch_q
  join (values
    (1, 'Oregano', true),
    (2, 'Scorțișoară', false),
    (3, 'Vanilie', false)
  ) as o(order_index, label, is_correct) on true
)
insert into extras (trip_id, question_id, day_number, title, description, order_index, extra_type, audience)
select t.id, lunch_q.id, 3, e.title, e.description, e.order_index, e.extra_type::extra_type_enum, 'all'
from trip t, lunch_q
join (values
  (1, 'Botanică & Miros', 'Oregano-ul grecesc (Rigani) crește pe tufișurile uscate de pe dealuri. 💡 Când vă plimbați spre plajă, frecați o frunzuliță uscată în palme și simțiți aroma intensă!', 'know'),
  (2, 'Brânzeturi & Salată', 'Oregano este nelipsit de pe brânza Feta din salata grecească (Horiatiki). 💡 Observați cum Feta se servește ca o felie întreagă presărată cu oregano și stropită cu ulei!', 'connect'),
  (3, 'Cafea Rece / Răcorire', 'În timp ce mănâncă, adulții beau Frappé – cafea instant spumată cu gheață, inventată în Grecia în 1957. 💡 Observați spuma groasă din paharele înalte de pe mese!', 'think'),
  (4, 'Mâncare Stradală', 'Oregano-ul dă gustul specific cartofilor prăjiți de la tavernă. 💡 Comparați cartofii prăjiți locali cu cei obișnuiți – ce condiment le oferă parfumul deosebit?', 'ask')
) as e(order_index, title, description, extra_type) on true;

with trip as (select id from trips where slug = 'kassandra-2026'),
d3_battle as (
  insert into battles (trip_id, day_number, title, is_final, order_index)
  select id, 3, 'Battle — Ziua 3', false, 1
  from trip
  returning id, trip_id
),
d3_qs as (
  insert into questions (trip_id, battle_id, kind, day_number, order_index, prompt, question_type, points)
  select b.trip_id, b.id, 'battle', 3, v.order_index, v.prompt, 'single_choice', 10
  from d3_battle b
  join (values
    (1, 'Ce construcție istorică albă din 1864 se află la marginea pădurii din Possidi?'),
    (2, 'Ce condiment sălbatic cules de pe dealurile grecești se presară peste brânza Feta și cartofii prăjiți?'),
    (3, 'Ce băutură rece spumoasă pe bază de cafea și gheață a fost inventată din greșeală în Grecia?')
  ) as v(order_index, prompt) on true
  returning id, order_index
)
insert into answer_options (question_id, order_index, label, is_correct)
select q.id, o.order_index, o.label, o.is_correct
from d3_qs q
join (values
  (1, 1, 'Un Far istoric din piatră', true), (1, 2, 'O moară de vânt', false), (1, 3, 'Un turn de apărare', false),
  (2, 1, 'Oregano', true), (2, 2, 'Scorțișoară', false), (2, 3, 'Boia dulce', false),
  (3, 1, 'Frappé', true), (3, 2, 'Ceai fierbinte', false), (3, 3, 'Suc de mere', false)
) as o(q_order, order_index, label, is_correct) on o.q_order = q.order_index;

with trip as (select id from trips where slug = 'kassandra-2026'),
d3_battle as (select id from battles where trip_id = (select id from trip) and day_number = 3 and is_final = false),
d3_qs as (select id, order_index from questions where battle_id = (select id from d3_battle))
insert into extras (trip_id, question_id, day_number, title, description, order_index, extra_type, audience)
select (select id from trip), q.id, 3, e.title, e.description, 1, e.extra_type::extra_type_enum, 'all'
from d3_qs q
join (values
  (1, 'Lumina din Possidi', 'Farul a fost construit de o companie franceză și, în ciuda vârstei sale, mai funcționează parțial și astăzi cu tehnologie modernă alimentată solar. 💡 Dacă mai treceți pe acolo, vedeți dacă puteți zări lumina lui aprinsă seara!', 'know'),
  (2, 'Aromă de Deal', 'Grecii numesc oregano-ul sălbatic „rigani” și cred că cel cules manual, de pe dealuri necultivate, are un parfum mult mai puternic decât cel de cultură. 💡 Comparați mirosul de oregano de pe masă cu cel pe care l-ați mirosit ieri direct de pe tufă!', 'think'),
  (3, 'Poveste de Cafenea', 'Frappé a fost inventat întâmplător în 1957, când un angajat grec la un târg comercial nu a găsit apă fierbinte pentru cafeaua instant și a scuturat-o cu gheață. 💡 Întrebați un adult din familie dacă a încercat vreodată Frappé înainte de vacanța asta!', 'ask')
) as e(q_order, title, description, extra_type) on e.q_order = q.order_index;

-- =======================================================================
-- ZIUA 4: Pefkochori, Pădurile de Pini & Mierea Locală
-- =======================================================================
with trip as (select id from trips where slug = 'kassandra-2026'),
morning_q as (
  insert into questions (trip_id, kind, day_number, slot, order_index, prompt, question_type, points)
  select id, 'discover', 4, 'morning', 1,
    'Numele stațiunii Pefkochori din sud-estul Kassandrei se traduce într-un mod foarte sugestiv. Ce înseamnă cuvântul Pefkochori?',
    'single_choice', 10
  from trip
  returning id
),
morning_opts as (
  insert into answer_options (question_id, order_index, label, is_correct)
  select morning_q.id, o.order_index, o.label, o.is_correct
  from morning_q
  join (values
    (1, 'Satul cu pini', true),
    (2, 'Satul cu flori', false),
    (3, 'Orașul mării', false)
  ) as o(order_index, label, is_correct) on true
),
morning_extras as (
  insert into extras (trip_id, question_id, day_number, title, description, order_index, extra_type, audience)
  select t.id, morning_q.id, 4, e.title, e.description, e.order_index, e.extra_type::extra_type_enum, 'all'
  from trip t, morning_q
  join (values
    (1, 'Pădure & Apicultură', 'Pinii mediteraneeni (Pefkos) acoperă dealurile. Albinele colectează rășina de pin și produc o miere închisă la culoare. 💡 Căutați la magazinele de suveniruri borcane cu miere de pin de Kassandra!', 'know'),
    (2, 'Navigație / Bărci Tradiționale', 'Pescarii din Pefkochori folosesc bărci din lemn colorate numite Kaiki. 💡 Mergeți pe pontonul din Pefkochori și numărați câte bărci din lemn au culorile galben, albastru sau roșu!', 'explore'),
    (3, 'Conuri de Pin', 'Pinii din Halkidiki au conuri uriașe care cad pe nisip. 💡 Provocare de grup – cine găsește cel mai mare con de pin intact în timpul plimbării?', 'explore'),
    (4, 'Uleiuri Esențiale', 'Aerul din Pefkochori este extrem de curat datorită uleiurilor volatile eliberate de pini sub soarele fierbinte. 💡 Trageți aer adânc în piept când vă aflați sub pini și simțiți mirosul de rășină!', 'think')
  ) as e(order_index, title, description, extra_type) on true
),
lunch_q as (
  insert into questions (trip_id, kind, day_number, slot, order_index, prompt, question_type, points)
  select id, 'discover', 4, 'lunch', 1,
    'Ce pește mic și gustos, prăjit întreg și stropit cu lămâie, este servit la tavernele din port?',
    'single_choice', 10
  from trip
  returning id
),
lunch_opts as (
  insert into answer_options (question_id, order_index, label, is_correct)
  select lunch_q.id, o.order_index, o.label, o.is_correct
  from lunch_q
  join (values
    (1, 'Gavros (Hamsie) / Sardine', true),
    (2, 'Somon', false),
    (3, 'Rechin', false)
  ) as o(order_index, label, is_correct) on true
)
insert into extras (trip_id, question_id, day_number, title, description, order_index, extra_type, audience)
select t.id, lunch_q.id, 4, e.title, e.description, e.order_index, e.extra_type::extra_type_enum, 'all'
from trip t, lunch_q
join (values
  (1, 'Pește Mic Crocant', 'Peștii Gavros (hamsii) sau Sardeles (sardine) se prăjesc rapid în făină și se mănâncă întregi. 💡 Stoarceți lămâie peste ei și observați cât de crocanți sunt!', 'know'),
  (2, 'Ospitalitate / Pepene Roșu', 'La finalul mesei, grecii oferă un desert gratuit numit Kerasma (din partea casei). 💡 Observați ce fruct rece aduce ospătarul la final: de obicei feliuțe zemoase de pepene roșu (Karpouzi)!', 'connect'),
  (3, 'Salată Grecească / Masă de Familie', 'Grecii nu mănâncă individual, ci pun toate farfuriile pe mijlocul mesei (Mezedes) pentru a fi împărțite. 💡 Numărați câte farfurioare mici aveți în mijlocul mesei la prânz!', 'explore'),
  (4, 'Pâine & Sos de Usturoi', 'Alături de peștele prăjit se servește o pastă din cartofi cu usturoi numită Skordalia. 💡 Gustați o cantitate mică pe pâine pentru a simți iuțeala usturoiului!', 'think')
) as e(order_index, title, description, extra_type) on true;

with trip as (select id from trips where slug = 'kassandra-2026'),
d4_battle as (
  insert into battles (trip_id, day_number, title, is_final, order_index)
  select id, 4, 'Battle — Ziua 4', false, 1
  from trip
  returning id, trip_id
),
d4_qs as (
  insert into questions (trip_id, battle_id, kind, day_number, order_index, prompt, question_type, points)
  select b.trip_id, b.id, 'battle', 4, v.order_index, v.prompt, 'single_choice', 10
  from d4_battle b
  join (values
    (1, 'Ce produs dulce, de culoare închisă, produc albinele datorită pădurilor din Pefkochori?'),
    (2, 'Cum se numesc bărcile tradiționale grecești din lemn folosite de pescari?'),
    (3, 'Ce fruct dulce și zemos aduc adesea tavernele la finalul mesei ca desert din partea casei?')
  ) as v(order_index, prompt) on true
  returning id, order_index
)
insert into answer_options (question_id, order_index, label, is_correct)
select q.id, o.order_index, o.label, o.is_correct
from d4_qs q
join (values
  (1, 1, 'Miere de pin', true), (1, 2, 'Sirop de arțar', false), (1, 3, 'Ciocolată lichidă', false),
  (2, 1, 'Kaiki', true), (2, 2, 'Gondole', false), (2, 3, 'Submarine', false),
  (3, 1, 'Pepene roșu (Karpouzi)', true), (3, 2, 'Banane', false), (3, 3, 'Mango', false)
) as o(q_order, order_index, label, is_correct) on o.q_order = q.order_index;

with trip as (select id from trips where slug = 'kassandra-2026'),
d4_battle as (select id from battles where trip_id = (select id from trip) and day_number = 4 and is_final = false),
d4_qs as (select id, order_index from questions where battle_id = (select id from d4_battle))
insert into extras (trip_id, question_id, day_number, title, description, order_index, extra_type, audience)
select (select id from trip), q.id, 4, e.title, e.description, 1, e.extra_type::extra_type_enum, 'all'
from d4_qs q
join (values
  (1, 'Aur Dulce', 'Mierea de pin este mai puțin dulce și mai închisă la culoare decât mierea florală obișnuită, fiind foarte apreciată pentru gustul ei aromat și bogat în minerale. 💡 Dacă gustați miere de pin, comparați culoarea ei cu o miere obișnuită de flori!', 'know'),
  (2, 'Bărci Colorate', 'Bărcile Kaiki sunt vopsite manual în culori vii, iar fiecare pescar își alege propriile culori și un nume pictat pe prova, adesea al unei femei din familie. 💡 Data viitoare, citiți numele pictat pe o barcă Kaiki din port!', 'explore'),
  (3, 'Desert din Suflet', 'Oferirea gratuită a unui fruct proaspăt la finalul mesei (kerasma) este un gest tradițional de ospitalitate care nu apare niciodată pe nota de plată. 💡 Mulțumiți ospătarului special pentru acest gest data viitoare!', 'connect')
) as e(q_order, title, description, extra_type) on e.q_order = q.order_index;

-- =======================================================================
-- ZIUA 5: Izvoarele Termale din Loutra (Agia Paraskevi)
-- =======================================================================
with trip as (select id from trips where slug = 'kassandra-2026'),
morning_q as (
  insert into questions (trip_id, kind, day_number, slot, order_index, prompt, question_type, points)
  select id, 'discover', 5, 'morning', 1,
    'În satul Loutra din sudul peninsulei se află izvoare termale care ies direct din stâncă. Prin ce se remarcă această apă minerală?',
    'single_choice', 10
  from trip
  returning id
),
morning_opts as (
  insert into answer_options (question_id, order_index, label, is_correct)
  select morning_q.id, o.order_index, o.label, o.is_correct
  from morning_q
  join (values
    (1, 'Este caldă în mod natural și conține sulf benefic pentru sănătate.', true),
    (2, 'Este dulce ca limonada.', false),
    (3, 'Este înghețată tot timpul anului.', false)
  ) as o(order_index, label, is_correct) on true
),
morning_extras as (
  insert into extras (trip_id, question_id, day_number, title, description, order_index, extra_type, audience)
  select t.id, morning_q.id, 5, e.title, e.description, e.order_index, e.extra_type::extra_type_enum, 'all'
  from trip t, morning_q
  join (values
    (1, 'Vulcanică & Geologie', 'Apa termală izvorăște din adâncuri la 39°C și este bogată în sulf. 💡 Când vă apropiați de centrul SPA din Loutra, simțiți mirosul specific de sulf (care seamănă puțin cu cel al ouălor fierte)!', 'know'),
    (2, 'Peisaj & Stânci', 'Centrul termal este suspendat pe o stâncă înaltă deasupra mării. 💡 Priviți de pe faleză cum aburii apei termale sau scurgerile minerale au lăsat urme colorate pe stâncile abrupte!', 'explore'),
    (3, 'Tradiție de Sănătate', 'Loutra în limba greacă înseamnă „Băi”. 💡 Căutați pe indicatoare sau pe suveniruri numele Agia Paraskevi – bisericuța albă din apropiere!', 'connect'),
    (4, 'Valurile Mării', 'Sub stâncile cu apă termală, valurile mării se sparg spumos în grote mici. 💡 Ascultați sunetul mării la baza stâncilor din Loutra!', 'think')
  ) as e(order_index, title, description, extra_type) on true
),
lunch_q as (
  insert into questions (trip_id, kind, day_number, slot, order_index, prompt, question_type, points)
  select id, 'discover', 5, 'lunch', 1,
    'Ce mâncare tradițională grecească la cuptor este compusă din straturi de vinete, carne tocată și un sos delicios de bechamel?',
    'single_choice', 10
  from trip
  returning id
),
lunch_opts as (
  insert into answer_options (question_id, order_index, label, is_correct)
  select lunch_q.id, o.order_index, o.label, o.is_correct
  from lunch_q
  join (values
    (1, 'Moussaka', true),
    (2, 'Pizza', false),
    (3, 'Paella', false)
  ) as o(order_index, label, is_correct) on true
)
insert into extras (trip_id, question_id, day_number, title, description, order_index, extra_type, audience)
select t.id, lunch_q.id, 5, e.title, e.description, e.order_index, e.extra_type::extra_type_enum, 'all'
from trip t, lunch_q
join (values
  (1, 'Rețetă & Condimente', 'Moussaka conține felii de vinete și cartofi prăjiți, carne tocată condimentată cu nucșoară sau scorțișoară și un sos alb din lapte și făină. 💡 Observați straturile din farfurie când tăiați cu furculița!', 'know'),
  (2, 'Închinat & Tradiții', 'Când stau la masă, grecii închină de fiecare dată paharele urându-și sănătate. 💡 Închinați paharele la prânz și spuneți tare cuvântul Yamas! („La sănătatea noastră!”).', 'ask'),
  (3, 'Muzică la Tavernă', 'La mesele lungi de prânz se aude muzică tradițională grecească. 💡 Ascultați cu atenție instrumentul cu corzi numit Bouzouki – are un sunet vesel și alert!', 'explore'),
  (4, 'Brânză la Cuptor', 'Un alt aperitiv cald este Bouyourdi – brânză Feta coaptă în vas de lut cu roșii, ardei iute și oregano. 💡 Încercați să găsiți vasul din lut roșu pe masă!', 'know')
) as e(order_index, title, description, extra_type) on true;

with trip as (select id from trips where slug = 'kassandra-2026'),
d5_battle as (
  insert into battles (trip_id, day_number, title, is_final, order_index)
  select id, 5, 'Battle — Ziua 5', false, 1
  from trip
  returning id, trip_id
),
d5_qs as (
  insert into questions (trip_id, battle_id, kind, day_number, order_index, prompt, question_type, points)
  select b.trip_id, b.id, 'battle', 5, v.order_index, v.prompt, 'single_choice', 10
  from d5_battle b
  join (values
    (1, 'Ce mineral natural oferă apei calde din Loutra proprietățile curative și mirosul specific?'),
    (2, 'Ce cuvânt rostesc grecii când închină paharele la masă?'),
    (3, 'Ce instrument muzical grecesc cu corzi creează melodiile vesele din taverne?')
  ) as v(order_index, prompt) on true
  returning id, order_index
)
insert into answer_options (question_id, order_index, label, is_correct)
select q.id, o.order_index, o.label, o.is_correct
from d5_qs q
join (values
  (1, 1, 'Sulful', true), (1, 2, 'Aurul', false), (1, 3, 'Calciul roz', false),
  (2, 1, 'Yamas!', true), (2, 2, 'Cheers!', false), (2, 3, 'Bon Appetit!', false),
  (3, 1, 'Bouzouki', true), (3, 2, 'Vioară electrică', false), (3, 3, 'Pian', false)
) as o(q_order, order_index, label, is_correct) on o.q_order = q.order_index;

with trip as (select id from trips where slug = 'kassandra-2026'),
d5_battle as (select id from battles where trip_id = (select id from trip) and day_number = 5 and is_final = false),
d5_qs as (select id, order_index from questions where battle_id = (select id from d5_battle))
insert into extras (trip_id, question_id, day_number, title, description, order_index, extra_type, audience)
select (select id from trip), q.id, 5, e.title, e.description, 1, e.extra_type::extra_type_enum, 'all'
from d5_qs q
join (values
  (1, 'Chimie Naturală', 'Sulful din apele termale ajută la circulație și este folosit tradițional pentru afecțiuni ale pielii și articulațiilor, motiv pentru care localnicii vin aici de generații. 💡 Întrebați-i pe cei mai mari din familie dacă simt vreo diferență în piele după o baie termală!', 'ask'),
  (2, 'Tradiție la Masă', 'Cuvântul „Yamas” provine din grecescul „ygeia”, care înseamnă sănătate — exact ca și „igienă” în română. 💡 Închinați din nou paharele diseară și explicați tuturor originea cuvântului!', 'think'),
  (3, 'Instrument cu Poveste', 'Bouzouki are origini care se leagă de instrumente turcești și bizantine mai vechi, dar a devenit simbolul muzicii populare grecești moderne (rebetiko) abia în secolul XX. 💡 Căutați pe telefon un cântec cu bouzouki și ascultați-l în seara asta la cină!', 'explore')
) as e(q_order, title, description, extra_type) on e.q_order = q.order_index;

-- =======================================================================
-- ZIUA 6: Siviri – Apusul & Covrigii de Dimineață
-- =======================================================================
with trip as (select id from trips where slug = 'kassandra-2026'),
morning_q as (
  insert into questions (trip_id, kind, day_number, slot, order_index, prompt, question_type, points)
  select id, 'discover', 6, 'morning', 1,
    'Stațiunea Siviri de pe coasta de vest a Kassandrei este renumită pentru un spectacol natural zilnic. Care este acesta?',
    'single_choice', 10
  from trip
  returning id
),
morning_opts as (
  insert into answer_options (question_id, order_index, label, is_correct)
  select morning_q.id, o.order_index, o.label, o.is_correct
  from morning_q
  join (values
    (1, 'Apusul spectaculos în care soarele pare că se scufundă direct în Marea Egee.', true),
    (2, 'O ploaie de stele în fiecare amiază.', false),
    (3, 'Izvoare de apă fierbinte pe plajă.', false)
  ) as o(order_index, label, is_correct) on true
),
morning_extras as (
  insert into extras (trip_id, question_id, day_number, title, description, order_index, extra_type, audience)
  select t.id, morning_q.id, 6, e.title, e.description, e.order_index, e.extra_type::extra_type_enum, 'all'
  from trip t, morning_q
  join (values
    (1, 'Apus & Culori', 'De pe coasta de vest (Siviri), soarele apune direct peste marea deschisă. 💡 Priviți cerul spre seară și numărați câte nuanțe de portocaliu, roz și violet puteți vedea!', 'explore'),
    (2, 'Micul Dejun / Covrigi', 'Dimineața devreme, brutarii greci vând Koulouri – covrigi simpli, rotunzi, acoperiți cu semințe de susan. 💡 Gustați un Koulouri proaspăt și simțiți susanul prăjit!', 'know'),
    (3, 'Flori pe Drum', 'Șoselele din Kassandra sunt pline de tufe înalte de leandru (Nerium oleander). 💡 Priviți pe marginea drumului spre Siviri florile mari, roz și albe!', 'explore'),
    (4, 'Teatru Antic', 'Lângă Siviri se află un amfiteatru modern construit în stil antic grec, unde se organizează Festivalul Kassandra. 💡 Căutați pe drum indicatoarele spre „Amphitheatre Siviri”!', 'connect')
  ) as e(order_index, title, description, extra_type) on true
),
lunch_q as (
  insert into questions (trip_id, kind, day_number, slot, order_index, prompt, question_type, points)
  select id, 'discover', 6, 'lunch', 1,
    'Cum se numește faimoasa frigăruie grecească din carne de pui sau porc servită pe băț sau în lipie caldă?',
    'single_choice', 10
  from trip
  returning id
),
lunch_opts as (
  insert into answer_options (question_id, order_index, label, is_correct)
  select lunch_q.id, o.order_index, o.label, o.is_correct
  from lunch_q
  join (values
    (1, 'Souvlaki', true),
    (2, 'Schnitzel', false),
    (3, 'Hamburger', false)
  ) as o(order_index, label, is_correct) on true
)
insert into extras (trip_id, question_id, day_number, title, description, order_index, extra_type, audience)
select t.id, lunch_q.id, 6, e.title, e.description, e.order_index, e.extra_type::extra_type_enum, 'all'
from trip t, lunch_q
join (values
  (1, 'Frigărui / Souvlaki', 'Souvlaki reprezintă bucățele de carne marinate în ulei, lămâie și oregano, fripte pe cărbuni. 💡 Scoateți carnea de pe bățul din lemn și numărați câte bucățele sunt!', 'know'),
  (2, 'Gyros în Lipie', 'Dacă carnea este tăiată fâșii subțiri și pusă în lipie cu cartofi prăjiți și sos, se numește Gyros. 💡 Observați cum grecii pun cartofii prăjiți direct în interiorul lipiei!', 'connect'),
  (3, 'Condimentele Frigăruilor', 'Gustul secret al cărnii grecești este dat de oregano și sucul de lămâie stors imediat ce carnea este luată de pe grătar. 💡 Stoarceți o felie de lămâie peste Souvlaki!', 'think'),
  (4, 'Mâncare Rapidă de Plajă', 'Souvlaki este una dintre cele mai vechi mâncăruri rapide din lume – se mânca și pe vremea lui Aristotel! 💡 Numărați câte gherete de Souvlaki vedeți pe faleza din Siviri!', 'explore')
) as e(order_index, title, description, extra_type) on true;

with trip as (select id from trips where slug = 'kassandra-2026'),
d6_battle as (
  insert into battles (trip_id, day_number, title, is_final, order_index)
  select id, 6, 'Battle — Ziua 6', false, 1
  from trip
  returning id, trip_id
),
d6_qs as (
  insert into questions (trip_id, battle_id, kind, day_number, order_index, prompt, question_type, points)
  select b.trip_id, b.id, 'battle', 6, v.order_index, v.prompt, 'single_choice', 10
  from d6_battle b
  join (values
    (1, 'Cum se numesc covrigii rotunzi acoperiți cu susan mâncați dimineața la brutărie?'),
    (2, 'Ce arbust mediteranean cu flori roz sau albe crește pe marginile drumurilor din Kassandra?'),
    (3, 'Cum se numesc faimoasele frigărui grecești din carne de pui sau porc făcute pe grătar?')
  ) as v(order_index, prompt) on true
  returning id, order_index
)
insert into answer_options (question_id, order_index, label, is_correct)
select q.id, o.order_index, o.label, o.is_correct
from d6_qs q
join (values
  (1, 1, 'Koulouri', true), (1, 2, 'Croissante', false), (1, 3, 'Baghete', false),
  (2, 1, 'Leandrul', true), (2, 2, 'Trandafirul pitic', false), (2, 3, 'Bradul', false),
  (3, 1, 'Souvlaki', true), (3, 2, 'Schnitzel', false), (3, 3, 'Taco', false)
) as o(q_order, order_index, label, is_correct) on o.q_order = q.order_index;

with trip as (select id from trips where slug = 'kassandra-2026'),
d6_battle as (select id from battles where trip_id = (select id from trip) and day_number = 6 and is_final = false),
d6_qs as (select id, order_index from questions where battle_id = (select id from d6_battle))
insert into extras (trip_id, question_id, day_number, title, description, order_index, extra_type, audience)
select (select id from trip), q.id, 6, e.title, e.description, 1, e.extra_type::extra_type_enum, 'all'
from d6_qs q
join (values
  (1, 'Gustare de Dimineață', 'Koulouri se coace cu o crustă lucioasă obținută prin scufundarea aluatului în must de struguri (petimezi) înainte de a fi tăvălit prin susan. 💡 Gustați un Koulouri proaspăt și vedeți dacă simțiți gustul ușor dulceag al crustei!', 'know'),
  (2, 'Floare Frumoasă, dar Periculoasă', 'Leandrul este superb, dar toate părțile plantei sunt toxice dacă sunt ingerate, așa că e admirat doar din priviri, niciodată gustat sau mestecat. 💡 Arătați-le copiilor florile de leandru de pe marginea drumului, dar explicați-le să nu le atingă gura sau ochii după!', 'ask'),
  (3, 'Cea Mai Veche Street Food', 'Arheologii au găsit dovezi ale unor frigărui similare souvlaki-ului în situri grecești vechi de peste 3000 de ani, ceea ce îl face unul dintre cele mai vechi feluri de mâncare rapidă din lume. 💡 Imaginați-vă cum mâncau frigărui și grecii antici, cu mii de ani în urmă!', 'connect')
) as e(q_order, title, description, extra_type) on e.q_order = q.order_index;

-- =======================================================================
-- ZIUA 7: Natura din Sani & Ospitalitatea Grecească (+ Marea Finală)
-- =======================================================================
with trip as (select id from trips where slug = 'kassandra-2026'),
morning_q as (
  insert into questions (trip_id, kind, day_number, slot, order_index, prompt, question_type, points)
  select id, 'discover', 7, 'morning', 1,
    'În nord-vestul Kassandrei, în rezervația naturală Sani, există lacuri de coastă unde trăiesc sute de păsări. Ce păsări elegante de culoare roz pot fi văzute acolo?',
    'single_choice', 10
  from trip
  returning id
),
morning_opts as (
  insert into answer_options (question_id, order_index, label, is_correct)
  select morning_q.id, o.order_index, o.label, o.is_correct
  from morning_q
  join (values
    (1, 'Păsări Flamingo', true),
    (2, 'Pinguini', false),
    (3, 'Pelicani uriași', false)
  ) as o(order_index, label, is_correct) on true
),
morning_extras as (
  insert into extras (trip_id, question_id, day_number, title, description, order_index, extra_type, audience)
  select t.id, morning_q.id, 7, e.title, e.description, e.order_index, e.extra_type::extra_type_enum, 'all'
  from trip t, morning_q
  join (values
    (1, 'Rezervație & Flamingo', 'Mlaștinile din Sani (Sani Wetlands) sunt protejate. Păsările Flamingo își capătă culoarea roz mâncând creveți mici din apele puțin adânci. 💡 Căutați cu privirea pe lacuri păsările înalte cu picioare lungi!', 'know'),
    (2, 'Ospitalitatea Grecească', 'Grecii au un cuvânt special pentru bunătatea față de oaspeți: Philoxenia (care înseamnă „dragoste pentru străini”). 💡 Amintiți-vă de un localnic sau chelner care v-a zâmbit și v-a salutat călduros!', 'connect'),
    (3, 'Turnul Stavronikita', 'Pe dealul din Sani se află un turn vechi din piatră unde se păzea coasta împotriva piraților. 💡 Căutați turnul medieval din piatră de pe promontoriu!', 'explore'),
    (4, 'Pădurea de Pini & Traseu', 'Traseele din Sani șerpuiesc printre pini și mure sălbatice. 💡 Ascultați cântecul păsărilor din pădure în timp ce vă plimbați!', 'think')
  ) as e(order_index, title, description, extra_type) on true
),
lunch_q as (
  insert into questions (trip_id, kind, day_number, slot, order_index, prompt, question_type, points)
  select id, 'discover', 7, 'lunch', 1,
    'Ce gogoși mici grecești, prăjite aurii și stropite generos cu miere și scorțișoară, sunt desertul favorit al copiilor?',
    'single_choice', 10
  from trip
  returning id
),
lunch_opts as (
  insert into answer_options (question_id, order_index, label, is_correct)
  select lunch_q.id, o.order_index, o.label, o.is_correct
  from lunch_q
  join (values
    (1, 'Loukoumades', true),
    (2, 'Clătite', false),
    (3, 'Churros', false)
  ) as o(order_index, label, is_correct) on true
)
insert into extras (trip_id, question_id, day_number, title, description, order_index, extra_type, audience)
select t.id, lunch_q.id, 7, e.title, e.description, e.order_index, e.extra_type::extra_type_enum, 'all'
from trip t, lunch_q
join (values
  (1, 'Gogoși cu Miere', 'Loukoumades sunt bile din aluat prăjit, crocante la exterior și moi în interior, servite calde cu miere de pin și scorțișoară sau ciocolată. 💡 Numărați câte bile de gogoși sunt într-o porție!', 'know'),
  (2, 'Scorțișoară & Nuci', 'Rețeta antică de Loukoumades era oferită câștigătorilor la primele Olimpiade! 💡 Presărați nuci măcinate deasupra pentru gustul autentic olimpic!', 'connect'),
  (3, 'Suveniruri Gastronomice', 'La finalul vacanței, puteți lua acasă produse locale. 💡 Căutați o sticlă mică de ulei de măsline, un borcan de miere de pin sau pungi cu oregano sălbatic!', 'explore'),
  (4, 'Amintiri din Kassandra', 'Cel mai frumos desert este cel împărțit cu familia. 💡 Spuneți fiecare care a fost mâncarea sau desertul preferat din toată săptămâna!', 'ask')
) as e(order_index, title, description, extra_type) on true;

-- Marea Finală: replaces the usual evening Battle on Day 7 with a
-- 10-question recap (spec: getFinalBattle() matches on is_final regardless
-- of day_number; getDailyBattle(tripId, 7) intentionally finds nothing).
with trip as (select id from trips where slug = 'kassandra-2026'),
final_battle as (
  insert into battles (trip_id, day_number, title, is_final, order_index)
  select id, 7, 'Marea Finală Kassandra', true, 1
  from trip
  returning id, trip_id
),
final_qs as (
  insert into questions (trip_id, battle_id, kind, day_number, order_index, prompt, question_type, points)
  select b.trip_id, b.id, 'battle', 7, v.order_index, v.prompt, 'single_choice', 10
  from final_battle b
  join (values
    (1, 'Ce zeu al mării se spune că a format cele 3 brațe din Halkidiki aruncându-și tridentul?'),
    (2, 'Ce canal săpat în stâncă leagă marea la intrarea pe brațul Kassandra?'),
    (3, 'Ce sos răcoritor conține iaurt, usturoi și castraveți?'),
    (4, 'Ce detaliu istoric puteți găsi sculptat pe fațadele caselor vechi de piatră din Afitos?'),
    (5, 'De ce își agață pescarii caracatițele pe frânghii la soare?'),
    (6, 'Ce construcție istorică albă din 1864 se află lângă limba de nisip Possidi Cape?'),
    (7, 'Ce miere specială se produce în Pefkochori datorită pădurilor din jur?'),
    (8, 'Ce mineral oferă apei termale din Loutra proprietăți terapeutice și un miros specific?'),
    (9, 'Ce covrig rotund acoperit cu susan se mănâncă dimineața la brutărie?'),
    (10, 'Ce păsări roz elegante pot fi observate în rezervația naturală Sani?')
  ) as v(order_index, prompt) on true
  returning id, order_index
)
insert into answer_options (question_id, order_index, label, is_correct)
select q.id, o.order_index, o.label, o.is_correct
from final_qs q
join (values
  (1, 1, 'Zeus', false), (1, 2, 'Poseidon', true), (1, 3, 'Apollo', false),
  (2, 1, 'Canalul Corint', false), (2, 2, 'Canalul Nea Potidea', true), (2, 3, 'Canalul Suez', false),
  (3, 1, 'Tzatziki', true), (3, 2, 'Sos de roșii', false), (3, 3, 'Ketchup', false),
  (4, 1, 'Anul construcției', true), (4, 2, 'Numele primarului', false), (4, 3, 'Prețul casei', false),
  (5, 1, 'Ca să se usuce apa din ele și carnea să devină fragedă', true), (5, 2, 'Ca să le vopsească', false), (5, 3, 'Ca să le joace', false),
  (6, 1, 'Un Far istoric din piatră', true), (6, 2, 'O moară de vânt', false), (6, 3, 'Un turn TV', false),
  (7, 1, 'Miere de pin', true), (7, 2, 'Miere de portocal', false), (7, 3, 'Miere de lavandă', false),
  (8, 1, 'Sulful', true), (8, 2, 'Aurul', false), (8, 3, 'Fierul', false),
  (9, 1, 'Koulouri', true), (9, 2, 'Baghetă', false), (9, 3, 'Croissant', false),
  (10, 1, 'Flamingo', true), (10, 2, 'Pinguini', false), (10, 3, 'Papagali', false)
) as o(q_order, order_index, label, is_correct) on o.q_order = q.order_index;

-- Final Battle recap questions get their own Extra too -- a short
-- "remember this?" line tying the fact back to the week just lived,
-- rather than repeating each day's own Extra verbatim.
with trip as (select id from trips where slug = 'kassandra-2026'),
final_battle as (select id from battles where trip_id = (select id from trip) and is_final = true),
final_qs as (select id, order_index from questions where battle_id = (select id from final_battle))
insert into extras (trip_id, question_id, day_number, title, description, order_index, extra_type, audience)
select (select id from trip), q.id, 7, e.title, e.description, 1, e.extra_type::extra_type_enum, 'all'
from final_qs q
join (values
  (1, 'Recapitulare — Ziua 1', 'Ați aflat că peninsulele Halkidiki sunt, în legendă, urmele tridentului lui Poseidon. 💡 Cine din familie își amintește pe ce braț al Halkidikiului ați stat toată săptămâna?', 'ask'),
  (2, 'Recapitulare — Ziua 1', 'Canalul Nea Potidea desparte practic Kassandra de restul Greciei continentale. 💡 Descrieți cu propriile cuvinte cum arăta canalul când l-ați traversat!', 'think'),
  (3, 'Recapitulare — Ziua 1', 'Tzatziki a fost prima aromă grecească gustată în vacanță, la doar câteva ore de la sosire. 💡 Ce alt sos sau aperitiv grecesc v-a plăcut cel mai mult din toată săptămâna?', 'connect'),
  (4, 'Recapitulare — Ziua 2', 'Casele din piatră de la Afitos poartă anul construcției gravat pe fațadă, unele fiind vechi de peste un secol. 💡 Dacă ați făcut o poză cu o casă din Afitos, căutați-o acum și citiți din nou anul!', 'explore'),
  (5, 'Recapitulare — Ziua 2', 'Caracatița uscată la soare înainte de grătar a fost una dintre cele mai neobișnuite descoperiri culinare ale săptămânii. 💡 Ați îndrăznit să gustați caracatiță? Povestiți cum a fost!', 'ask'),
  (6, 'Recapitulare — Ziua 3', 'Farul alb din Possidi veghează limba de nisip în schimbare de sute de ani. 💡 Descrieți cum arăta nisipul de la Possidi — drept, curbat sau altfel?', 'think'),
  (7, 'Recapitulare — Ziua 4', 'Mierea de pin din Pefkochori este una dintre specialitățile pe care le puteți lua acasă ca suvenir gustos. 💡 Ați cumpărat vreun produs local până acum? Ce anume?', 'connect'),
  (8, 'Recapitulare — Ziua 5', 'Apele termale din Loutra, bogate în sulf, au fost cel mai neobișnuit „miros” al vacanței. 💡 Cine din familie a încercat baia termală și cum a fost senzația?', 'ask'),
  (9, 'Recapitulare — Ziua 6', 'Koulouri, covrigul rotund cu susan, a fost gustarea de dimineață perfectă înainte de plajă. 💡 A fost Koulouri sau Bougatsa gustarea voastră preferată de dimineață?', 'think'),
  (10, 'Recapitulare — Ziua 7', 'Flamingo din rezervația Sani încheie frumos călătoria, la fel cum Poseidon a deschis-o. 💡 Ce a fost cel mai frumos moment din toată săptămâna în Kassandra pentru fiecare dintre voi?', 'connect')
) as e(q_order, title, description, extra_type) on e.q_order = q.order_index;
