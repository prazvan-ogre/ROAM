-- Adds supplementary "Extra" content for Battle questions (product owner
-- request), which the earlier battle-extras work only ever added to
-- supabase/seed.sql -- a file that's never re-applied to a production
-- project once real pilot activity exists (its own header warns against
-- this, since it deletes and recreates the trip). This migration is the
-- safe, additive equivalent: it only inserts into `extras`, keyed off the
-- Battle/Final Battle questions that already exist in production (by
-- battle day_number/is_final + question order_index), and never touches
-- trips, participants, responses, or battle_scores.
--
-- One Extra per Battle/Final Battle question (28 total: 3 per daily
-- Battle x 6 days + 10 for the Final Battle) -- AI-drafted, since the
-- product owner's source doc only covered Discover. Left
-- verified = false, published = false (column defaults), same as every
-- other seeded Extra: per docs/DATABASE.md "Content integrity", only a
-- human fact-check + approval pass may flip those flags, and an AI
-- assistant authoring this migration is not that pass. Run this once the
-- content is reviewed:
--
--   update extras set verified = true, published = true
--     where trip_id = (select id from trips where slug = 'kassandra-2026')
--       and question_id in (select id from questions where kind = 'battle');
--
-- Idempotent: each insert is guarded by `where not exists (select 1 from
-- extras already there for that question)`, so re-running this migration
-- (e.g. against a project that already has these rows) is a no-op rather
-- than a duplicate.

with trip as (select id from trips where slug = 'kassandra-2026'),
d1_battle as (select id from battles where trip_id = (select id from trip) and day_number = 1 and is_final = false),
d1_qs as (select id, order_index from questions where battle_id = (select id from d1_battle))
insert into extras (trip_id, question_id, day_number, title, description, order_index, extra_type, audience)
select (select id from trip), q.id, 1, e.title, e.description, 1, e.extra_type, 'all'
from d1_qs q
join (values
  (1, 'Trivia Val', 'Poseidon mai era supranumit și „Cel care scutură pământul” (Enosichthon), fiind zeul cutremurelor pe lângă cel al mării. 💡 Întrebați copiii ce alte puteri credeau vechii greci că are Poseidon, în afară de mare!', 'ask'),
  (2, 'Geografie Bonus', 'Canalul are doar câțiva metri lățime, dar transformă practic Kassandra într-o insulă legată de continent printr-un pod. 💡 Dacă treceți din nou pe acolo, numărați câte bărci de pescuit sunt ancorate în canal!', 'explore'),
  (3, 'Micul Dejun Grecesc', 'Bougatsa se vinde caldă, tăiată cu foarfeca chiar sub ochii clienților și pudrată din belșug cu zahăr și scorțișoară. 💡 Dacă mai gustați una, numărați câte straturi de foietaj vedeți în interior!', 'know')
) as e(q_order, title, description, extra_type) on e.q_order = q.order_index
where not exists (select 1 from extras x where x.question_id = q.id);

with trip as (select id from trips where slug = 'kassandra-2026'),
d2_battle as (select id from battles where trip_id = (select id from trip) and day_number = 2 and is_final = false),
d2_qs as (select id, order_index from questions where battle_id = (select id from d2_battle))
insert into extras (trip_id, question_id, day_number, title, description, order_index, extra_type, audience)
select (select id from trip), q.id, 2, e.title, e.description, 1, e.extra_type, 'all'
from d2_qs q
join (values
  (1, 'Arhive de Piatră', 'Multe case vechi din Halkidiki poartă gravate nu doar anul, ci și inițialele familiei care a construit-o, ca o semnătură transmisă generațiilor următoare. 💡 Data viitoare când treceți printr-un sat de piatră, căutați și inițiale, nu doar cifre!', 'explore'),
  (2, 'Bucătărie Tradițională', 'Procesul se numește „liasto” și durează de obicei o zi întreagă la soare direct, fără sare — doar aerul și căldura fac treaba. 💡 Întrebați la tavernă cât timp a stat caracatița la uscat înainte de a ajunge pe grătar!', 'ask'),
  (3, 'Fripturi de Mare', 'Calamarii se curăță de o peliculă subțire înainte de a fi tăiați inele și dați prin făină, ca să rămână crocanți fără să absoarbă prea mult ulei. 💡 Comparați textura calamarului cu cea a caracatiței de la prânzul de ieri!', 'connect')
) as e(q_order, title, description, extra_type) on e.q_order = q.order_index
where not exists (select 1 from extras x where x.question_id = q.id);

with trip as (select id from trips where slug = 'kassandra-2026'),
d3_battle as (select id from battles where trip_id = (select id from trip) and day_number = 3 and is_final = false),
d3_qs as (select id, order_index from questions where battle_id = (select id from d3_battle))
insert into extras (trip_id, question_id, day_number, title, description, order_index, extra_type, audience)
select (select id from trip), q.id, 3, e.title, e.description, 1, e.extra_type, 'all'
from d3_qs q
join (values
  (1, 'Lumina din Possidi', 'Farul a fost construit de o companie franceză și, în ciuda vârstei sale, mai funcționează parțial și astăzi cu tehnologie modernă alimentată solar. 💡 Dacă mai treceți pe acolo, vedeți dacă puteți zări lumina lui aprinsă seara!', 'know'),
  (2, 'Aromă de Deal', 'Grecii numesc oregano-ul sălbatic „rigani” și cred că cel cules manual, de pe dealuri necultivate, are un parfum mult mai puternic decât cel de cultură. 💡 Comparați mirosul de oregano de pe masă cu cel pe care l-ați mirosit ieri direct de pe tufă!', 'think'),
  (3, 'Poveste de Cafenea', 'Frappé a fost inventat întâmplător în 1957, când un angajat grec la un târg comercial nu a găsit apă fierbinte pentru cafeaua instant și a scuturat-o cu gheață. 💡 Întrebați un adult din familie dacă a încercat vreodată Frappé înainte de vacanța asta!', 'ask')
) as e(q_order, title, description, extra_type) on e.q_order = q.order_index
where not exists (select 1 from extras x where x.question_id = q.id);

