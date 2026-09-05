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

### Activity (participant-generated, written under the caller's own verified identity, scoped to trip membership — see "Security model" below)

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

**This section describes the model as of batch 2 (2026-09-05
architecture/security review, R1 continued). It was not kept in sync
with batch 1 (R1's first pass) at the time — do not trust a "there is no
Supabase Auth" claim anywhere else in this repo's history; the
CHANGELOG's own R1 entries are the accurate record of what changed and
when.**

Every device — participant *and* creator account alike — now has a real,
provider-verified Supabase Auth session. `NEXT_PUBLIC_SUPABASE_ANON_KEY`
is still the only key the browser ever holds; `SUPABASE_SERVICE_ROLE_KEY`
never reaches the client. Row Level Security, scoped by `auth.uid()`
(not a client-asserted `device_id`/`accountId`/`isAdmin` flag), is the
actual access boundary.

### Identity model

```
identitate (Supabase Auth session)
  │
  ├─ anonymous session (src/lib/device.ts, signInAnonymously())
  │    one per device/browser, established before that device's first
  │    participant is created. No form, no email, no password — this is
  │    what keeps child/invitee participation registration-free.
  │    → participants.auth_user_id
  │         → participants row (one per profile: adult or child)
  │              → trip membership (participants.trip_id)
  │                   → responses / battle_scores / extra_assignments /
  │                     prize_votes / feedback / analytics_events rows,
  │                     all scoped to "this participant" or "this trip's
  │                     members"
  │
  └─ creator-account session (src/lib/security/session.ts)
       phone + PIN, verified against a real Supabase Auth user (password
       = the PIN) — a SEPARATE Supabase Auth identity from the device's
       own anonymous one above; the two coexist in the same browser
       because the creator-account session is never handed to the
       browser's own supabase-js client at all (see that file's header).
       → creator_accounts.auth_user_id
            → creator_accounts row (phone_number, is_admin, display_name)
                 → trips.created_by_account_id (which trips this
                   account can list/manage via app/api/account/trips)
                 → participants.account_id (this account's own adult
                   profile on a given trip, server-linked only — see
                   "Rights matrix" below)
```

### Rights matrix

| Data | Owner (creator account) | Participant, same trip | Participant, other trip | Child-profile manager | Admin | Anon / no session |
|---|---|---|---|---|---|---|
| Published content (`questions`/`extras`/`answer_options`/`explore_links`) | read | read | read | read | read | read |
| `trips_public` (name, destination, dates, status — no ownership columns) | read | read | read | read | read | read |
| `trips` base row (incl. `created_by_*`) | read/update own, via `/api/account/*` only | — | — | — | read/update all, via `/api/account/*` only | — |
| `creator_accounts` (own row: phone, PIN/password, display name) | read/update own, via `/api/account` only | — | — | — | read/update own, via `/api/account` only | — |
| `participants` profile fields (`display_name`/`role`/`age`) | edit any participant on trips it owns (Setări > Utilizatori) | edit own or any on the same trip (Setări > Utilizatori is trip-scoped, not account-scoped) | — | edit the children it manages | no special right beyond its own participation | — |
| `participants` identity fields (`trip_id`/`device_id`/`auth_user_id`/`managed_by_participant_id`/`account_id`) | immutable for every role except `service_role` (column-level `REVOKE`) | immutable | immutable | immutable | immutable | — |
| `responses` / `battle_scores` | — (not a creator-account concept) | read within trip; write only as self | — | write on behalf of a managed child (same `auth_user_id` as the device) | — | — |
| `extra_assignments` / `prize_votes` | — | read within trip (needed for load-balancing/tallying); write only as self | — | same as any participant | — | — |
| `feedback` / `analytics_events` | — | write only as self, within trip; never read back | — | same as any participant | — | — |
| `battle_team_score()` / `trip_battle_win_tally()` (aggregate RPCs) | — | callable for trips it's a member of | rejected (`42501`) | same as any participant | — | — |

"Same trip" access for a still-**legacy** participant (a row created
before the relevant migration, `auth_user_id is null`) keeps its old,
fully-open grandfathered behavior instead of the matrix above — see
"Legacy data" below; this is a deliberate, visible, temporary gap, not
what a newly-created row gets.

1. **Public-readable, within your own trip**: content tables, but only
   rows with `verified = true and published = true` (see "Content
   integrity" above). Any trip member can read every *published*
   question, extra, and battle on their own trip — the app has no login
   for this, so content has to be fetched without one, but a real
   (anonymous) auth session still scopes it to that trip — never
   draft/unreviewed content, and never another trip's content. See point
   11 below for the `trip_id` scoping specifically.
2. **`participants`/`responses`/`battle_scores`/`extra_assignments`/
   `prize_votes`/`feedback`/`analytics_events` are scoped to Supabase
   Auth identity and trip membership**, not `using (true)`. A device
   signs in anonymously (`supabase.auth.signInAnonymously()`,
   `src/lib/device.ts`) before creating its first participant;
   `participants.auth_user_id` records which session created a given
   row, and `is_trip_member(trip_id)`/`participant_is_self_or_legacy(id)`
   (`SECURITY DEFINER` helpers) are what every policy on these tables
   actually checks. Reads that need to see beyond "my own row" (the
   Extra load-balancer counting assignments across a trip, the prize-vote
   tally, `battle_team_score()`/`trip_battle_win_tally()`) are scoped to
   trip membership, never to every row in the table. `feedback`/
   `analytics_events` stay insert-only — nothing reads them back (the
   client tracks "already gave feedback" itself, in `localStorage`).
3. **`participants` identity columns are immutable for anon/authenticated
   after insert** — `trip_id`, `device_id`, `auth_user_id`,
   `managed_by_participant_id`, `account_id` can only ever be set once,
   at INSERT, under the inserting session's own verified identity
   (`auth_user_id = auth.uid()`, `account_id` must be null,
   `managed_by_participant_id` must point at a participant the same
   session already owns) — enforced with Postgres column-level `GRANT`s
   on `UPDATE`, not just another RLS clause, so a direct anon-key call
   can't reassign a row to a different trip, a different device, or a
   different "Călătoriile mele" account no matter what the row's own
   ownership check says. `display_name`/`role`/`age`/`last_seen_at`
   remain freely editable by whoever owns (or manages) the row.
4. **Protected**: `SUPABASE_SERVICE_ROLE_KEY` is required to write content,
   set `participants.account_id`, or run migrations. It lives only in
   Vercel's server-side env vars and GitHub Actions secrets, never in
   `NEXT_PUBLIC_*` vars.
5. **`battle_team_score(battle_id)`/`trip_battle_win_tally(trip_id)`**
   are the aggregate read path for the "PĂRINȚI 2 — COPII 1" tally
   (`SECURITY DEFINER`, since `battle_scores` itself has no
   whole-table-readable policy). Both now require the caller to actually
   be a member of that trip (or the trip is still fully legacy) —
   previously any anon-key caller could pass an arbitrary battle/trip id
   and read another family's result. The scoring formula itself
   (sum/average/win-tally) is unchanged; only the authorization wrapped
   around it is new. A team's evening result is deliberately excluded
   from `battle_scores` — and so from both functions — once it's more
   than 15 minutes past the first individual answer for that battle; a
   late answer still writes its own `responses` row (personal score) but
   never joins the team result (`recordBattleAnswer`/
   `getBattleWindowStatus` in `battle.ts`).
6. **Public trip creation** (product owner request: anyone can spin up
   their own trip from `app/page.tsx`) does *not* go through a new
   anon-writable policy on `trips`. The only write path is
   `app/api/trips/create`, a server route holding the service-role key.
   That route enforces its own limits before doing anything: a hidden
   honeypot field, at most one new trip per device per 24h
   (`trips.created_by_device_id` — a plain client-asserted string, reset
   by clearing localStorage), a global daily circuit breaker, **and** an
   IP-keyed daily cap (`ip_rate_limits`, `src/lib/security/ipRateLimit.ts`)
   that doesn't reset that way. `trips.content_status` (`pending` →
   `ready`) tracks whether that trip's Discover/Battle content has
   actually been drafted and published yet — see "Content integrity"
   above and `docs/ARCHITECTURE.md` "Public trip creation". None of this
   is real bot/abuse protection (no CAPTCHA) or payment — both are
   explicitly deferred to a later phase, per the product owner.
7. **"Călătoriile mele" (`creator_accounts`, phone + PIN) is now backed by
   a real Supabase Auth user per account** (`src/lib/security/session.ts`)
   — the PIN doubles as that user's password, verified by
   `signInWithPassword`/the Supabase Auth admin API, never by this app's
   own credential check (a pre-batch-2 account is lazily, one-time
   migrated onto this the next time its correct PIN is presented — see
   "Legacy data" below). Login issues a real access + refresh token pair,
   stored as httpOnly cookies (`roam_account_access`/
   `roam_account_refresh`) and verified server-side
   (`admin.auth.getUser(token)`) on every later request — not a
   client-supplied account id, and not a hand-rolled signed cookie. This
   is a *separate* Supabase Auth session from a device's own anonymous
   participant session; both coexist in the same browser because the
   creator-account session never touches the browser's own supabase-js
   client instance. `creator_accounts` itself keeps zero RLS policies for
   anon/authenticated (reachable only via the service-role key, from
   `app/api/account/*`, after that session check) — same as before.
8. **`creator_accounts.is_admin` is derived and checked entirely
   server-side** — `app/api/account/trips/route.ts` looks it up itself
   from the verified session; there is no client-set "is admin" flag
   anywhere, in `localStorage` or otherwise. Still no new access to
   anything not already public: `trips_public` was already fully
   readable by anon; this only changes which rows an *admin's own,
   verified* request can list unfiltered.
9. **`participants.account_id` (which "Călătoriile mele" account a
   participant belongs to) is set only by the server**, after verifying
   *both* the creator account's own session and the calling device's own
   anonymous session (its Supabase Auth access token, sent as an
   `Authorization: Bearer` header — see
   `src/lib/security/participantLink.ts`, called from
   `app/api/account/route.ts` and `app/api/account/link-trip/route.ts`).
   Previously the browser's own anon-key client set this directly from a
   value in a JSON response body — nothing stopped a direct Supabase call
   from claiming membership in an arbitrary account. It's now also
   column-locked at the database layer (see point 3).
10. **Editing the linked adult's profile in Setări > Utilizatori can also
    edit that device's account** (phone number and/or PIN) — `GET`/
    `PATCH` on `app/api/account/route.ts`, gated by the same verified
    session as everywhere else here (no current-PIN re-entry required).
    A phone-number change and a PIN change both go through the Supabase
    Auth admin API now (`updateUserById`) — it owns password hashing and
    phone uniqueness, not this app; `GET` never returns a PIN or password
    at all.
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

### Admin bootstrap and credential rotation

`creator_accounts.is_admin` was seeded by two already-applied migrations
(`20260830100000_admin_account.sql`, `20260830110000_replace_admin_account.sql`)
with a **fixed, hardcoded phone number and PIN, both committed to this
repository's git history and to this file**. That is a real, currently
live credential leak for whichever account still holds `is_admin = true`
— anyone with read access to this repo (or its history) can attempt that
exact phone+PIN pair, and now, after this batch, use it to obtain a real
Supabase Auth session for that account, not just the old client-trusted
flag. **Rotating it is an operational step this batch documents but does
not execute** (no live database access from this environment; see the PR
description):

1. Confirm which account currently holds `is_admin = true` (the intent
   was phone `0721234567`, per the migration above — verify against the
   live `creator_accounts` table, since a promote/demote pair like this
   can silently diverge from what's actually seeded if it's ever re-run
   against a different environment).
2. Set a new, unique PIN for that account **through the app's own login +
   PATCH flow** (or, if that account is not usable, directly via the
   Supabase Auth admin API — `admin.auth.admin.updateUserById(authUserId,
   { password: newPin })` — followed by clearing `creator_accounts.
   pin_hash` if still set) — never by editing `pin_hash` by hand; it's no
   longer consulted once `auth_user_id` is set.
3. Going forward, **do not add another migration that seeds a fixed
   admin phone/PIN** — this is exactly the pattern being retired. Promote
   a new admin by running a one-off, operator-executed `update
   creator_accounts set is_admin = true where phone_number = '<real,
   privately-known number>'` against the live project (Supabase SQL
   editor or `psql`), never a migration file committed to this repo. A
   migration is source code — permanently public to anyone with repo
   access — and is the wrong place for a credential or for naming which
   real person holds elevated access.

### Legacy data (pre-R1 participants, pre-batch-2 accounts)

Two categories of already-existing data predate the identity model this
batch describes, and neither is silently reclaimed or deleted:

- **Legacy participants** (`auth_user_id is null`, created before
  20260906090000_auth_ownership.sql): kept exactly as open (readable/
  writable by anyone) as they were before that migration — see that
  file's own header for the full grandfathering rationale, unchanged by
  this batch. **The only safe way to re-establish a specific legacy
  row's ownership is a server-verified credential the row's real owner
  already holds** — concretely, a trip's own creator logging into
  "Călătoriile mele" re-links their own adult participant row via
  `participants.account_id`/the participant-link flow (point 9 above),
  because that login is independently verified server-side (a real
  phone+PIN check, now backed by Supabase Auth). **There is deliberately
  no self-service "claim my old profile" for anyone else** (an invited
  family member, a child) — participants.id is exposed to other members
  of the same trip via ordinary API responses (needed to render a
  leaderboard/history), so accepting a bare participant id as proof of
  ownership would let one family member impersonate another. Since
  participation is meant to stay registration-free for exactly that
  group, there is no credential available to check instead. **This is
  the product decision still open**: either accept that a legacy,
  non-creator participant's row stays permanently open (until the trip
  itself ends), or introduce some new, lightweight verification for that
  case specifically (a per-device continuation token issued at first
  join and never exposed to other participants, say) — out of scope for
  this batch to decide unilaterally.
