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
