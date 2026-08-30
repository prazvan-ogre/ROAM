# Changelog

## [Unreleased]

### Added
- Engineering foundation: Next.js 14 + TypeScript + Tailwind app scaffold.
- Supabase schema (content + activity tables) with RLS, version-controlled
  as migrations under `supabase/migrations/`.
- Seed data for the Kassandra 2026 pilot trip (`ro`, 5 days): Day 1 written
  as real draft content in the ROAM voice, pending fact-check/approval.
- GitHub Actions CI (install, lint, typecheck, build) on PRs to `main`/`develop`.
- `/api/health` health-check endpoint.
- PWA baseline: manifest, mobile viewport configuration.
- Documentation: `README.md`, `docs/ARCHITECTURE.md`, `docs/DATABASE.md`,
  `docs/DEPLOYMENT.md`.
- Trip join flow: adult profile creation, child profile management, all
  device-based (no login).
- Home screen: day-of-trip, Morning/Lunch/Battle status, Final Battle
  countdown, and (product owner request) a dashboard section — trip
  location blurb, all-device participant counts (adults/kids), days
  passed/remaining, today's and the trip's cumulative Parents-vs-Kids
  score, and a live countdown to the next challenge window.
- Full Discover interaction: profile picker ("Cine răspunde?"), question,
  answer submission, reveal (with per-question reveal-message pools),
  Common Core, One Thing, personal Extra assignment (load-balanced across
  a per-question pool, audience-scoped adult/child), Explore links with
  click tracking. Progress persists across refresh/reopen.
- Content-integrity gating: Discover/Battle questions and Extras are only
  served once `verified = true` and `published = true`, enforced in RLS.
- Daily Battle (spec sections 15-17): Parents-vs-Kids flow on one shared
  "controller" device — each team discusses and submits an answer, reveal
  shows both outcomes, running trip-level score persists across battles.
- Final Battle (spec section 18-19): same mechanic looped over every
  question in the trip's final battle, celebratory result screen.
- Feedback form (spec section 20): all 6 questions, shown once after the
  Final Battle; "already submitted" tracked client-side so it isn't
  re-asked on reopen.