with trip as (select id from trips where slug = 'kassandra-2026'),
d4_battle as (select id from battles where trip_id = (select id from trip) and day_number = 4 and is_final = false),
d4_qs as (select id, order_index from questions where battle_id = (select id from d4_battle))
insert into extras (trip_id, question_id, day_number, title, description, order_index, extra_type, audience)
select (select id from trip), q.id, 4, e.title, e.description, 1, e.extra_type, 'all'
from d4_qs q
join (values
  (1, 'Aur Dulce', 'Mierea de pin este mai puțin dulce și mai închisă la culoare decât mierea florală obișnuită, fiind foarte apreciată pentru gustul ei aromat și bogat în minerale. 💡 Dacă gustați miere de pin, comparați culoarea ei cu o miere obișnuită de flori!', 'know'),
  (2, 'Bărci Colorate', 'Bărcile Kaiki sunt vopsite manual în culori vii, iar fiecare pescar își alege propriile culori și un nume pictat pe prova, adesea al unei femei din familie. 💡 Data viitoare, citiți numele pictat pe o barcă Kaiki din port!', 'explore'),
  (3, 'Desert din Suflet', 'Oferirea gratuită a unui fruct proaspăt la finalul mesei (kerasma) este un gest tradițional de ospitalitate care nu apare niciodată pe nota de plată. 💡 Mulțumiți ospătarului special pentru acest gest data viitoare!', 'connect')
) as e(q_order, title, description, extra_type) on e.q_order = q.order_index
where not exists (select 1 from extras x where x.question_id = q.id);

with trip as (select id from trips where slug = 'kassandra-2026'),
d5_battle as (select id from battles where trip_id = (select id from trip) and day_number = 5 and is_final = false),
d5_qs as (select id, order_index from questions where battle_id = (select id from d5_battle))
insert into extras (trip_id, question_id, day_number, title, description, order_index, extra_type, audience)
select (select id from trip), q.id, 5, e.title, e.description, 1, e.extra_type, 'all'
from d5_qs q
join (values
  (1, 'Chimie Naturală', 'Sulful din apele termale ajută la circulație și este folosit tradițional pentru afecțiuni ale pielii și articulațiilor, motiv pentru care localnicii vin aici de generații. 💡 Întrebați-i pe cei mai mari din familie dacă simt vreo diferență în piele după o baie termală!', 'ask'),
  (2, 'Tradiție la Masă', 'Cuvântul „Yamas” provine din grecescul „ygeia”, care înseamnă sănătate — exact ca și „igienă” în română. 💡 Închinați din nou paharele diseară și explicați tuturor originea cuvântului!', 'think'),
  (3, 'Instrument cu Poveste', 'Bouzouki are origini care se leagă de instrumente turcești și bizantine mai vechi, dar a devenit simbolul muzicii populare grecești moderne (rebetiko) abia în secolul XX. 💡 Căutați pe telefon un cântec cu bouzouki și ascultați-l în seara asta la cină!', 'explore')
) as e(q_order, title, description, extra_type) on e.q_order = q.order_index
where not exists (select 1 from extras x where x.question_id = q.id);

with trip as (select id from trips where slug = 'kassandra-2026'),
d6_battle as (select id from battles where trip_id = (select id from trip) and day_number = 6 and is_final = false),
d6_qs as (select id, order_index from questions where battle_id = (select id from d6_battle))
insert into extras (trip_id, question_id, day_number, title, description, order_index, extra_type, audience)
select (select id from trip), q.id, 6, e.title, e.description, 1, e.extra_type, 'all'
from d6_qs q
join (values
  (1, 'Gustare de Dimineață', 'Koulouri se coace cu o crustă lucioasă obținută prin scufundarea aluatului în must de struguri (petimezi) înainte de a fi tăvălit prin susan. 💡 Gustați un Koulouri proaspăt și vedeți dacă simțiți gustul ușor dulceag al crustei!', 'know'),
  (2, 'Floare Frumoasă, dar Periculoasă', 'Leandrul este superb, dar toate părțile plantei sunt toxice dacă sunt ingerate, așa că e admirat doar din priviri, niciodată gustat sau mestecat. 💡 Arătați-le copiilor florile de leandru de pe marginea drumului, dar explicați-le să nu le atingă gura sau ochii după!', 'ask'),
  (3, 'Cea Mai Veche Street Food', 'Arheologii au găsit dovezi ale unor frigărui similare souvlaki-ului în situri grecești vechi de peste 3000 de ani, ceea ce îl face unul dintre cele mai vechi feluri de mâncare rapidă din lume. 💡 Imaginați-vă cum mâncau frigărui și grecii antici, cu mii de ani în urmă!', 'connect')
) as e(q_order, title, description, extra_type) on e.q_order = q.order_index
where not exists (select 1 from extras x where x.question_id = q.id);

with trip as (select id from trips where slug = 'kassandra-2026'),
final_battle as (select id from battles where trip_id = (select id from trip) and is_final = true),
final_qs as (select id, order_index from questions where battle_id = (select id from final_battle))
insert into extras (trip_id, question_id, day_number, title, description, order_index, extra_type, audience)
select (select id from trip), q.id, 7, e.title, e.description, 1, e.extra_type, 'all'
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
) as e(q_order, title, description, extra_type) on e.q_order = q.order_index
where not exists (select 1 from extras x where x.question_id = q.id);