- **Legacy creator accounts** (`pin_hash` set, `auth_user_id` still null,
  created before this batch): lazily migrated onto a real Supabase Auth
  user the next time the correct PIN is presented at login
  (`app/api/account/route.ts`) — this is safe because it's gated by the
  same credential check (the PIN) the account already relied on, not by
  a bare id. No bulk backfill runs across existing rows; an account that
  never logs in again simply never migrates (harmless — it already
  wasn't reachable without its PIN).

### Rollout order and rollback

1. Apply this batch's migrations (`supabase db push`) — additive only,
   safe on a database with existing pilot data (no row is deleted, no
   existing `participants`/`creator_accounts` row is force-migrated).
2. **Before deploying the application code**, update the hosted Supabase
   project's Auth settings (dashboard or Management API, not a
   migration): enable the phone provider, and lower
   `minimum_password_length` to 4 (to match the existing 4-6 digit PIN
   policy) — every `signInWithPassword`/`admin.auth.admin.createUser`
   call in `app/api/account/route.ts` fails until this is done. This
   cannot be applied from this environment.
3. Deploy the application code. The very first login against each
   pre-existing creator account lazily migrates it (see "Legacy data"
   above) — no separate migration step needed for that.
4. Rotate the seeded admin account's PIN (see "Admin bootstrap" above)
   promptly after step 3 — every hour it stays on the known, committed
   PIN is a live credential exposure window on production.
