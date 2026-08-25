# Deployment

## Environments

| Branch | Vercel target | Supabase target |
|---|---|---|
| `main` | Production | Production project |
| `develop` | Preview (stable URL) | Same project, demo data only |
| `feature/*`, `fix/*`, PRs | Ephemeral preview per PR | Same project |

Vercel auto-deploys every push; nothing to trigger manually once the repo
is linked to a Vercel project.

## Standard release process

**Golden rule: migrate the database before deploying the frontend that
depends on it.** Never let a deploy discover a missing column in
production. Order:

1. **Merge the approved DB migration** into `main` (it will already have
   been reviewed as a normal PR — see `supabase/migrations/`).
2. **Apply the migration to production**:
   ```bash
   supabase link --project-ref <production-ref>
   supabase db push
   ```
3. **Verify the migration** — open Supabase Studio (Table Editor / SQL
   editor) and confirm the new table/column exists as expected. For
   anything beyond a trivial additive change, run one manual query against
   it before moving on.
4. **Deploy the application** — merging to `main` triggers this
   automatically on Vercel; confirm the deployment finished (Vercel
   dashboard or the deployment check on the PR/commit).
5. **Smoke test** — load the production URL, hit `/api/health` (expect
   `{"status":"ok", "env":"production"}`), and click through the core flow
   once on a real phone.

### Should migrations run automatically on deploy?

Not for this MVP. Vercel deploys are triggered by a git push and have no
natural "wait for the DB migration to finish and verify it" step —
automating that safely means adding a CI job with production DB
credentials and a rollback plan for a failed migration, which is more
moving parts than a 5-day pilot needs. The explicit `supabase db push`
step above is a deliberate choice: one extra manual command, in exchange
for a human confirming the migration succeeded *before* the code that
depends on it goes live. Revisit this once ROAM has more than one
developer and pilots run continuously rather than for 5 days at a time.

## Rollback

### Frontend

Vercel keeps every deployment. To roll back:

1. Vercel dashboard → project → **Deployments**.
2. Find the last known-good production deployment.
3. **⋯ → Promote to Production** (instant, no rebuild, no git changes
   required).

Alternatively, `git revert` the offending commit on `main` and push — use
this when the rollback also needs to remove the commit from history/CI
going forward, not just stop serving it.

### Database

Supabase migrations are **not assumed to be automatically reversible**.
Two cases:

- **Additive changes** (new table, new nullable column, new function) —
  the safe default. Rolling back the frontend is enough; the unused
  column/table is harmless and can be cleaned up in a later migration.
  Prefer additive changes whenever a choice exists — this is why, e.g.,
  RLS policies were added as their own statements rather than folded into
  `create table`, and why nothing here uses destructive `alter`/`drop`.
- **Destructive/breaking changes** (dropped column, renamed table,
  changed constraint) — write and test a corresponding **down** migration
  *before* applying the forward one to production, or take a manual
  Supabase backup/snapshot first (Studio → Database → Backups) if no clean
  down migration is possible. Never assume `db push` can be undone by
  editing history — once applied to production, a migration is forward-only
  unless you've prepared its reverse.

## CI gate

Every PR runs `.github/workflows/ci.yml`: install → lint → typecheck →
build. A red check blocks merge by convention (enable GitHub's "require
status checks to pass" branch protection on `main` once you're in the repo
settings — this repo does not currently have branch protection configured
and that's a manual step, see the audit notes).

## Versioning

Semantic versioning, tagged at deployable milestones (not every commit):

```bash
git tag v0.1.0
git push origin v0.1.0
```

- `v0.1.0` — first pilot-ready build
- `v0.1.x` — pilot bug fixes
- `v0.2.0` — meaningful feature iteration

See `CHANGELOG.md` for what shipped in each tag.