- Time-of-day availability windows (product owner request, deliberately
  overriding the spec's own "don't build exact unlock times" suggestion):
  Morning 07:00-11:59, Lunch 12:00-17:00, Battle 19:00-23:00, device local
  time. Enforced on the Home screen and on direct page access alike;
  already-answered content stays reviewable outside its window.
- History page (product owner request): every published Discover question
  so far with the correct answer, One Thing, and each profile's own
  answer, plus every played Battle's questions and score.
- Restructured into 3 hub pages with a shared bottom nav (product owner
  request): Dashboard (`/trip/[slug]` — stats + today's actions, unchanged
  from above), Întrebări (`/trip/[slug]/questions` — replaces the History
  page with a day-by-day tab browser; rows are collapsed by default and
  click-to-expand into the answer/Common Core/One Thing/battle result),
  and Utilizatori (`/trip/[slug]/users` — profile list + add-child, moved
  off the Dashboard into its own page).
- Participant leaderboard on the Dashboard (product owner request — the
  spec explicitly lists individual leaderboards as out of scope, called
  out here as a deliberate exception): every participant trip-wide who
  has answered at least one Discover question, ranked by score (sum of
  `questions.points` for correct answers) with a medal for the top 3.
  Framed as a secondary "just for fun" list below the real competition,
  the Parents-vs-Kids score.

- Visual redesign (product owner request, ported from a Figma Make export
  based on the app's own UI inventory): new colour tokens (Aegean blue
  primary `#2076A3`, warm off-white background `#F7F7F5`, plus
  secondary/accent/border/destructive tokens) wired into
  `tailwind.config.ts`, `lucide-react` icons replacing plain text markers,
  a floating pill bottom nav, restyled cards/buttons/inputs across all
  screens (Dashboard, Întrebări, Utilizatori, Discover, Battle, Final
  Battle, Feedback). Purely visual — no routes, data-fetching, or state
  machines changed.
- Dedicated Scor page (`/trip/[slug]/leaderboard`, product owner request
  after seeing the Figma Make export's own dedicated leaderboard tab):
  4th bottom-nav tab with a Scor total/Scor zilnic toggle over the
  Parents-vs-Kids hero score and the individual "Clasamentul familiei"
  ranking (moved off the Dashboard, which previously showed a compact
  version of the same list, to avoid duplicating it). `getParticipantLeaderboard`
  now accepts an optional `day` to scope the ranking to a single day for
  the "Scor zilnic" tab, and returns `age` for the child-profile subtitle.
- Removed the Participanți/Zile/Scorul zilei/Scor general stat grid from
  the Dashboard (product owner request, now that the dedicated Scor page
  covers score and the Dashboard is action-focused) — dropped the
  now-unused participant-count and battle-leaderboard fetches from that
  page along with it.
- Replaced all seed content with the product owner's real 7-day Kassandra
  quiz (uploaded doc, not AI-drafted): trip is now 7 days, not 5. Each
  day's Morning/Lunch Discover question ships with its 4 supplied
  "Variante de Explicații & Indicii" as its Extras pool, and each evening
  Battle has its 3 supplied questions; Day 7's evening battle is the
  supplied 10-question "Marea Finală" (`is_final = true`) instead of a
  regular daily battle. Verified against the actual migrations + this
  seed on a scratch local Postgres 16 (not reachable from this sandbox
  against the real Supabase project): every question has exactly 3
  options with exactly 1 correct, every Discover question has exactly 4
  Extras, every Battle question's day matches its Battle's day. Left
  `verified = false, published = false` everywhere (same content-integrity
  gate as before) — the publish-flip SQL is in the `seed.sql` header
  comment.
- Utilizatori renamed to **Setări** (product owner request), restructured
  into 3 sub-sections behind an in-page tab switcher: Configurare
  (read-only destination/duration/`trips.prize`, a new column), Utilizatori
  (the existing profile list + add-child, now also with edit
  name/role/age and delete — new `updateParticipant`/`deleteParticipant`
  in `participant.ts`, and a `delete` RLS policy on `participants`), and
  Info (static copy explaining the scoring mechanism below).
- Battle scoring overhaul (product owner spec): each correct Battle answer
  is now worth 10 points (Final Battle: 5 points, `recordTeamAnswer` takes
  `isFinal`), and the "PĂRINȚI vs COPII" score shown on the Scor page is a
  **win tally**, not a raw point sum — whichever team has more points in a
  given Battle gets +1 for that evening, a tie gives +1 to both
  (`trip_battle_win_tally()`, `getBattleResult`/`getTripBattleWinTally` in
  `battle.ts`). The raw point sums (`battle_leaderboard()`/
  `trip_battle_leaderboard()`, unchanged) are kept as a secondary "puncte
  acumulate" line under the hero score. Verified the win-tally logic
  (win/loss/tie/not-yet-played) against seeded battle_scores rows on the
  same scratch local Postgres used to verify the seed content.
- First-visit onboarding wizard (product owner spec), replacing the old
  one-field join form: theme intro → name → "adult sau copil" (the
  participant is created here; age is collected for a child) → how the
  game works → vote for the prize → hands off to the Dashboard.
  Forward-only, no back navigation, so there's no path that could
  re-submit the join once it succeeds. A child can now be the first (and
  possibly only) participant on their own device — `child_needs_manager`
  relaxed (dropped) since not every child shares the parent's phone;
  `addChildProfile`'s `managingAdultId` is now optional. Verified the
  no-manager child insert against the relaxed constraint on a scratch
  local Postgres.
- The prize is now decided by a vote (product owner spec), not a fixed
  value: 3 options per trip (new `prize_options`/`prize_votes` tables),
  each participant picks their favourite once during onboarding (1 vote
  = 1 point, `unique(participant_id)`). 12 hours after the *first* vote,
  the window closes and the option with the most votes becomes the
  prize — computed on read (`getPrizeStatus` in `src/lib/prize.ts`), no
  background job. The wizard's prize step shows the 3 options while
  voting is open, or the decided winner once closed; Setări > Configurare
  shows the same live/decided status instead of a static `trips.prize`
  (that column is now unused, left in place rather than dropped). Seeded
  the Kassandra 2026 trip's 3 options (Master of the Playlist / Misiunea
  Curățenie la Plajă / Bugetul pentru Suvenirul Secret). Verified the
  open/closed/winner/tie-break logic and the cascade-delete of a
  participant's vote against seeded `prize_votes` rows at different
  timestamps on the same scratch local Postgres.
- The Dashboard's Final Battle card now only appears on the trip's last
  day (product owner request) — `getFinalBattle` isn't even fetched on
  earlier days, which show the "Final Battle în X zile" countdown line
  instead. Previously it was fetched and shown as soon as the Final Battle
  content existed in the database, regardless of the current day.
- Age is no longer required for a child profile (product owner request):
  the onboarding wizard's and Setări's age field is now optional
  everywhere a child profile is created or edited (`addChildProfile`'s
  `age` param is `number | null`). Every "Copil · X ani" label now falls
  back to plain "Copil" when no age was given, instead of rendering
  "Copil · null ani".
- Fixed: `/trip/[slug]/final` had no day gate at all, unlike Discover and
  Daily Battle (each already scoped to just today's `day_number`) — so a
  participant joining partway through the trip (or anyone navigating
  there directly) could play the Final Battle, which recaps every
  previous day's content, on day 1. A fresh attempt now requires
  `currentTripDay(trip) >= trip.duration_days`, same as the Dashboard's
  Final Battle card; an already-played Final Battle still stays
  reviewable regardless of day. Playing it early didn't corrupt any past
  daily Battle's own recorded result (each has its own `battle_id`), but
  it did let the "PĂRINȚI vs COPII" season tally count that evening
  before it should.
- Catch-up, take two (product owner follow-up correcting the previous
  entry): moved from a Dashboard section into a 6th onboarding-wizard
  step (`intro → name → role → how → catchup → prize`), right after the
  new participant is created and before the prize vote — and widened to
  include previous days' **Battle** questions too, not just Discover.
  `getCatchUpQuestions(tripId, currentDay, participantId)` in
  `discover.ts` (replacing `getPendingDiscoverCatchUp`) finds every
  past-day question of either kind this specific participant hasn't
  answered, shown one after another in the wizard with immediate
  correct/incorrect feedback (`submitResponse`, same call Discover uses).
  Battle questions answered this way are a personal-score-only exercise:
  they insert a normal `responses` row, never a `battle_scores` row (the
  team submission recorded live during `BattleFlow`), so catching up
  can't retroactively change any already-played Battle's result — a late
  joiner still plays every future Battle live, as a team, same as
  everyone else. `getParticipantLeaderboard` no longer filters to
  `kind = 'discover'` only, so these catch-up points now count toward
  the individual "Clasamentul familiei" score (in practice this only
  ever adds Battle points for catch-up answers, since a live Battle
  never creates an individual `responses` row either way). The Discover
  route's `?day=` param and the Dashboard's "De recuperat" section from
  the previous entry are reverted — this wizard step replaces both.
  Verified the pending-question count, that `battle_scores` stays at 0
  rows after catch-up answers, and the personal-score sum across both
  kinds, against seeded data on the same scratch local Postgres.
- Removed the "Puncte acumulate: X — Y" secondary line from the Scor
  page (product owner request), on both the Scor total and Scor zilnic
  tabs — the win-tally headline score is the only number shown now. The
  `getBattleLeaderboard`/`getTripLeaderboard` raw-point-sum calls that
  fed it are dropped from this page (still used elsewhere: `/battle`,
  `/final`, `history.ts`, and internally by `getBattleResult`).
- Battle scoring overhaul, take two (product owner follow-up): every
  participant now answers Battle questions individually, pass-the-phone
  style (select your own profile, then work through the evening's
  questions one after another) — not one shared submission per team via
  a "controller" device. `BattleFlow.tsx` was rebuilt around this,
  mirroring the Discover flow's select-profile/question/reveal pattern;
  `/battle` and `/final` no longer pre-block the whole page on a
  battle-wide "already played" flag, since that's no longer meaningful
  per participant.
  - To keep team size from mattering (e.g. 3 kids vs. 2 adults), a
    team's score for a battle is now the **average** of its members'
    points (sum ÷ distinct participants who answered), not the raw sum —
    `battle_team_score()` (new SQL function, replacing
    `battle_leaderboard()`/`trip_battle_leaderboard()`, both dropped) and
    an updated `trip_battle_win_tally()` compare averages. Battles played
    before this feature (old controller-submitted rows, no
    `participant_id`) keep their original raw-sum result instead of
    being retroactively recomputed — the migration resolves each battle
    in whichever mode its own rows are in.
  - Only Battle answers ever count toward the "PĂRINȚI vs COPII" score
    (unchanged) — Discover answers never did and still don't.
  - A team's evening result stays hidden for 15 minutes after the first
    individual answer to that battle (`getBattleWindowStatus` in
    `battle.ts`), so nobody sees a partial score while others are still
    deciding — enforced everywhere the result is shown (BattleFlow's own
    "done" screen, and the Scor page's "Scor zilnic" tab). A late answer
    past that window is still recorded to the individual's own score
    (`responses`, via `recordBattleAnswer`) but is excluded from
    `battle_scores`, so it can never move the team result — the same
    guarantee the wizard's catch-up step already has for past battles.
  - `getParticipantLeaderboard`'s individual score already summed every
    kind of correct answer (Discover and Battle alike, from the previous
    entry) — unchanged, now simply also fed by everyone's live Battle
    answers, not just wizard catch-up ones.
  - Known gap: the recap page (Întrebări) doesn't re-check the 15-minute
    window before showing a battle's result, unlike BattleFlow and the
    Scor page — in practice only relevant for a battle still inside that
    window, which nobody would yet have reason to look up in the recap.
  - Verified on a scratch local Postgres with an intentionally uneven
    battle (2 adults, both fully correct, raw sum 60; 3 kids, mostly
    correct, raw sum 70): confirmed the average-based comparison
    (adults 10.0 vs. kids 7.78) gives adults the evening's win — the
    opposite of what the old raw-sum comparison would have given — and
    that a separately seeded legacy (no `participant_id`) battle still
    resolves by raw sum, with the hybrid trip-wide tally correctly
    combining both (1-1).
- Reworded the onboarding wizard's prize step (product owner request) to
  frame it explicitly as the winning team's prize, not just "your
  favourite prize" — every state (voting open, winner decided, no
  options yet) now names "echipa câștigătoare — Copii sau Părinți"
  instead of leaving that connection implicit.
- Fixed: catch-up questions were only ever reachable once, during the
  onboarding wizard's one-time step right after a participant is
  created — a participant who'd already finished onboarding (joined on
  time, or caught up once already) had no way back to a question they
  later realized they'd missed, since the Dashboard only ever shows
  *today's* own Discover/Battle slots and the Întrebări/recap page is
  read-only (product owner: manually confirmed unable to answer a
  previous day's questions). Added `/trip/[slug]/catchup`, a standalone
  page any already-joined participant can open at any time (profile
  picker, same pattern as Discover/Battle, then their own pending
  questions one after another via `getCatchUpQuestions` +
  `submitResponse` — same as the wizard step, same guarantee that it
  never touches `battle_scores`); the Dashboard now shows an "Ai
  întrebări de recuperat" banner linking to it whenever any profile on
  the device has something pending.
- Fixed (same report, product owner follow-up): `getCatchUpQuestions`
  only ever considered days strictly before the current one
  (`day_number < currentDay`), so someone joining (or opening
  `/catchup`) *today*, after a slot's own time-of-day window had already
  closed — e.g. after lunch's 12:00-17:00, or after Battle's
  19:00-23:00 — still couldn't reach that slot: it's not a past day, but
  the normal Discover/Battle pages block a fresh answer once
  `getSlotAvailability` reports `"after"`. `getCatchUpQuestions` now also
  includes *today's* own Discover slot or Battle once its window has
  actually closed (still excluding the Final Battle, and still leaving a
  slot that's open or not yet open to the normal flow, not catch-up).
  Verified the day/time matrix directly (no DB needed, this is pure date
  logic): mid-morning on day 1 yields nothing (normal flow handles it);
  mid-lunch on day 1 yields just that morning's question; late evening
  on day 1 (all three windows closed) yields all of that day's Discover
  + Battle questions; joining on day 2 still yields all of day 1
  regardless of time (unchanged); and the Final Battle never appears
  even when its own day's Battle window has closed.
- Fixed (same report, product owner follow-up): both catch-up surfaces
  (the wizard step and the new `/catchup` page) only ever confirmed
  correct/incorrect on a missed question — the message, Common Core, One
  Thing, assigned Extra, Explore links, and the "ask others" invitation
  that the live Discover flow always shows were silently skipped. A
  missed question now gets the same treatment once answered: reveal
  (message + Common Core + One Thing), then — for a Discover-kind
  question, since Extras are only ever assigned against those
  (`docs/DATABASE.md`) — the same assigned Extra + Explore links +
  "Ceilalți au descoperit ceva puțin diferit. Întreabă-i ce au primit."
  line as `/discover/[slot]`, via the same `getOrAssignExtra`. A missed
  Battle question has no Extra step (never did, live or caught up) and
  goes straight from reveal to the next question. `getCatchUpQuestions`
  now also fetches each pending question's `explore_links`, same as
  `getDiscoverQuestion`.
- Catch-up, take three (product owner follow-up): removed entirely from
  `OnboardingWizard.tsx` — it was interposed as its own step between
  "how it works" and the prize vote, but catch-up is a homepage thing,
  not something that should block a brand-new joiner from reaching the
  prize step. `STEP_ORDER` is back to `intro → name → role → how →
  prize`; every catch-up-related state, effect, handler and render block
  is gone from the wizard. The only way to catch up now is the
  Dashboard's "Ai întrebări de recuperat" banner → `/trip/[slug]/catchup`
  (already reachable any time, from the previous entry) — including
  right after a brand-new participant finishes the (now catch-up-free)
  wizard, since `handleWizardComplete` already recomputes the banner.
- Extra/Explore content on `/catchup` and in live Battle no longer waits
  on a second tap (product owner: it should show automatically the
  moment an answer is validated, not need an extra step). `/catchup`'s
  separate "reveal" → "MERGI MAI DEPARTE" → "extra" sequence is merged
  into one screen: submitting an answer now fetches the response and the
  assigned Extra together, and reveal + Common Core + One Thing + Extra
  + Explore links + "ask others" all render at once. `BattleFlow.tsx`
  (live Daily/Final Battle) gets the same treatment: `handleSubmit` now
  also calls `getOrAssignExtra` alongside `recordBattleAnswer`, and the
  existing "reveal" step shows the assigned Extra + Explore links + an
  "ask others" line under the correct answer, automatically.
- Battle questions now carry their own supplementary info, same as
  Discover (product owner: extra info shouldn't stop at Discover) — the
  database had none (`extras.question_id` only ever pointed at Discover
  questions in the seed data), so this adds one AI-drafted Extra per
  Battle/Final Battle question (28 total: 3 per daily Battle × 6 days +
  10 for the Final Battle) via `supabase/seed.sql`, left `verified =
  false`/`published = false` for the same human review pass as the rest
  of the seed content. `BattleQuestion` (`battle.ts`) and `CatchUpQuestion`
  (`discover.ts`) both gained an `exploreLinks` field, and
  `loadBattleContent` now fetches `explore_links` per question, same as
  `getDiscoverQuestion` — Battle never had a reason to before, since it
  never showed Extras. Verified against a scratch local Postgres: all 28
  Battle/Final Battle questions resolve to exactly one Extra row after
  running the updated `seed.sql`.
- Fixed (product owner: reported no Battle Extras showing after the
  above): the Battle Extras only ever landed in `seed.sql`, which is
  explicitly not safe to re-run once a project has real pilot activity
  (its own header deletes and recreates the trip) — so a live project
  never actually got the new rows, only a fresh local one seeded from
  scratch would. Added `supabase/migrations/20260826190000_battle_extras_content.sql`,
  the safe additive equivalent: the same 28 Extra rows, keyed off the
  Battle/Final Battle questions that already exist (by day_number/
  is_final + question order_index), guarded by `where not exists` so
  re-running it is a no-op, and touching only `extras` — never `trips`/
  `participants`/`responses`/`battle_scores`. Verified on a scratch
  Postgres seeded to match a live project's actual current state (schema
  + the pre-Battle-Extras `seed.sql`, 28 Battle questions/0 Battle
  Extras): the migration inserts exactly 28 rows on first run and 0 on a
  second run. Left `verified = false`/`published = false` like every
  other seeded Extra — reaching a live project still needs `supabase db
  push` (or pasting the migration into the Supabase SQL editor) run
  against it, which nothing in this session can do on its own, and the
  content still needs the same human review-and-publish pass as the rest
  of the seed content before it's visible.
- Fixed: the Întrebări (recap) page's Discover rows revealed the correct
  answer and One Thing to anyone who expanded them, whether or not this
  device had actually answered that question yet (product owner:
  noticed Day 1's own two questions sitting there, spoiled, while Day 1
  itself was still in progress). `getTripHistory` also only ever fetched
  questions up to the current trip day, so later days never appeared at
  all -- reworked to fetch every Discover question in the trip (RLS
  still limits this to published/verified content) and gate the reveal
  entirely on `responsesByParticipant` having an entry for this device:
  unanswered questions now show in the list (with a small lock icon)
  same as answered ones, but expanding one only shows a "answer it first"
  line instead of the answer, Common Core, One Thing, Extra, or Explore
  links. Answered ones show all of that, now including the Common Core
  and each participant's own assigned Extra (via `extra_assignments`,
  read back rather than freshly assigned) and the question's Explore
  links, none of which the recap page showed before at all. The day-tabs
  row now always covers every day with published content (not just days
  reached so far), defaulting to the current trip day. Verified the
  per-participant answered/locked split directly on a scratch Postgres:
  a participant who's only answered Day 1's morning question resolves
  every other slot -- including that same day's own lunch, and every
  later day -- as unanswered/locked.
- Fixed (product owner follow-up, correcting the entry above): showing
  every day's questions in the recap, locked, went too far -- even a
  locked question's bare prompt lets someone search for the answer
  elsewhere before the calendar reaches it. `getTripHistory` is day-gated
  again (`day_number <= uptoDay`, the day-tabs row only ever covers days
  already reached), while keeping the answer-based reveal gating from the
  previous entry -- so a *reached* day's questions still show in the
  list, still locked until this device answers, but a day the calendar
  hasn't reached yet doesn't appear at all anymore.
- Live Discover (`/discover/[slot]`) gets the same treatment already
  given to Battle and catch-up: answering a morning/lunch question no
  longer needs a second "MERGI MAI DEPARTE" tap to see the Extra --
  `handleSubmitAnswer` now fetches the assigned Extra (`getOrAssignExtra`)
  in the same call as recording the response, and the single "reveal"
  screen shows the correct-answer message, Common Core, One Thing,
  Extra, and Explore links together, immediately. The separate "extra"
  step is gone; reviewing an already-answered question (via the
  "Cine răspunde?" picker) goes straight to this same merged reveal.
  Discover, Battle, and catch-up now all reveal the same way.
- Fixed (product owner, restating the ask): the recap page's per-question
  lock (unanswered questions listed with a lock icon, reachable day)
  still went further than intended -- the Întrebări menu should only
  ever list questions this device has actually answered, full stop, not
  list every reached day's questions with the unanswered ones locked.
  `discoverForTab` in `questions/page.tsx` now filters to
  `responsesByParticipant` having an entry, so an unanswered question
  simply isn't in the list at all. `DiscoverRow` no longer has an
  unanswered/locked render path (every row it receives is now guaranteed
  answered) -- the lock icon and the "answer it first" placeholder are
  gone as dead code.
- Reworded two spots in the onboarding wizard (product owner request):
  the "role" step's heading is now "În ce echipă faci parte?" instead of
  "Ești adult sau copil?", with its two buttons relabeled "Adulți"/
  "Copii" (plural, team-framed) instead of "Adult"/"Copil"; the prize
  step's active-vote heading is now just "Copii vs. Părinți" instead of
  "Ce ar trebui să primească echipa câștigătoare — Copii sau Părinți?".
  Copy-only -- `role` is still stored as `'adult' | 'child'` internally,
  unaffected.
- Added `app/trip/[slug]/error.tsx` and `app/global-error.tsx`: a bug
  report from a real user only ever arrives as a phone screenshot, never
  a browser console, and Next.js's own fallback for an uncaught
  client-side exception ("Eroare de aplicație: a apărut o excepție la
  nivelul clientului") hides the actual error entirely. These show
  `error.message` (and `error.digest`, if any) directly on screen, with
  a retry button and a link home, so the *next* screenshot of a crash
  carries the real cause instead of a dead end. `error.tsx` covers
  everything under `/trip/[slug]` (the wizard, Discover, Battle,
  catch-up, recap, Settings, Scor); `global-error.tsx` covers the bare
  root layout (its own `<html>`/`<body>`, per Next.js's requirement for
  a root-level error boundary).
- Found the actual cause of the crash the error screen above was built
  to diagnose: "Obiectul nu poate fi găsit aici" (Chrome's own
  translation of `DOMException: NotFoundError: The object can not be
  found here`) is a well-known React/Chrome-Translate incompatibility --
  when Chrome's page-translate feature rewrites text nodes in place,
  React's next DOM update (removing/reordering nodes it thinks are still
  where it left them, e.g. moving from the wizard's "name" step to
  "role") throws this exact error. Two contributing bugs, both fixed:
  `app/layout.tsx` had `<html lang="en">` despite 100% Romanian content,
  a language mismatch that makes Chrome more likely to offer translation
  in the first place; and nothing told Chrome not to translate at all.
  Fixed `lang` to `"ro"`, added `translate="no"` + `class="notranslate"`
  on `<html>` (root layout and both error boundaries, since
  `global-error.tsx` renders its own), and a `<meta name="google"
  content="notranslate">` tag (via `metadata.other` in `layout.tsx`) --
  the combination Chrome actually honors to skip the translate offer
  entirely. Verified the rendered HTML directly (`next dev` + `curl`).
- Fixed: the Daily Battle's "GATA" button (shown on the last question's
  reveal) could look completely unresponsive -- `handleNext` awaited
  `goToDone()`, which made two network calls
  (`getBattleWindowStatus`/`getBattleResult`) with no error handling; if
  either failed, the click silently did nothing; a phone doesn't have a
  console to see why. Two changes: `goToDone()` now catches that failure
  and still reaches the "done" screen (with its safe "not visible yet"
  default) instead of leaving the button looking stuck -- covers the
  review path and the Final Battle, both of which still go through it.
  For the Daily Battle specifically (product owner request), "GATA" now
  skips the score screen entirely and goes straight home, sidestepping
  those network calls on this specific click path altogether; the score
  stays visible on the Scor page. The Final Battle's "GATA" is
  unchanged -- still `goToDone()` -> "done" -> "CONTINUĂ" into the
  feedback flow, which wasn't reported broken.
- Fixed: `battle_team_score()`/`trip_battle_win_tally()` (added in
  `20260826153000_individual_battle_scoring.sql`) resolved a battle's team
  score with `avg(score)`, which averages over `battle_scores` *rows* --
  one per participant per question -- not over participants. The spec is
  "sum of correct-answer points divided by the number of participants in
  that team." With every participant answering the same number of
  questions (the normal case) this happened to preserve which team had
  the higher score, so no evening's win/loss actually flipped, but the
  displayed magnitude on the Întrebări recap page ("PĂRINȚI X — COPII Y")
  was wrong -- understated by roughly the question count -- and would
  have become a real win/loss bug the moment participation went uneven
  across a battle's questions (e.g. someone finishing only part of it
  within the window). Fixed to `sum(score) / count(distinct
  participant_id)`, exactly matching the spec; the legacy raw-sum branch
  (battles played before individual scoring, `participant_id is null`)
  is untouched. Both functions are `security definer` and computed live
  on every read rather than stored, so deploying the fixed migration
  retroactively corrects every past and future read with no data
  backfill. Verified on a scratch Postgres against both branches: an
  uneven-team scenario (2 adults 3/3 correct, 3 kids 2/3 correct -- an
  intentional raw-sum tie of 60 each) previously showed adults 10.0 /
  kids 6.67, now correctly shows adults 30 / kids 20; a legacy
  (pre-feature) battle's raw-sum resolution was confirmed unchanged.
