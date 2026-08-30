# Architecture

## Overview

```
Participant's phone (PWA, mobile browser)
        |
        v
Next.js app (Vercel)  — App Router, TypeScript, Tailwind
        |  anon key only, no server session/auth
        v
Supabase (Postgres + RLS)
   ├── content tables   (trips, battles, questions, answer_options,
   |                      extras, explore_links)      -- admin-managed,
   |                                                      public-readable
   └── activity tables  (participants, extra_assignments, responses,
                          battle_scores, feedback, analytics_events)
                                                        -- anon-writable,
                                                           insert-only
```

## Why this shape

- **No authentication.** The pilot is a private, invite-only 5-day trip
  shared over a link/QR code — a login flow would add friction for zero
  security benefit at this scale. See `docs/DATABASE.md` for how
  "anonymous but not anonymous-to-each-other" participation works instead.
- **Content vs. activity split.** Content (questions, extras, battles) is
  written once by the trip organizer via Supabase Studio and never touched
  by the app at runtime. Activity (who answered what) is written only by
  participant devices. Keeping these in separate tables means the RLS
  policy for each table is a single sentence: content is world-readable,
  activity is world-insertable-but-not-readable. See `docs/DATABASE.md`.
- **One backend for data and analytics.** `analytics_events` is a regular
  Supabase table, not a separate analytics product. For a 5-day pilot this
  is enough to answer "did people use this," and it avoids standing up and
  wiring a second vendor (PostHog, etc.) under a 72-hour deadline. It can
  be swapped later without touching call sites (`src/lib/analytics.ts` is
  the only place that knows where events go).
- **Vercel + Supabase, nothing else.** Both are zero-ops, both have
  generous free/hobby tiers, both integrate with GitHub natively (preview
  deployments, migrations via CLI). No containers, no custom infra to
  operate during a live pilot.

## Request flow (once product screens ship)

1. Participant opens the trip URL → `src/lib/device.ts` reads/creates a
   `device_id` in `localStorage`.
2. App calls Supabase (anon key) to upsert a `participants` row for that
   device + trip (join flow).
3. Content (questions, extras, battle prompts) is fetched read-only,
   scoped by `trip_id`/`NEXT_PUBLIC_ACTIVE_TRIP_SLUG`.
4. Participant actions (answers, extra views, feedback) are inserted into
   the relevant activity table and fire an `analytics_events` row via
   `trackEvent()`.
5. Aggregate results (e.g. the Battle leaderboard) are read through the
   `battle_leaderboard()` Postgres function rather than the raw
   `battle_scores` table, so no device can read another participant's row
   directly.

## Public trip creation

`app/page.tsx` is a public landing page, not a product screen scoped to
one trip: anyone can request a new trip for any destination. It never
talks to Supabase directly -- it POSTs to `app/api/trips/create`, a
server route that:

1. Rejects a hidden honeypot field, then enforces a per-device 24h limit
   and a global daily cap (`trips.created_by_device_id`/`created_at`) --
   the actual security boundary, since this route (unlike the rest of the
   app) is the one place the service-role key is used, so RLS alone
   doesn't gate it. See `docs/DATABASE.md` "Security model" point 6.
2. Inserts the `trips` row (`content_status: 'pending'`) and returns.

That's the entire route -- product owner decision: drafting a new trip's
Discover/Battle content is a deliberate manual step, not a live API call
at creation time. In practice that means asking an assistant (in a
session like this one) to draft the content for that destination, the
same way Kassandra's content was written, then landing it as an additive
migration (`docs/DATABASE.md` "Migrations") -- content lands with the
schema's own `verified = false, published = false` defaults, exactly as
hidden as Kassandra's seed content was before its own review pass
(`docs/DATABASE.md` "Content integrity") -- and flipping
`content_status` to `'ready'` as part of that same migration. Until
then, the trip's Home page shows a "still being put together" state
instead of an empty dashboard.

After a trip is created, `/` redirects to `/trips?link=<slug>` rather
than straight into the trip -- product owner request: someone who
creates a public trip should be able to find it again later, from any
device, not just the one they used to create it (`trips.
created_by_device_id` alone can't survive that). `/trips` ("Călătoriile
mele") asks for a phone number + PIN the first time on a given device;
`app/api/account/route.ts` (service-role key, same reasoning as trip
creation) either creates a `creator_accounts` row or verifies an
existing one's PIN, links the just-created trip to that account (only
if the request's `deviceId` matches the trip's own
`created_by_device_id` -- a cheap check against linking someone else's
trip by guessing its slug), and returns an account id that the client
trusts from then on (stored in localStorage, same model as `device_id`
itself). Revisiting `/trips` with that id already stored skips the
phone/PIN step and reads every trip tied to the account directly
(`trips` is fully publicly readable, so no server route is needed for
the read side). This is explicitly not real authentication -- no OTP,
no session token -- see `docs/DATABASE.md` "Security model" point 7 for
the accepted-risk reasoning. Skipping the phone/PIN step (a "Sari
peste" link, shown only right after creating a trip) is always
available; the trip still exists and still works, it just won't show up
in anyone's "Călătoriile mele" list later.

## Environments

| Environment | Frontend | Database |
|---|---|---|
| Local | `next dev` on your machine | local Supabase (`supabase start`) or a shared dev project |
| Preview | Vercel preview deploy per PR / `develop` | same Supabase project as production, `is_demo=true` seed data only (see docs/DATABASE.md) |
| Production | Vercel production deploy from `main` | Supabase production project |

A second, fully separate Supabase project for staging is the "more
correct" option but is extra setup (two sets of migrations to keep in
sync, two sets of secrets) that doesn't buy much for a 5-day pilot with a
single trip. The pragmatic alternative adopted here: one Supabase project,
demo/seed rows are flagged `is_demo = true` and excluded by convention, real
pilot data is never seeded, only entered live. If a true second project is
wanted later, duplicate the `supabase/migrations` folder against a new
project — no schema changes required.

## Mobile-first / PWA baseline

- `app/layout.tsx` sets a proper `viewport` (device-width, no user-scalable
  zoom fighting, `viewport-fit: cover` for notches).
- `app/manifest.ts` provides PWA metadata (installable, standalone display).
- Tailwind's default breakpoints are mobile-first (unprefixed utilities
  target the smallest screen).
- Vercel serves everything over HTTPS by default, including preview URLs.
