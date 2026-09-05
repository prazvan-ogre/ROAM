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
  profile; a child profile is usually another `participants` row managed
  by one, sharing the adult's `device_id` (a child has no device of its
  own) — but `managed_by_participant_id` is optional (product owner
  decision, onboarding_wizard migration): the onboarding wizard lets a
  child be the first, unmanaged participant on their own device.

Everything else maps 1:1 to the spec's entity list.

## Tables

### Content (admin-managed, public-readable, not anon-writable)

| Table | Purpose |
|---|---|
| `trips` | One row per pilot trip (e.g. Kassandra 2026). `is_demo` flags seed/demo trips. `destination`/`location_info` back the Home dashboard's location blurb. `prize` is unused (superseded by `prize_options`/`prize_votes`, left in place rather than dropped). |
| `prize_options` / `prize_votes` | The 3 prize choices for a trip, and each participant's single vote (`unique(participant_id)`) for their favourite. The option with the most votes 12h after the first vote is the competition prize, computed on read (`getPrizeStatus`) — see Setări > Configurare and the onboarding wizard's prize step. |
| `battles` | A themed group of Battle questions for a given day; `is_final` marks the Final Battle. |
| `questions` | Discover or Battle questions (`kind` discriminates). `battle_id`/`slot` set only for their respective kind. Carries the full Discover content shape: `common_core`, `one_thing`, `correct_reveal_message`/`alternative_reveal_message`, `sources`, `verified`, `published`. |
| `answer_options` | Options for a question; `is_correct` marks the right one(s). |
| `extras` | Bonus content tied to one question (`question_id`) -- Discover or Battle alike, product owner request -- typed (`extra_type`: know/think/connect/ask/explore) and scoped by `audience` (all/adult/child). Also carries `sources`/`verified`/`published`. |
| `explore_links` | External "rabbit hole" links, attached to a question and/or an extra. |

### Activity (participant-generated, anon-writable, mostly anon-readable)

| Table | Purpose |
|---|---|
| `participants` | One row per profile (adult *or* child) on a trip. Child rows set `age` and usually `managed_by_participant_id`, sharing the managing adult's `device_id` — but a child can also be the sole, unmanaged participant on their own device (onboarding wizard). |
| `extra_assignments` | Which Extra a participant was assigned, and its viewed/completed status. |
| `responses` | A participant's answer to a Discover or Battle question. Written only through `record_answer()` (point 12 below) — never a direct `insert`, regardless of what the anon/authenticated key would otherwise be able to reach. |
| `battle_scores` | One row per participant's answer to a Battle question (`participant_id`, `team`, `score`, `response_id` — the `responses` row that earned it, nullable for pre-R3 rows), written atomically alongside that `responses` row by `record_answer()`. A team's score for a battle is the average of its members' points (`battle_team_score()`), feeding the "PĂRINȚI 2 — COPII 1" tally. Publicly readable — see point 4 below. |
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
migration is not that pass — including for a publicly-created trip
(`app/api/trips/create`, `docs/ARCHITECTURE.md` "Public trip creation"):
its content is drafted and inserted the same way Kassandra's was, an
additive migration relying on the same column defaults rather than an
explicit `verified: false`, so it's exactly as hidden pending review.

On top of that gate, `questions`/`answer_options`/`extras`/`explore_links`
reads are also scoped to the caller's own trip (`is_trip_member(trip_id)`)
— see "Security model" point 11 for why that wasn't always true, and what
it costs.

## Security model (RLS)