- Fixed: `trip_battle_win_tally()` (the "Scor total" headline) counted
  every battle with any `battle_scores` rows at all, with no check on
  whether that evening's own 15-minute reveal window had actually
  closed -- so as soon as a single person answered tonight's Battle, the
  cumulative tally already counted the (partial, one-answer) outcome as
  a win for whichever team was ahead so far, even though "Scor zilnic" on
  the same Scor page correctly stays hidden for those same 15 minutes so
  nobody can peek at a partial score. Confirmed against production
  screenshots: "Scor total" already showed 1-1 on Ziua 1 while "Scor
  zilnic" correctly showed 0-0, meaning the total had already absorbed
  an in-progress result the daily view was still hiding. Reproduced on a
  scratch Postgres -- inserting one battle_scores row flipped the tally
  from 1-1 to 2-1 instantly -- and fixed by excluding a battle from the
  tally until 15 minutes past its first individual answer, exactly
  matching `getBattleWindowStatus()`'s own rule; confirmed the same
  battle correctly re-enters the tally once that time passes. Legacy
  (pre-individual-scoring) battles never had a reveal window and stay
  counted unconditionally, unaffected.
- Fixed: the Scor page's "Scor zilnic" score fetched once on page load and
  never again -- so if it was opened before a battle's 15-minute reveal
  window closed (or before anyone had answered at all), it stayed frozen
  at 0-0 for as long as the tab stayed open, even long after the real
  result became available in the database. Traced end-to-end against a
  live production report: the trip hadn't started yet (`start_date` in
  the future, clamped to "Ziua 1" for pre-launch testing), the correct
  battle was being matched, individual `battle_scores` rows were
  recording correctly with real participant IDs -- the data was right
  the whole time, the page just never asked again. Now re-fetches every
  30 seconds and immediately when the tab regains focus.
