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

### Known limitations
- No authentication — participation is anonymous/device-based (see
  `docs/DATABASE.md` "Security model").
- Day 1 seed content is a draft pending human fact-check/approval; Days
  2–5 and the Final Battle's 10-12 questions have no content yet.
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
