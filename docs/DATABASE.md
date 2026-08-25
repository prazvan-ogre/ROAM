# Database

Supabase Postgres. Schema is fully version-controlled in
`supabase/migrations/`; nothing is changed by hand in the dashboard.

## Simplification vs. the original entity list

The spec lists `discover_questions`, `battle_questions`, `answer_options`,
and `profiles` as separate entities. This schema merges some of them,
because for the MVP the extra tables would duplicate structure without
adding safety or clarity:

- **`questions`** replaces `discover_questions` + `battle_questions`. Both
  are "a prompt plus options, shown on a given day," differing only in a
  `kind` column (`'discover' | 'battle'`) and an optional `battle_id`.
  One table means one place to fetch/render/validate a question.
- **`answer_options`** is unchanged, but now references `questions.id`
  generically instead of two separate question tables.
- **`profiles` is folded into `participants`**, using `role`
  (`'adult' | 'child'`) plus `age` and `managed_by_participant_id` for
  children. Per spec section 4, an adult participant *is* its own adult
  profile; a child profile is just another `participants` row managed by
  one, sharing the adult's `device_id` (a child has no device of its own).

Everything else maps 1:1 to the spec's entity list.

## Tables

### Content (admin-managed, public-readable, not anon-writable)

| Table | Purpose |
|---|---|
| `trips` | One row per pilot trip (e.g. Kassandra 2026). `is_demo` flags seed/demo trips. `destination`/`location_info` back the Home dashboard's location blurb. |
| `battles` | A themed group of Battle questions for a given day; `is_final` marks the Final Battle. |
| `questions` | Discover or Battle questions (`kind` discriminates). `battle_id`/`slot` set only for their respective kind. Carries the full Discover content shape: `common_core`, `one_thing`, `correct_reveal_message`/`alternative_reveal_message`, `sources`, `verified`, `published`. |
| `answer_options` | Options for a question; `is_correct` marks the right one(s). |
| `extras` | Bonus content tied to one Discover question (`question_id`), typed (`extra_type`: know/think/connect/ask/explore) and scoped by `audience` (all/adult/child). Also carries `sources`/`verified`/`published`. |
| `explore_links` | External "rabbit hole" links, attached to a question and/or an extra. |

### Activity (participant-generated, anon-writable, mostly anon-readable)

| Table | Purpose |
|---|---|
| `participants` | One row per profile (adult *or* child) on a trip. Child rows set `managed_by_participant_id` + `age` and share the managing adult's `device_id`. |
| `extra_assignments` | Which Extra a participant was assigned, and its viewed/completed status. |
| `responses` | A participant's answer to a Discover or Battle question. |
| `battle_scores` | Per-question team result rows (`team`: adults/kids, `score`: 1 or 0), summed for the "PĂRINȚI 2 — COPII 1" tally. Publicly readable — see point 4 below. |
| `feedback` | The 6-question end-of-trip survey from spec section 20 (`learned_new`, `generated_conversations`, `searched_more`, `anticipated_next`, `would_use_again`, `comment`). |
| `analytics_events` | Product analytics events (see `src/lib/analytics.ts` for the event list). |

## Content integrity (spec section 13)

`questions` and `extras` are only served to participants when
**both** `verified = true` **and** `published = true` — enforced in RLS
(`select` policies check both flags), not just in application code, so a
direct API call can't see draft content either. Everything seeded is
deliberately left `verified = false`: only a human fact-check + approval
pass may flip that flag (see `supabase/seed.sql` for the exact `update`
statements to run once content is reviewed). An AI assistant authoring a
migration is not that pass.

## Security model (RLS)