- Fixed: `getTripHistory()` included a Battle in the Întrebări recap the
  moment *anyone at all* had a `battle_scores` row for it, regardless of
  whether this device's own participants had actually played -- so a
  family member's device could see another family member's Battle
  answers (and the correct options) revealed purely because someone else
  answered first, breaking the same spoiler-avoidance rule Discover
  questions already follow ("only what you've answered appears at all").
  Now gates Battle inclusion, and each individual Battle question within
  it, on this device's own participants having an individual `responses`
  row for that specific question -- exactly mirroring the Discover
  filter, and consistent whether the answer came from live play or a
  catch-up session.
- Fixed: the Întrebări page had the same fetch-once staleness bug just
  fixed on the Scor page -- it loaded its data once on mount and never
  again, so a Battle played (or any question answered) after the page's
  first load never appeared until a manual reload. Now re-fetches every
  30 seconds and immediately on tab focus, matching the Scor page.
- Active profile switcher on the Home page (product owner request): when
  a device has more than one profile (e.g. a parent's phone also holding
  a child's profile), a name pill in the top-right corner of Home shows
  which one is "active" and opens a picker to switch. Purely a per-device
  preference (stored in localStorage, same pattern as the device id
  itself) -- it doesn't yet change the "Cine răspunde?" step in Discover/
  Battle/Catchup, which still asks fresh each time; this only gives a
  device with several profiles a clear, persistent answer to "which one
  am I right now."
- Clasamentul familiei (product owner request): participants with the
  same score now share the same place and medal. Previously every row's
  rank was just its position in the sorted list, so two people tied on
  points still showed as e.g. 1st and 2nd.
- Follow-up correction to the above, from a production screenshot: a tie
  should only ever push the next distinct score down by one place
  (1, 1, 2), not skip a place per person tied above it (1, 1, 3 --
  "standard competition ranking", which is what shipped first). Switched
  to dense ranking to match.
- Public trip creation (product owner request, a real pivot from "private
  Kassandra pilot" toward "anyone can create their own ROAM trip"): the
  root `/` -- an untouched scaffold placeholder since the very first
  commit -- is now a public landing page with a form (destination, start
  date, 3-10 days). Submitting it POSTs to the new
  `app/api/trips/create` server route, which:
  1. Rejects a hidden honeypot field, then enforces a per-device 24h
     limit and a global daily cap across all devices (a circuit breaker
     on real cost, since every submission is a Claude API call) --
     `trips.created_by_device_id`/`created_at`, both indexed
     (`20260828100000_public_trip_creation.sql`). This is Phase 1 only:
     no real bot protection (CAPTCHA) and no payments yet, both
     explicitly deferred by the product owner to a later phase.
  2. Creates the `trips` row (`content_status: 'generating'`).
  3. Calls the Claude API (`src/lib/ai/generateTripContent.ts`) with a
     prompt describing ROAM's exact content shape, asking for a full
     Discover/Battle set for that destination -- "keeping the same logic
     and learning objective as Kassandra" (product owner's words): a
     morning + lunch Discover question per day (options, Common Core,
     One Thing, an Extra, explore links), a daily Battle (3 questions),
     and on the last day a Final Battle (5 questions) plus 3 prize-vote
     options, reusing the existing prize_options/prize_votes flow rather
     than a static prize. The response is strictly validated (exact
     question/option counts, exactly one correct option each, etc.)
     before any of it is trusted.
  4. Inserts everything (`src/lib/ai/insertGeneratedContent.ts`) via a
     new service-role client (`src/lib/supabase/admin.ts`) -- content
     tables have never had an anon-writable policy, so this is the only
     way this route could write them anyway -- landing with the schema's
     own `verified = false, published = false` defaults, exactly as
     hidden pending human review as Kassandra's own seed content was.
     `content_status` becomes `'ready'` on success or `'failed'` if
     generation or insertion didn't work out; either way the trip itself
     still exists. The Home page shows a "still preparing"/"generation
     failed" state instead of an empty-looking dashboard while it isn't
     `'ready'`.
  Needs two new server-only env vars in Vercel: `SUPABASE_SERVICE_ROLE_KEY`
  (already documented, newly used) and `ANTHROPIC_API_KEY` (new, from
  console.anthropic.com) -- see `.env.example` and `README.md`.
- Fixed, found while walking through what the above actually costs to
  run: `app/api/trips/create` had no explicit function duration, so it
  fell back to Vercel's plan default -- 10s on Hobby -- which a
  multi-day trip's Claude call (routinely 20-40s+ for the JSON content
  alone, before the inserts) would blow past on nearly every request,
  wasting the API spend on a call that times out anyway before the trip
  ever reaches `content_status: 'ready'`. Set `maxDuration = 60` (the
  maximum Hobby allows); Pro allows more if longer trips still need it
  once this is live.
- Product owner decision, reversing the live-generation design above:
  content drafting for a publicly-created trip goes back to being a
  manual step, the same way Kassandra's content was written, instead of
  a live Claude API call at creation time. `app/api/trips/create` now
  only ever creates the bare `trips` row (`content_status: 'pending'`)
  and returns immediately -- no more in-request generation, insertion,
  `content_status: 'generating'`/`'failed'` transitions, or `maxDuration`
  need (removed along with it). Deleted `src/lib/ai/generateTripContent.ts`
  and `src/lib/ai/insertGeneratedContent.ts` entirely rather than leaving
  them unused; `ANTHROPIC_API_KEY` is no longer needed anywhere in this
  app (removed from `.env.example`/`README.md`). The per-device/global
  rate limits stay exactly as they were -- their job is now keeping a
  manual content-review queue from being spammed, not bounding a
  per-call API cost, but the same numbers still serve that purpose.
  Landing page and Home page copy adjusted to stop implying an imminent
  automatic result ("poate dura până la un minut" -> "Se creează
  călătoria...").
- Fixed, found from a production screenshot: `app/api/trips/create` had
  no top-level error handling, so any unhandled error (a missing
  `SUPABASE_SERVICE_ROLE_KEY`, the trip-creation migration not yet
  applied to production, ...) returned a generic non-JSON 500 page,
  which the client could only ever surface as the same "Nu am putut
  crea călătoria" fallback message regardless of the real cause --
  undiagnosable from a phone. Wrapped the whole handler so the real
  error is now logged server-side (visible in Vercel's function logs
  for this route) while the client still gets a safe generic message.
- "Călătoriile mele" (product owner request): a trip's creator can now
  find their history again from any device, not just the one used to
  create it. `/` now redirects to `/trips?link=<slug>` after creating a
  trip instead of straight into it. `/trips` asks for a phone number +
  PIN the first time on a device (skippable via a "Sari peste" link,
  right after creating a trip only); `app/api/account/route.ts`
  (service-role key) creates or verifies a `creator_accounts` row
  (PIN hashed with `node:crypto` scrypt, `src/lib/security/pin.ts` --
  no new dependency), links the just-created trip to that account only
  if the request's device id matches the trip's own
  `created_by_device_id` (so a stranger can't claim someone else's trip
  into their history by guessing its slug), and returns an account id
  the client trusts from then on (`localStorage`, same accepted-risk
  model as `device_id` itself -- deliberately not real auth, no OTP, no
  session token). Revisiting `/trips` with that id already stored skips
  straight to the list (`trips` is fully publicly readable, so no server
  route is needed for the read side). New migration
  `20260830090000_creator_accounts.sql`. `/` also links to `/trips`
  directly, for someone returning without having just created anything.
- Admin view on `/trips`: a `creator_accounts.is_admin` flag (new
  migration `20260830100000_admin_account.sql`, seeded for phone
  `0721345678` / PIN `1234`) makes that one account, once logged in
  through the same phone+PIN flow, see every trip and every pending
  request on the platform (`getAllTrips()` in `src/lib/trip.ts`) instead
  of only the trips linked to it. No new data exposure -- `trips` was
  already fully public -- this only changes which rows the client
  chooses to render for that account.
- Fixed: the seeded admin phone number was wrong. New migration
  `20260830110000_replace_admin_account.sql` demotes `0721345678` back
  to a normal account and promotes `0721234567` (PIN `1234`) as the sole
  admin instead.
- Trip switcher on Setări: whoever is logged into "Călătoriile mele" on a
  device now gets a dropdown at the top of `/trip/[slug]/settings`
  listing every trip available to them (their own trips, or every trip
  on the platform for the admin account) and jumps straight to another
  trip's Setări on selection — no need to go back through `/trips`.
  Hidden entirely for the common case (a participant who only ever
  joined by device id and never created a "Călătoriile mele" account),
  and for an account tied to just one trip.
- Tapping a not-yet-ready trip (`content_status` `pending`/`generating`/
  `failed`) from `/trips` now opens that trip's Setări instead of its
  Home page, showing the same "Pregătim {name}..." message as the Home
  page's existing pending state (`app/trip/[slug]/page.tsx`) but with
  the bottom nav still visible, so an admin or trip creator stays inside
  the app instead of hitting a dead end and having to go back. Settings'
  own load short-circuits on a non-`ready` trip before the "did this
  device join yet" check, since neither profiles nor prize status mean
  anything until content exists.
- A trip's creator is now auto-joined as its first participant. Right
  after creating a trip, `app/trips/page.tsx` first asks "Ai deja cont?":
  choosing "Nu" also asks for a name (mandatory, alongside phone+PIN, new
  migration `20260830120000_creator_account_display_name.sql` adding
  `creator_accounts.display_name`); choosing "Da" only asks for the
  existing phone+PIN and reuses the name already on file. Either way,
  once the account is set up or verified, the client immediately calls
  the same `getOrCreateAdultParticipant()` the onboarding wizard uses, so
  the creator shows up as a participant on their own trip without going
  through the wizard separately once its content is ready. "Da, am cont"
  with a phone/PIN that doesn't match now returns a real login error
  instead of silently creating a second, blank account (that branch's UI
  has no name field to fall back on) — the plain `/trips` login (not
  right after creating a trip) is unaffected either way.

### Known limitations
- No authentication — participation is anonymous/device-based (see
  `docs/DATABASE.md` "Security model").
- All 7 days of seed content are drafted/supplied but left
  `verified = false, published = false` pending a human review pass (see
  `seed.sql` header for the publish-flip SQL).
- No error-monitoring service (e.g. Sentry) wired up yet — runtime errors
  are visible via Vercel function/build logs and browser console only.
- Single Supabase project shared across preview and production, only
  scoped apart by `is_demo` on seed data (see `docs/ARCHITECTURE.md`
  "Environments").
- None of the Discover/Battle/Final/Feedback/Questions/Users flows have
  been round-tripped against live Supabase from this environment (sandboxed
  network blocks `supabase.co`) — verified via lint/typecheck/build,
  local dev-server smoke tests, and a standalone check of the time-window
  boundary logic only. Please exercise the real flows on a phone against
  your Supabase project before trusting them for the pilot.
- Public trip creation (`app/api/trips/create`) has no real bot
  protection (no CAPTCHA) and no payment mechanism yet — both explicitly
  deferred by the product owner to a later phase. Its only defenses
  against spam are a hidden honeypot field, a per-device 24h limit, and
  a global daily cap; a determined attacker with many device ids could
  still exhaust the daily cap. Content drafting for a new trip is a
  manual step (see the entry above) rather than a live API call, so
  there is no generation call left to verify end-to-end here.
- "Călătoriile mele" (`app/api/account`) has no rate limiting on login
  attempts, so a 4-digit PIN is brute-forceable against a known phone
  number given enough requests -- acceptable for now since the only
  thing at stake is a spot in someone's trip list (every trip is public
  regardless), not content access. Phone numbers are also never
  verified (no OTP) -- anyone can claim any number as long as they set
  the PIN first.