5. **Rollback**: the migrations themselves are safe to leave applied
   even if the application code is rolled back to a pre-batch-2 version
   (the old code never reads `creator_accounts.auth_user_id`/
   `ip_rate_limits`, and the tightened RLS on
   `extra_assignments`/`prize_votes`/`feedback`/`analytics_events`/
   `participants` only removes access the old client-trusted model never
   needed in the first place — it does not remove any column or
   endpoint). Rolling back the *application* code alone, without a
   corresponding DB rollback, would however leave creator-account login
   broken (old code expects the removed `ACCOUNT_SESSION_SECRET`-signed
   cookie flow) — a same-version rollback of both together is the safe
   unit, not either alone.

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
- `supabase/migrations/20260906090000_auth_ownership.sql` through `20260906120000_atomic_record_battle_answer.sql` — R1 (2026-09-05 review) batch 1: `participants.auth_user_id`, real ownership RLS on `participants`/`responses`/`battle_scores`, the `trips_public` view, `account_login_attempts`, and `record_battle_answer()`. See the CHANGELOG's own R1 entries for the full account.
- `supabase/migrations/20260906130000_content_trip_isolation.sql` — `questions`/`answer_options`/`extras`/`explore_links` `select` policies now also require `is_trip_member(trip_id)`, closing the cross-trip content-readability gap raised in the 2026-09-05 architecture/security review's batch 2 (see "Security model" point 11 above for the full tradeoff, including the accepted gap for trips with only legacy/pre-R1 participants).
- `supabase/migrations/20260906140000_record_answer_authoritative.sql` — `record_answer()` replaces `submitResponse()`'s direct insert and `record_battle_answer()` as the single, authoritative write path for Discover/Battle/Final/Catchup answers; `responses`/`battle_scores` lose their anon/authenticated `insert` policy entirely; `battle_scores.response_id` (nullable) links a team contribution to the response that earned it; `answer_options.is_correct` is column-level `revoke`d from anon/authenticated. See "Security model" point 12 above for the full contract (idempotency, the team-window day guard, and why `battle_scores.response_id` can't be backfilled).
- `supabase/migrations/20260907090000_batch2_trip_activity_rls.sql` — R1 continued (batch 2): tightens `extra_assignments`/`prize_votes`/`feedback`/`analytics_events` RLS from `using (true)` to trip-membership/self-ownership, the four tables R1's first pass explicitly deferred. New `can_access_trip()` helper.
- `supabase/migrations/20260907091000_batch2_participant_lockdown.sql` — column-level `REVOKE`/`GRANT` on `participants` so `trip_id`/`device_id`/`auth_user_id`/`managed_by_participant_id`/`account_id` are immutable for anon/authenticated after insert; `account_id` must be null and `managed_by_participant_id` must point at the caller's own row at INSERT time.
- `supabase/migrations/20260907092000_batch2_battle_aggregate_authz.sql` — adds a trip-membership authorization check to `battle_team_score()`/`trip_battle_win_tally()` (previously callable with any battle/trip id by anyone); the scoring formula itself is unchanged.
- `supabase/migrations/20260907093000_batch2_creator_account_auth.sql` — `creator_accounts.auth_user_id` (nullable, `pin_hash` now nullable too) — see "Security model" point 7 above and `src/lib/security/session.ts`.
- `supabase/migrations/20260907094000_batch2_ip_rate_limits.sql` — `ip_rate_limits` (service-role only), backing an IP-keyed rate limit on new-trip and new-account creation alongside the existing per-device/per-phone checks.

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
