/**
 * The whole story lives here: one entry per scene.
 * Copy, the film script and the film link are edited in this file only.
 */

export const PRODUCT = {
  name: "Worth",
  tagline: "Build what matters.",
  status: "Concept in development",
  contactEmail: "razvano7@yahoo.com",
  bookingUrl: "mailto:razvano7@yahoo.com?subject=Let%E2%80%99s%20talk%20about%20Worth",
};

/**
 * The promotional film. Leave `src` empty until the film exists: every
 * "Watch the film" button stays hidden until then.
 *
 * `src` can be a YouTube or Vimeo link, or a video file (e.g. "/film/worth.mp4"
 * placed in public/film/). `poster` is an optional still shown before playback.
 */
export const FILM = {
  src: "",
  poster: "",
  duration: "2 min",
};

export type SceneId =
  | "opening"
  | "competition"
  | "costs"
  | "value"
  | "platform"
  | "before"
  | "after"
  | "closing";

export type Scene = {
  id: SceneId;
  /** Short label used in the chapter navigation. */
  label: string;
  eyebrow: string;
  headline: string;
  /** One-sentence on-screen line. */
  lede: string;
  /** Voice-over script for this scene of the promotional film. */
  narration: string;
};

export const SCENES: Scene[] = [
  {
    id: "opening",
    label: "The question",
    eyebrow: "A story in eight scenes",
    headline: "It’s easy to build anything today. But is everything worth building?",
    lede: "Ideas become apps, agents and features in an afternoon. Choosing which ones deserve to exist is the hard part now.",
    narration:
      "With AI, ideas can quickly become apps, agents, and features. We can experiment more and build faster. But how do we choose what deserves our time, attention, and budget?",
  },
  {
    id: "competition",
    label: "Competition",
    eyebrow: "Resource competition",
    headline: "Every new idea competes for the same resources.",
    lede: "Requests arrive faster than teams can finish them. Priorities shift, similar work gets started twice, and something always gets parked.",
    narration:
      "A new idea. A customer request. Another workflow we want to automate. We start building. But do we already have something similar? What problem are we solving? And what are we putting on hold to make room for it?",
  },
  {
    id: "costs",
    label: "Running costs",
    eyebrow: "Hidden and ongoing costs",
    headline: "The costs don’t stop at launch.",
    lede: "Building is a one-off. Running is forever: tokens, infrastructure, licences, and the people who keep it all working.",
    narration:
      "A new feature can be cheap to build and expensive to keep running. Agents consume tokens. Apps use infrastructure. People review, fix, and maintain them. Costs can grow without delivering more value.",
  },
  {
    id: "value",
    label: "Output vs. impact",
    eyebrow: "Output is not impact",
    headline: "More features don’t automatically mean more value.",
    lede: "Shipping goes up and to the right. Usage, time saved and fewer errors often don’t follow.",
    narration:
      "We’ve shipped. But has anything improved for our users? Are the new features being used? Have they attracted users, saved time, or reduced errors? And are the agents or features we launched months ago still worth keeping?",
  },
  {
    id: "platform",
    label: "The platform",
    eyebrow: "Introducing Worth",
    headline: "A shared view of what we build and maintain.",
    lede: "Every app, agent and feature in one place — with its purpose, owner, usage, cost and results, connected to the tools you already use.",
    narration:
      "We have built a platform that connects your team’s ideas and goals with the tools you already have, tracks their costs, and measures the results they deliver. For every investment, it keeps track of three questions: why did we build it, how much have we invested, and what have we gained?",
  },
  {
    id: "before",
    label: "Before you build",
    eyebrow: "Before you build",
    headline: "Before you build: check, compare, and choose.",
    lede: "New ideas are checked against what already exists, given an expected outcome, and routed to the cheapest path that can prove it.",
    narration:
      "The platform identifies similar tools, helps define the expected benefit, and supports prioritisation. Each initiative gets a goal, a budget, and a review date — so you can decide what to start and what can wait.",
  },
  {
    id: "after",
    label: "After launch",
    eyebrow: "After launch",
    headline: "After launch: check whether the investment is paying off.",
    lede: "Worth watches cost, usage and progress towards each goal — and raises a hand when the evidence changes.",
    narration:
      "The platform tracks development and running costs, usage, and progress towards each goal. It flags duplication, unused resources, and results that fall short of expectations. Your team reviews the evidence and decides what to expand, improve, combine, or retire.",
  },
  {
    id: "closing",
    label: "Build what matters",
    eyebrow: "Focus",
    headline: "Build what matters.",
    lede: "Fewer initiatives. Each one with a clear goal, a clear owner, and evidence that it’s worth it.",
    narration:
      "In a world where everyone can build anything, make sure you build only what matters.",
  },
];

export const sceneById = (id: SceneId) => SCENES.find((s) => s.id === id)!;
