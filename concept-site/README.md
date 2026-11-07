# Worth — concept story site

A cinematic one-page presentation for **Worth**, a product concept that helps teams
decide what is worth building, track the real cost of AI initiatives, and measure
whether they deliver value.

Stack: **Next.js 14 (App Router) · React 18 · TypeScript · Tailwind CSS · Framer Motion**.
Self-contained — it does not share code or dependencies with the ROAM app in the repo root.

```bash
cd concept-site
npm install
npm run dev        # http://localhost:3100
npm run build && npm start
```

## The story (8 scenes)

| # | Scene | Visual |
|---|---|---|
| 1 | It’s easy to build anything today… | A prompt types itself, becomes a live app, an AI agent spins up, features burst around it |
| 2 | Every new idea competes for the same resources | A shared backlog that keeps re-ordering; duplicates flagged, work put on hold, capacity meters near 100% |
| 3 | The costs don’t stop at launch | Cost-of-ownership chart: build cost, then stacked running costs (tokens, cloud, subscriptions, support, maintenance) |
| 4 | More features don’t automatically mean more value | Analytics: shipped features ×4 vs. flat usage (“the value gap”) and an idle agent still costing money |
| 5 | A shared view of what we build and maintain | The platform reveal: integrations flow into a portfolio with purpose, owner, usage, cost, results; click a row to see the three questions |
| 6 | Before you build: check, compare, and choose | Idea → compare with existing tools → goal / budget / review date → reuse · experiment · build |
| 7 | After launch: check whether the investment is paying off | Live monitoring with the three alerts, then the team decides: expand · improve · combine · retire |
| 8 | Build what matters | A crowded portfolio collapses into four focused initiatives with goals and owners, then the CTA |

## Where to change things

- **All copy, the film script and the film link:** `lib/story.ts` (also product name, status label, contact email, booking link).
- **Design tokens** (one indigo accent, warm neutral canvas, ink scale, shadows, type scale): `tailwind.config.ts`.
- **Scenes:** `components/scenes/*`. Shared building blocks (window frame, pills, count-ups, sparklines, `VideoLoop`) in `components/ui/primitives.tsx`; the scene wrapper with scroll reveal, parallax drift and scene tracking in `components/ui/Scene.tsx`.
- **Video clips:** drop an MP4/WebM into `public/` and render `<VideoLoop src="/clip.mp4" />` inside any scene. It only plays while visible and respects reduced motion.

## Promotional film

The site is ready to launch a promotional film once it exists. Until then, nothing
film-related is shown.

When the film is ready, set `FILM.src` in `lib/story.ts`:

- a **YouTube or Vimeo link** (e.g. `https://youtu.be/…` or `https://vimeo.com/123456`), or
- a **video file** placed in `public/film/` (e.g. `"/film/worth.mp4"`), optionally with a `poster` image.

A “Watch the film” button then appears in the opening scene and plays the film
full-screen in a modal (Esc or click outside to close). Each scene’s `narration`
field in `lib/story.ts` is the voice-over script for the film.

## Accessibility & motion

- `prefers-reduced-motion` is honoured globally (`MotionConfig reducedMotion="user"`, CSS loops disabled).
- Every scene has a real heading; controls are labelled buttons; the film player is a dialog closable with Esc.
- Layouts are tested at 390px and 1440px wide without horizontal scroll.
