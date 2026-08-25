# ROAM

ROAM is a mobile-first PWA that runs an interactive trip companion for a
family trip: daily "Discover" quiz questions, personal "Extras", exploration
links, and a "Parents vs Kids" Battle — no login required.

This repo currently contains the **engineering foundation** for the MVP
(first pilot trip: Kassandra 2026). Product screens ship next; see
`app/page.tsx` for the current placeholder.

## Stack

- **Framework**: Next.js 14 (App Router) + TypeScript
- **Styling**: Tailwind CSS
- **Backend/DB**: Supabase (Postgres + RLS, no Supabase Auth — see
  [docs/DATABASE.md](docs/DATABASE.md) for the anonymous-participation model)
- **Hosting**: Vercel
- **CI**: GitHub Actions (lint, typecheck, build on every PR)

## Local setup

```bash
git clone <repo-url>
cd ROAM
npm install
cp .env.example .env.local
# fill in .env.local with your Supabase project credentials (see below)
npm run dev
```

App runs at http://localhost:3000. Health check: http://localhost:3000/api/health.

### Environment variables

See `.env.example` for the full list. Get Supabase values from
**Project Settings → API** in the Supabase dashboard.

| Variable | Where it's used | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | client | safe to expose |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client | safe to expose — RLS is the real boundary |
| `SUPABASE_SERVICE_ROLE_KEY` | CI / scripts only | **never** ship to the browser, never prefix `NEXT_PUBLIC_` |
| `NEXT_PUBLIC_APP_ENV` | client | `local` \| `preview` \| `production` |
| `NEXT_PUBLIC_ACTIVE_TRIP_SLUG` | client | which trip this deployment serves |

### Database setup

1. Install the [Supabase CLI](https://supabase.com/docs/guides/cli).
2. Either run Supabase locally (`supabase start`, needs Docker) or link a
   hosted project (`supabase link --project-ref <ref>`).
3. Apply migrations: `supabase db reset` (local) or
   `supabase db push` (hosted).
4. Load demo content: `psql "$DATABASE_URL" -f supabase/seed.sql` (or, for
   local, `supabase db reset` already runs `seed.sql` automatically).

Full detail: [docs/DATABASE.md](docs/DATABASE.md).

## Scripts

```bash
npm run dev        # local dev server
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit
npm run build        # production build
```

## Deploying

Push to `main` → production (Vercel). Pull requests and `develop` get
preview deployments automatically. Full release process, including the
required order for database migrations vs. app deploys:
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Where content lives

All trip content (questions, answer options, extras, explore links,
battles) lives in Supabase Postgres tables, editable via Supabase Studio
with no code changes required. Participant activity (who joined, answers,
scores, feedback, analytics events) lives in separate tables — see
[docs/DATABASE.md](docs/DATABASE.md) for the full schema and the
content-vs-activity split.

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system overview
- [docs/DATABASE.md](docs/DATABASE.md) — schema, RLS model, migrations
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — release process, rollback
- [CHANGELOG.md](CHANGELOG.md) — release notes