There is **no Supabase Auth** — the app uses only the `anon` key, and the
`service_role` key never reaches the client (it's a CI/admin-only secret).
Row Level Security is the actual access boundary:

1. **Public-readable**: content tables, but only rows with
   `verified = true and published = true` (see "Content integrity" above).
   Anyone with the anon key can read every *published* question, extra,
   and battle — the app has no login, so content has to be fetched
   without one — but never draft/unreviewed content.
2. **Anon-writable, and anon-readable where the product needs state to
   survive a refresh**: `responses` and `extra_assignments` allow
   `select` (in addition to `insert`) so a device can reload and see its
   own prior answers/assigned Extra without losing progress (spec section
   29). `feedback` and `analytics_events` stay insert-only — nothing
   reads them back (the client tracks "already gave feedback" itself, in
   `localStorage`, rather than round-tripping a personal survey response).
3. **Protected**: `SUPABASE_SERVICE_ROLE_KEY` is required to write content
   or to run migrations. It lives only in Vercel's server-side env vars
   and GitHub Actions secrets, never in `NEXT_PUBLIC_*` vars.
4. **`battle_scores` is publicly readable, unlike the other activity
   tables** — deliberately. A row is a team's result on one question
   (`team`, `score`), never an individual's, so there's no participant to
   protect (spec section 17: "no individual scoring"); every device needs
   to show the running "PĂRINȚI 2 — COPII 1" tally without waiting on a
   fresh aggregate call. Two `SECURITY DEFINER` functions still exist for
   convenience: `battle_leaderboard(battle_id)` (one battle's totals) and
   `trip_battle_leaderboard(trip_id)` (the trip-wide tally).
   Note: because `responses`/`extra_assignments`/`participants` are
   select-able by anyone (point 2 and point 5), and `participants` is
   itself public, a device that already knows another participant's id
   could technically look up their answers or assigned Extra directly via
   the API — the UI never offers this, and it's the same accepted-risk
   tradeoff as point 5 below, not a new one.
5. **`participants` is the one deliberate exception**: it's both publicly
   readable (needed to show "who's playing" / names on a leaderboard) and
   publicly *updatable* (`using (true)`). Because there's no auth, RLS
   cannot verify a device "owns" a given row — `device_id` is a
   client-asserted string, not a credential. **Accepted risk**: this means
   any device could, in theory, edit another participant's display name.
   This is acceptable because the pilot is a private, invite-only trip
   with a small, trusted group, not a public/adversarial audience. If ROAM
   grows beyond that trust model, the fix is to add Supabase Auth
   (anonymous sign-in still avoids a login screen, but gives RLS a real
   `auth.uid()` to scope `using (device_id = auth.jwt() ->> 'device_id')`).

## Migrations

- `supabase/migrations/20260825090000_initial_schema.sql` — content tables + RLS.
- `supabase/migrations/20260825090100_activity_tables.sql` — activity tables + RLS + `battle_leaderboard()`.
- `supabase/migrations/20260825120000_profiles_and_content_model.sql` — child profiles (`age`, `managed_by_participant_id`), the full Discover/Extra content shape, verified+published gating, and `trip_battle_leaderboard()`.
- `supabase/migrations/20260825140000_feedback_form.sql` — the real 6-question feedback shape, and public read on `battle_scores`.
- `supabase/migrations/20260825150000_trip_dashboard_fields.sql` — `destination`/`location_info` on `trips`, for the Home dashboard.

Every schema change is a new migration file — never a manual edit in the
Supabase dashboard. Naming: `<timestamp>_<description>.sql`
(Supabase CLI's default via `supabase migration new <name>`).

Apply:

```bash
# local (also runs seed.sql)
supabase db reset

# hosted project (staging/production), after supabase link
supabase db push
```

## Seed data

`supabase/seed.sql` creates the **Kassandra 2026** trip (`ro`, 5 days)
with Day 1 written as real draft content in the ROAM voice (spec section
36.1) — not throwaway placeholder text — but left `verified = false`,
`published = false` per the content-integrity rule above. It's idempotent
(deletes and recreates the `kassandra-2026` trip by slug) — safe to
re-run locally. The file's header comment has the exact `update`
statements to run once Day 1 is fact-checked and approved.

**Do not re-run it against production** once real pilot activity
(participants/responses) exists for this trip — it deletes the trip.
Days 2–5 still need their content authored the same way before the pilot.