There is **no Supabase Auth** — the app uses only the `anon` key, and the
`service_role` key never reaches the client (it's a CI/admin-only secret).
Row Level Security is the actual access boundary:

1. **Public-readable, within your own trip**: content tables, but only
   rows with `verified = true and published = true` (see "Content
   integrity" above). Any trip member (or anyone at all, for `battles` —
   see point 11) can read every *published* question, extra, and battle
   on their own trip — the app has no login, so content has to be
   fetched without a password, but a real (anonymous) auth session still
   scopes it to that trip — never draft/unreviewed content, and never
   another trip's content. See point 11 for the `trip_id` scoping
   specifically.
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
   tables** — deliberately. Every participant now answers Battle
   questions individually (product owner spec), each one recorded as
   both a `responses` row (personal score) and a `battle_scores` row
   (team score); every device needs to show the running "PĂRINȚI 2 —
   COPII 1" tally without waiting on a fresh aggregate call. Two
   `SECURITY DEFINER` functions exist for this: `battle_team_score(battle_id)`
   (one battle's resolved team score — the average of its members'
   points, or the original raw sum for a battle played before this
   feature, see the migration) and `trip_battle_win_tally(trip_id)` (the
   season-long tally of evenings won). A team's evening result is
   deliberately excluded from `battle_scores` — and so from both
   functions — once it's more than 15 minutes past the first individual
   answer for that battle; a late answer still writes its own
   `responses` row (personal score) but never joins the team result
   (`recordBattleAnswer`/`getBattleWindowStatus` in `battle.ts`).
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
6. **Public trip creation is the first real move beyond that trust model**
   (product owner request: anyone can spin up their own trip from
   `app/page.tsx`, not just the private Kassandra pilot) — and it does
   *not* go through a new anon-writable policy on `trips`. The only
   write path is `app/api/trips/create`, a server route holding the
   service-role key; the anon key still cannot insert a trip, a question,
   or anything else content-related directly. That route is itself the
   attack surface now (reachable by anyone, scripted or not), so it
   enforces its own limits before doing anything: a hidden honeypot
   field, at most one new trip per device per 24h
   (`trips.created_by_device_id`), and a global daily cap across all
   devices as a circuit breaker (`trips.created_at`-based, both indexed)
   — keeping a spammer from flooding the manual content-review queue
   below, not (any longer) bounding a per-call API cost. `trips.
   content_status` (`pending` → `ready`, `generating`/`failed` reserved
   for a human to set by hand if useful) tracks whether that trip's
   Discover/Battle content has actually been drafted and published yet —
   see "Content integrity" above and `docs/ARCHITECTURE.md` "Public trip
   creation" for that manual step. The Home page
   (`app/trip/[slug]/page.tsx`) shows a "still being put together" state
   instead of an empty dashboard while it isn't `ready`. None of this is
   real bot/abuse protection (no CAPTCHA) or payment — both are
   explicitly deferred to a later phase, per the product owner.
7. **`creator_accounts` (phone number + PIN) exists so a trip's creator
   can find their history again from a different device** — deliberately
   not real authentication: no OTP, no session token/cookie. The table
   itself has zero RLS policies at all (not even public read), so a
   phone number or `pin_hash` is never reachable via the anon key —
   the only door in is `app/api/account/route.ts` (service-role key),
   which hashes/verifies the PIN server-side (`src/lib/security/pin.ts`,
   `node:crypto` scrypt, no new dependency) and hands back an opaque
   account id. From then on that id is trusted client-side exactly like
   `device_id` already is — stored in `localStorage`
   (`src/lib/creatorAccount.ts`), read back to filter `trips` (already
   publicly readable) by `created_by_account_id` on `/trips`. Linking a
   freshly-created trip to an account additionally checks that the
   request's `device_id` matches that trip's own
   `created_by_device_id`, so a stranger can't associate someone else's
   trip (found by guessing/sharing its slug) into their own history by
   just creating an account — a cheap, not airtight, check appropriate
   to how little is actually at stake (a spot in a trip list, not
   content access — every trip is public either way). Same accepted-risk
   posture as `participants`/`device_id`: fine while nothing sensitive
   rides on it, real auth (e.g. Supabase Auth's phone/OTP flow) is the
   upgrade path if that changes.
8. **`creator_accounts.is_admin` gives one account an unfiltered view of
   `/trips`** — same login (phone + PIN) and the same client-trusted flag
   model as point 7, just one boolean further: `app/api/account/route.ts`
   returns `isAdmin` alongside the account id, `src/lib/creatorAccount.ts`
   stores it in `localStorage`, and `app/trips/page.tsx` calls
   `getAllTrips()` instead of filtering by `created_by_account_id` when
   it's set — so that one account sees every trip (and every pending
   request) on the platform, not just its own. Still no new access to
   anything not already public: `trips` was already fully readable by
   anon, this only changes which rows the *client* chooses to render.
9. **`creator_accounts.display_name` lets trip creation auto-join the
   creator as a participant** — right after creating a trip,
   `app/trips/page.tsx` now asks "Ai deja cont?" before the phone+PIN
   form: choosing "Nu" additionally requires a name (enforced in
   `app/api/account/route.ts`, only when creating a brand-new account as
   part of linking a freshly-created trip — the plain `/trips` login
   untouched, never requires one); choosing "Da" reuses the name already
   on file. Either way, once the account call returns a `displayName`,
   the client calls the existing `getOrCreateAdultParticipant(tripId,
   displayName)` (`src/lib/participant.ts`) to create that device's
   adult profile on the new trip immediately — the same call the
   onboarding wizard makes, just skipped ahead of time so the creator
   doesn't join with the same name a second time later. Best-effort: a
   failure here doesn't block getting into "Călătoriile mele", it just
   means they'll go through the onboarding wizard normally once the
   trip's content is ready.
10. **Editing the linked adult's profile in Setări > Utilizatori can also
    edit that device's account** (phone number and/or PIN) — new `GET`/
    `PATCH` handlers on `app/api/account/route.ts`, same client-trusted
    accountId model as everywhere else here (no current-PIN re-entry
    required). `GET` never returns `pin_hash` — it's a one-way scrypt
    hash (`src/lib/security/pin.ts`), so the PIN field in that form is
    always a blank "set a new one" input, never a display of the current
    value, no matter how it's toggled visible. Only shown when editing
    the participant whose `role` is `adult` and this device has an
    account at all (`getStoredAccountId()`); a phone number collision
    with another account surfaces the same unique-constraint error as
    account creation does.
11. **Content tables (`questions`, `answer_options`, `extras`,
    `explore_links`) are `trip_id`-scoped in RLS**
    (`20260906130000_content_trip_isolation.sql`) — `select` requires
    `is_trip_member(trip_id)` (point 6 of the R1 migration,
    `20260906090000_auth_ownership.sql`) on top of the
    `verified and published` gate (point 1 above, "Content integrity").
    This closed a real gap: those policies originally checked only
    `verified`/`published`, so any trip's published content was readable
    by anyone with the anon key, including a *different* trip's
    participants. That was never a problem while ROAM was one private
    pilot (Kassandra 2026) — content was never meant to be secret between
    families on the *same* trip, so there was no "other trip" to isolate
    from. `app/api/trips/create` (`docs/ARCHITECTURE.md` "Public trip
    creation") changed the shape of the question, since it lets strangers
    spin up unrelated trips on the same project — flagged in the
    2026-09-05 architecture/security review's batch 2.
    Initially deferred rather than fixed outright: Kassandra's pilot was
    still live, and `is_trip_member(trip_id)` only recognizes
    participants with a non-null `auth_user_id` — `getOrCreateAdultParticipant`
    (`src/lib/participant.ts`) deliberately never backfills `auth_user_id`
    onto a returning legacy (pre-R1) participant, only a brand-new insert
    gets one — so gating content on it risked locking out Kassandra's own
    legacy participants mid-trip the moment it picked up even one
    newly-authenticated member. Verified safe against every current
    content-reading call site first (`src/lib/discover.ts`, `battle.ts`,
    `history.ts`, every `app/trip/[slug]/**/page.tsx`): each one only
    fetches content once a participant already exists
    (`profiles.length > 0`), which by construction already has an
    `auth_user_id` — there is no live "read content before joining" flow
    this could break. Shipped once the pilot ended.
    **Known, accepted gap, same posture as R1 itself**: a trip with only
    legacy (`auth_user_id is null`) participants — Kassandra included, for
    anyone who joined before the R1 deploy and never re-joined afterward —
    has no member who passes `is_trip_member`, so nobody, including its
    own former participants, can read that trip's content via the anon
    key anymore (e.g. a post-trip recap page). Backfilling `auth_user_id`
    onto existing legacy rows would fix that, but it's a separate, bigger
    identity decision (flagged, not made, in R1's own header) — matching
    on `device_id`, a client-asserted string, to retroactively claim an
    old row is exactly the mistake R1 was written to avoid, so it needs
    its own review, not a piggyback on this migration.
    **Not covered**: `battles` (title/day_number/is_final) stays
    `using (true)` — lower sensitivity (no question/answer content), out
    of this batch's reported scope, left for a follow-up if wanted.
12. **`record_answer()` (`20260906140000_record_answer_authoritative.sql`,
    R3) is the only way to write `responses`/`battle_scores` at all** —
    both tables lost their anon/authenticated `insert` policy entirely in
    the same migration, so a direct `insert` (bypassing the RPC) is
    rejected by RLS regardless of the caller's own identity. Before this,
    `submitResponse()`/`record_battle_answer()` took `is_correct`/
    `score`/`team` as plain parameters and wrote them verbatim — RLS only
    ever checked that the caller owned the `participant_id`, never that
    the question/option belonged to the same trip, that the option
    belonged to the question, that the question was published, or that
    the claimed correctness/score/team matched reality. `record_answer`
    takes only `participant_id`/`question_id`/`selected_option_id` and
    derives everything else (correctness from `answer_options.is_correct`,
    score from `questions.points`, team from the participant's own
    `role`, and whether a Battle-kind answer contributes to the team's
    15-minute result window) from the rows themselves — there is no
    parameter for any of those to carry a forged value in. Idempotent on
    `responses`' existing `unique (question_id, participant_id)` (no
    separate token): a retry after a lost confirmation, or two genuinely
    concurrent submissions, both resolve through the same
    `unique_violation` handler, returning the original response
    (`status: 'already_recorded'`) without re-evaluating team eligibility
    at retry time; a retry with a *different* option returns
    `status: 'conflict'` and leaves the original untouched.
    `battle_scores.response_id` (nullable, unique) ties a team
    contribution 1:1 to the response that earned it — nullable because a
    pre-R3 `battle_scores` row only ever stored `battle_id`, not
    `question_id`, so for a battle with more than one question there is
    no way to backfill which `responses` row it came from without
    guessing; those rows keep `response_id = null` permanently, which a
    plain (non-partial) unique constraint already tolerates.
    **Also closed in this migration: the answer-key exposure**
    (`answer_options.is_correct` was `select *` public before a
    participant had even answered) — column-level `revoke`, not a view
    and not just trimming the client's own `.select()` list, so a raw
    REST call asking for that column directly is rejected by Postgres
    itself. The only way to learn which option was correct is
    `record_answer`'s own return value (immediately after answering) or
    the new `get_answered_correct_options()` (a batch reveal for the
    post-trip recap page), both of which only ever reveal it for a
    question the caller already has a response on record for.
    **Team-window edge case, product-owner-confirmed**: a Battle answer
    can still only ever *join* an already-open 15-minute window exactly
    as before (unchanged duration/rule) — but *opening* a fresh window
    (nobody has answered this battle individually yet) additionally
    requires this to be happening on the battle's own scheduled trip day
    (or, for the Final Battle, on/after the trip's last day), computed
    from `trips.start_date` (a `date` column — calendar-date arithmetic
    in UTC, not a time-of-day/timezone computation, since
    `src/lib/schedule.ts`'s hour-level windows are deliberately
    device-local with no stored timezone and can't be replicated
    server-side with the same precision). A battle nobody played live,
    recovered days later through Catchup (or any other late answer, live
    Battle path included — there is no separate "Catchup mode" anymore,
    just `record_answer` deriving the same eligibility from the same
    data regardless of which page called it), still scores personally
    but can never become the team's first — or any — contribution for
    that battle.
    **Final Battle points, re-confirmed 2026-09-05**: `questions.points`
    stays `10` for Final Battle questions (product-owner decision) — the
    client's own `BATTLE_POINTS.final = 5` constant (never applied to the
    seeded data, which was always `10`) is removed rather than
    reconciled toward it; `record_answer` reads `questions.points` as the
    only source of truth for both the individual leaderboard and the
    team score going forward, closing that divergence without touching
    any already-seeded `points` value.

## Migrations

- `supabase/migrations/20260825090000_initial_schema.sql` — content tables + RLS.
- `supabase/migrations/20260825090100_activity_tables.sql` — activity tables + RLS + a per-battle raw point sum RPC (dropped, see the last entry below).
- `supabase/migrations/20260825120000_profiles_and_content_model.sql` — child profiles (`age`, `managed_by_participant_id`), the full Discover/Extra content shape, verified+published gating, and a trip-wide raw point sum RPC (dropped, see the last entry below).
- `supabase/migrations/20260825140000_feedback_form.sql` — the real 6-question feedback shape, and public read on `battle_scores`.
- `supabase/migrations/20260825150000_trip_dashboard_fields.sql` — `destination`/`location_info` on `trips`, for the Home dashboard.
- `supabase/migrations/20260826090000_settings_and_scoring.sql` — `prize` on `trips` (Setări > Configurare); a `delete` policy on `participants` (Setări > Utilizatori edit/delete, same accepted-risk model as point 5 above); `trip_battle_win_tally()`, the per-evening win-tally behind the "PĂRINȚI vs COPII" score on the Scor page.
- `supabase/migrations/20260826110000_onboarding_wizard.sql` — drops `child_needs_manager`: the onboarding wizard lets a child be the first, unmanaged participant on their own device.
- `supabase/migrations/20260826130000_prize_vote.sql` — `prize_options`/`prize_votes` (the wizard's prize step is a vote, not a static value).
- `supabase/migrations/20260826153000_individual_battle_scoring.sql` — every participant answers Battle questions individually now (not one submission per team via a shared "controller" device); `battle_team_score()` (a battle's resolved team score — average of its members' points, or the original raw sum for a battle played before this feature) replaces the two raw-sum RPCs above (dropped); `trip_battle_win_tally()` updated to the same hybrid average/sum logic.
- `supabase/migrations/20260826190000_battle_extras_content.sql` — data-only, not a schema change: one AI-drafted `extras` row per Battle/Final Battle question (28 total), the additive equivalent of the Battle Extras added to `seed.sql` the same day — `seed.sql` itself is never safe to re-run against a project with real pilot activity (see "Seed data" below), so this is how that content actually reaches a live project. Idempotent (`where not exists` per question) and touches only `extras` — never `trips`/`participants`/`responses`/`battle_scores`. Left `verified = false`, `published = false` like all seeded content; the migration's own header has the exact `update` statement to run once reviewed.
- `supabase/migrations/20260827190000_fix_battle_team_score_average.sql` — bug fix for `battle_team_score()`/`trip_battle_win_tally()` from the individual-scoring migration above: the "average" branch used `avg(score)` (averaging over `battle_scores` rows — one per participant per question) instead of `sum(score) / count(distinct participant_id)` (averaging over participants, the actual spec). Understated the displayed score magnitude on the Întrebări recap page whenever a battle had more than one question; win/loss was only ever at risk once participation became uneven across a battle's questions. The legacy raw-sum branch (`participant_id is null`, pre-feature battles) is untouched. Both functions are `security definer`, computed live on every read — no stored values, so applying this migration retroactively corrects all past and future reads immediately.
- `supabase/migrations/20260827200000_fix_trip_tally_reveal_leak.sql` — second bug fix for `trip_battle_win_tally()`, found while verifying the daily score against production: it counted every battle with any `battle_scores` rows at all, with no check on whether that evening's own 15-minute reveal window (`getBattleWindowStatus()` in `src/lib/battle.ts`) had closed — so the cumulative "Scor total" tally already counted tonight's in-progress (possibly one-answer-old) outcome as a win, even though "Scor zilnic" on the same page correctly stays hidden for those 15 minutes. Fixed by excluding a has-individual-scoring battle from the tally until `now() >= first individual answer + 15 minutes`, exactly matching the app's own reveal rule; legacy (pre-individual-scoring) battles never had a reveal window and stay counted unconditionally.
- `supabase/migrations/20260828100000_public_trip_creation.sql` — `trips.created_by_device_id` and `trips.content_status` (`pending`/`generating`/`ready`/`failed`, default `ready` so existing trips are unaffected), plus indexes on `created_at` and `(created_by_device_id, created_at)`. Backs the public trip-creation flow (`app/page.tsx` → `app/api/trips/create`, see "Security model" point 6 above) — no new RLS policies, since that route writes through the service-role key like every other content write.
- `supabase/migrations/20260830090000_creator_accounts.sql` — the `creator_accounts` table (phone number + PIN hash, RLS enabled with zero policies — reachable only via the service-role key) and `trips.created_by_account_id`, so a trip's creator can see their history from any device (`app/trips/page.tsx` → `app/api/trips/create` and `app/api/account`, see "Security model" point 7 above).
- `supabase/migrations/20260830100000_admin_account.sql` — `creator_accounts.is_admin` (default `false`) and a seeded admin row (phone `0721345678`, PIN `1234`) with it set `true`, so that account sees every trip/request on `/trips` instead of only its own (see "Security model" point 8 above).
- `supabase/migrations/20260830110000_replace_admin_account.sql` — correction: the previous migration seeded the wrong admin phone number. Demotes `0721345678` back to `is_admin = false` and promotes `0721234567` (PIN `1234`) instead — exactly one admin account, same mechanism as above.
- `supabase/migrations/20260830120000_creator_account_display_name.sql` — `creator_accounts.display_name` (nullable), so a trip's creator can be auto-joined to it as a participant right when they set up or log into their account (see "Security model" point 9 above).
- `supabase/migrations/20260906130000_content_trip_isolation.sql` — `questions`/`answer_options`/`extras`/`explore_links` `select` policies now also require `is_trip_member(trip_id)`, closing the cross-trip content-readability gap raised in the 2026-09-05 architecture/security review's batch 2 (see "Security model" point 11 above for the full tradeoff, including the accepted gap for trips with only legacy/pre-R1 participants).
- `supabase/migrations/20260906140000_record_answer_authoritative.sql` — `record_answer()` replaces `submitResponse()`'s direct insert and `record_battle_answer()` as the single, authoritative write path for Discover/Battle/Final/Catchup answers; `responses`/`battle_scores` lose their anon/authenticated `insert` policy entirely; `battle_scores.response_id` (nullable) links a team contribution to the response that earned it; `answer_options.is_correct` is column-level `revoke`d from anon/authenticated. See "Security model" point 12 above for the full contract (idempotency, the team-window day guard, and why `battle_scores.response_id` can't be backfilled).

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

`supabase/seed.sql` creates the **Kassandra 2026** trip (`ro`, 7 days)
with all 7 days of Discover (Morning + Lunch) and Battle content, plus
the 10-question Final Battle on Day 7 — the questions, options, and
Discover Extras supplied directly by the product owner, not AI-drafted;
the Battle Extras (one per Battle/Final Battle question) are AI-drafted,
since the source doc didn't cover those — but everything is left
`verified = false`, `published = false` per the content-integrity rule
above, the AI-drafted Battle Extras included. It's idempotent (deletes
and recreates the `kassandra-2026` trip by slug) — safe to re-run
locally. The file's header comment has the exact `update` statements to
run once the content is reviewed and approved.

**Do not re-run it against production** once real pilot activity
(participants/responses) exists for this trip — it deletes the trip.
