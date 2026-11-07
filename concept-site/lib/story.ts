/**
 * The whole story lives here: one entry per scene.
 * Copy, narration and audio paths are edited in this file only.
 */

export const PRODUCT = {
  name: "Worth",
  tagline: "Build what matters.",
  status: "Concept in development",
  contactEmail: "razvano7@yahoo.com",
  bookingUrl: "mailto:razvano7@yahoo.com?subject=Let%E2%80%99s%20talk%20about%20Worth",
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
  /** One-sentence on-screen line. The full story is in the narration. */
  lede: string;
  narration: string;
  /** Optional pre-rendered voice-over. Falls back to on-device speech when absent. */
  audio: string;
};

export const SCENES: Scene[] = [
  {
    id: "opening",
    label: "The question",
    eyebrow: "A short film in eight scenes",
    headline: "It’s easy to build anything today. But is everything worth building?",
    lede: "Ideas become apps, agents and features in an afternoon. Choosing which ones deserve to exist is the hard part now.",
    narration:
      "With AI, ideas can quickly become apps, agents, and features. We can experiment more and build faster. But how do we choose what deserves our time, attention, and budget?",
    audio: "/audio/opening.mp3",
  },
  {
    id: "competition",
    label: "Competition",
    eyebrow: "Scene 02 — Resource competition",
    headline: "Every new idea competes for the same resources.",
    lede: "Requests arrive faster than teams can finish them. Priorities shift, similar work gets started twice, and something always gets parked.",
    narration:
      "A new idea. A customer request. Another workflow we want to automate. We start building. But do we already have something similar? What problem are we solving? And what are we putting on hold to make room for it?",
    audio: "/audio/competition.mp3",
  },
  {
    id: "costs",
    label: "Running costs",
    eyebrow: "Scene 03 — Hidden and ongoing costs",
    headline: "The costs don’t stop at launch.",
    lede: "Building is a one-off. Running is forever: tokens, infrastructure, licences, and the people who keep it all working.",
    narration:
      "A new feature can be cheap to build and expensive to keep running. Agents consume tokens. Apps use infrastructure. People review, fix, and maintain them. Costs can grow without delivering more value.",
    audio: "/audio/costs.mp3",
  },
  {
    id: "value",
    label: "Output vs. impact",
    eyebrow: "Scene 04 — Output is not impact",
    headline: "More features don’t automatically mean more value.",
    lede: "Shipping goes up and to the right. Usage, time saved and fewer errors often don’t follow.",
    narration:
      "We’ve shipped. But has anything improved for our users? Are the new features being used? Have they attracted users, saved time, or reduced errors? And are the agents or features we launched months ago still worth keeping?",
    audio: "/audio/value.mp3",
  },
  {
    id: "platform",
    label: "The platform",
    eyebrow: "Scene 05 — Introducing Worth",
    headline: "A shared view of what we build and maintain.",
    lede: "Every app, agent and feature in one place — with its purpose, owner, usage, cost and results, connected to the tools you already use.",
    narration:
      "We have built a platform that connects your team’s ideas and goals with the tools you already have, tracks their costs, and measures the results they deliver. For every investment, it keeps track of three questions: why did we build it, how much have we invested, and what have we gained?",
    audio: "/audio/platform.mp3",
  },
  {
    id: "before",
    label: "Before you build",
    eyebrow: "Scene 06 — Before you build",
    headline: "Before you build: check, compare, and choose.",
    lede: "New ideas are checked against what already exists, given an expected outcome, and routed to the cheapest path that can prove it.",
    narration:
      "The platform identifies similar tools, helps define the expected benefit, and supports prioritisation. Each initiative gets a goal, a budget, and a review date — so you can decide what to start and what can wait.",
    audio: "/audio/before.mp3",
  },
  {
    id: "after",
    label: "After launch",
    eyebrow: "Scene 07 — After launch",
    headline: "After launch: check whether the investment is paying off.",
    lede: "Worth watches cost, usage and progress towards each goal — and raises a hand when the evidence changes.",
    narration:
      "The platform tracks development and running costs, usage, and progress towards each goal. It flags duplication, unused resources, and results that fall short of expectations. Your team reviews the evidence and decides what to expand, improve, combine, or retire.",
    audio: "/audio/after.mp3",
  },
  {
    id: "closing",
    label: "Build what matters",
    eyebrow: "Scene 08 — Focus",
    headline: "Build what matters.",
    lede: "Fewer initiatives. Each one with a clear goal, a clear owner, and evidence that it’s worth it.",
    narration:
      "In a world where everyone can build anything, make sure you build only what matters.",
    audio: "/audio/closing.mp3",
  },
];

export const sceneById = (id: SceneId) => SCENES.find((s) => s.id === id)!;
