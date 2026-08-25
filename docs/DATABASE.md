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
- **`profiles` is folded into `participants.role`** (`'adult' | 'child'`).
  A "profile" in the spec is just the role a participant picked when
  joining — it doesn't need its own row/table.

Everything else maps 1:1 to the spec's entity list.

## Tables

### Content (admin-managed, public-readable, not anon-writable)

| Table | Purpose |
|---|---|
| `trips` | One row per pilot trip (e.g. Kassandra 2026). `is_demo` flags seed/demo trips. |
| `battles` | A themed group of Battle questions for a given day; `is_final` marks the Final Battle. |
| `questions` | Discover or Battle questions (`kind` discriminates). `battle_id` set only for `kind='battle'`. |
| `answer_options` | Options for a question; `is_correct` marks the right one(s). |
| `extras` | Per-day bonus content/tasks. |
| `explore_links` | External links (maps, articles) surfaced per trip/extra. |

### Activity (participant-generated, anon-writable, not anon-readable)

| Table | Purpose |
|---|---|
| `participants` | One row per device that joined a trip. `device_id` is client-generated (see below). |
| `extra_assignments` | Tracks which participant has seen/completed which Extra. |
| `responses` | A participant's answer to a Discover or Battle question. |
| `battle_scores` | Per-battle score rows, tagged by `team` (`adults`/`kids`) and/or participant. |
| `feedback` | End-of-trip rating/comment. |
| `analytics_events` | Product analytics events (see `src/lib/analytics.ts` for the event list). |

## Security model (RLS)

There is **no Supabase Auth** — the app uses only the `anon` key, and the
`service_role` key never reaches the client (it's a CI/admin-only secret).
Row Level Security is the actual access boundary:

1. **Public-readable**: all content tables, in full. Anyone with the anon
   key can read every question, extra, and battle. This is intentional —
   the app has no login, so content has to be fetched without one.
2. **Anon-writable**: activity tables accept `insert` from anyone (no
   `select`, `update`, or `delete`, except `participants` — see below).
   A device can record its own answers/feedback/events but can never read
   another device's raw rows back.
3. **Protected**: `SUPABASE_SERVICE_ROLE_KEY` is required to write content
   or to run migrations. It lives only in Vercel's server-side env vars
   and GitHub Actions secrets, never in `NEXT_PUBLIC_*` vars.
4. **Avoiding cross-participant exposure**: raw `battle_scores` rows are
   not selectable by anon, so no device can read another participant's
   score. Where an aggregate needs to be shown (e.g. "Kids: 40, Parents:
   35"), it's exposed through a `SECURITY DEFINER` function,
   `battle_leaderboard(battle_id)`, which returns team totals only — never
   individual rows.
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

`supabase/seed.sql` creates a demo **Kassandra 2026** trip (`ro`, 5 days)
with placeholder questions/extras/battle content, clearly prefixed
`[demo]` and flagged `is_demo = true`. It's idempotent (deletes and
recreates the `kassandra-2026` trip by slug) — safe to re-run locally.

**Do not run it against production** unless you intend to load/replace
demo content there. Real pilot content should be entered directly (via
Studio or a real content migration), not derived from the seed file.
