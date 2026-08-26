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
