"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Check, X, History, ExternalLink } from "lucide-react";
import { getTripBySlug, currentTripDay, type Trip } from "@/lib/trip";
import { listProfilesForDevice, type Participant } from "@/lib/participant";
import {
  getCatchUpQuestions,
  submitResponse,
  getOrAssignExtra,
  type CatchUpQuestion,
  type AnswerOption,
  type Extra,
  type Response,
} from "@/lib/discover";
import { Btn, FlowHeader, Centered } from "@/components/ui";

type Step = "loading" | "error" | "not-joined" | "select-profile" | "empty" | "question" | "reveal" | "done";

const SLOT_LABEL: Record<string, string> = { morning: "Dimineață", lunch: "Prânz" };
const EXTRA_TYPE_LABEL: Record<string, string> = {
  know: "ȘTIAI CĂ",
  think: "GÂNDEȘTE-TE",
  connect: "CONEXIUNE",
  ask: "ÎNTREABĂ",
  explore: "EXPLOREAZĂ",
};

// Reachable any time from the Dashboard, unlike the wizard's own catch-up
// step which only ever runs once, right when a participant is first
// created (product owner follow-up: catch-up is a homepage thing, not a
// wizard step -- removed from OnboardingWizard entirely). Someone who
// joined on an earlier day (or just didn't get to answer everything back
// then) still needs a way back to those questions after the day rolls
// over -- this page is that way back, for any profile on the device, not
// only a brand-new one. Same rules as before: plain submitResponse
// (personal score only), never touches battle_scores, so it can't change
// an already-played Battle's result.
//
// Reveal and the assigned Extra/Explore links show together, automatically,
// the moment an answer is submitted -- no extra tap, no extra step
// (product owner: correctness alone isn't enough, and it shouldn't take an
// extra click to see the rest). Applies to both Discover and Battle
// questions now that Battle questions carry their own Extras too.
export default function CatchUpPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();

  const [step, setStep] = useState<Step>("loading");
  const [trip, setTrip] = useState<Trip | null>(null);
  const [profiles, setProfiles] = useState<Participant[]>([]);
  const [activeProfile, setActiveProfile] = useState<Participant | null>(null);
  const [questions, setQuestions] = useState<CatchUpQuestion[]>([]);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<AnswerOption | null>(null);
  const [response, setResponse] = useState<Response | null>(null);
  const [extra, setExtra] = useState<Extra | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const t = await getTripBySlug(slug);
        if (cancelled || !t) return;
        setTrip(t);

        const list = await listProfilesForDevice(t.id);
        if (cancelled) return;
        if (list.length === 0) {
          setStep("not-joined");
          return;
        }
        setProfiles(list);
        setStep("select-profile");
      } catch {
        if (!cancelled) setStep("error");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const handleSelectProfile = useCallback(async (profile: Participant, t: Trip) => {
    setActiveProfile(profile);
    const pending = await getCatchUpQuestions(t.id, currentTripDay(t), profile.id);
    setQuestions(pending);
    setIndex(0);
    setSelected(null);
    setResponse(null);
    setExtra(null);
    setStep(pending.length === 0 ? "empty" : "question");
  }, []);

  // Skip the picker when there's only one profile on this device, same as
  // the Discover/Battle flows.
  useEffect(() => {
    if (step === "select-profile" && profiles.length === 1 && trip) {
      handleSelectProfile(profiles[0], trip);
    }
  }, [step, profiles, trip, handleSelectProfile]);

  async function handleSubmit() {
    if (!activeProfile || !selected) return;
    const current = questions[index];
    const [r, assignedExtra] = await Promise.all([
      submitResponse(activeProfile.id, current.question.id, selected),
      getOrAssignExtra(activeProfile.id, activeProfile.role, current.question.id),
    ]);
    setResponse(r);
    setExtra(assignedExtra);
    setStep("reveal");
  }

  function handleAdvance() {
    const nextIndex = index + 1;
    setSelected(null);
    setResponse(null);
    setExtra(null);
    if (nextIndex >= questions.length) {
      setStep("done");
      return;
    }
    setIndex(nextIndex);
    setStep("question");
  }

  function goHome() {
    router.push(`/trip/${slug}`);
  }

  if (step === "loading") return <Centered>Se încarcă...</Centered>;
  if (step === "error") {
    return (
      <Centered>
        <p>Nu am putut încărca datele. Verifică-ți conexiunea.</p>
        <button onClick={() => window.location.reload()} className="mt-4 underline">
          Încearcă din nou
        </button>
      </Centered>
    );
  }
  if (step === "not-joined") {
    return (
      <Centered>
        <p>Trebuie să te alături călătoriei mai întâi.</p>
        <Link href={`/trip/${slug}`} className="mt-4 inline-block underline">
          Înapoi acasă
        </Link>
      </Centered>
    );
  }

  if (step === "select-profile") {
    if (profiles.length === 1) return <Centered>Se încarcă...</Centered>;
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col px-5 pb-12 pt-14">
        <FlowHeader label="De recuperat" icon={<History size={15} />} onClose={goHome} />
        <h1 className="mb-2 text-[26px] font-semibold tracking-tight text-foreground">Cine recuperează?</h1>
        <p className="mb-8 text-[15px] text-muted-foreground">Alege profilul tău.</p>
        <div className="flex flex-col gap-2">
          {profiles.map((p) => (
            <button
              key={p.id}
              onClick={() => trip && handleSelectProfile(p, trip)}
              className="flex items-center gap-4 rounded-2xl border border-border bg-card px-4 py-4 text-left shadow-[0_1px_4px_rgba(0,0,0,0.04)] transition-all active:scale-[0.99] hover:border-primary/40"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent">
                <span className="text-[15px] font-semibold text-primary">{p.display_name[0]}</span>
              </div>
              <div>
                <p className="text-[15px] font-medium text-foreground">{p.display_name}</p>
                <p className="text-[13px] text-muted-foreground">
                  {p.role === "adult" ? "Adult" : p.age ? `Copil · ${p.age} ani` : "Copil"}
                </p>
              </div>
            </button>
          ))}
        </div>
      </main>
    );
  }

  if (step === "empty") {
    return (
      <Centered>
        <p>Nimic de recuperat — {activeProfile?.display_name} a răspuns deja la tot.</p>
        <Link href={`/trip/${slug}`} className="mt-4 inline-block underline">
          Înapoi acasă
        </Link>
      </Centered>
    );
  }

  if (step === "done") {
    return (
      <Centered>
        <p>Ai recuperat tot! 🎉</p>
        <Link href={`/trip/${slug}`} className="mt-4 inline-block underline">
          Înapoi acasă
        </Link>
      </Centered>
    );
  }

  const current = questions[index];
  if (!current) return <Centered>Se încarcă...</Centered>;
  const progressLabel = `Ziua ${current.question.day_number} · ${
    SLOT_LABEL[current.question.slot ?? ""] ?? "Battle"
  } · ${index + 1}/${questions.length}`;

  if (step === "question") {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col px-5 pb-12 pt-14">
        <FlowHeader label="De recuperat" icon={<History size={15} />} onClose={goHome} />
        <div className="flex flex-1 flex-col gap-5">
          <p className="text-[13px] font-semibold uppercase tracking-wide text-primary">{progressLabel}</p>
          <h1 className="text-[22px] font-semibold leading-snug tracking-tight text-foreground">
            {current.question.prompt}
          </h1>
          <div className="flex flex-col gap-2">
            {current.options.map((opt) => (
              <button
                key={opt.id}
                onClick={() => setSelected(opt)}
                className={`w-full rounded-2xl border px-4 py-4 text-left text-[15px] transition-all duration-150 active:scale-[0.99] ${
                  selected?.id === opt.id
                    ? "border-primary bg-accent text-foreground"
                    : "border-border bg-card text-foreground hover:border-disabled"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="mt-auto pt-4">
            <Btn onClick={handleSubmit} disabled={!selected}>
              RĂSPUNDE
            </Btn>
          </div>
        </div>
      </main>
    );
  }

  // step === "reveal" -- reveal, Extra, Explore links and the "ask
  // others" line all show together, immediately, no extra tap.
  const isCorrect = !!response?.is_correct;
  const message = isCorrect ? current.question.correct_reveal_message : current.question.alternative_reveal_message;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col px-5 pb-12 pt-14">
      <FlowHeader label="De recuperat" icon={<History size={15} />} onClose={goHome} />
      <div className="flex flex-1 flex-col gap-5">
        <div>
          <p className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-primary">{progressLabel}</p>
          <div
            className={`mb-5 flex h-10 w-10 items-center justify-center rounded-full ${isCorrect ? "bg-accent" : "bg-secondary"}`}
          >
            {isCorrect ? <Check size={18} className="text-primary" /> : <X size={18} className="text-muted-foreground" />}
          </div>
          <p className="text-[22px] font-semibold leading-snug tracking-tight text-foreground">
            {message ?? (isCorrect ? "Corect" : "Nu chiar 🙂")}
          </p>
        </div>

        {current.question.common_core && (
          <p className="text-[15px] leading-relaxed text-secondary-foreground">{current.question.common_core}</p>
        )}

        {current.question.one_thing && (
          <div className="border-l-2 border-primary py-1 pl-4">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-primary">The One Thing</p>
            <p className="text-[15px] font-medium leading-snug text-foreground">{current.question.one_thing}</p>
          </div>
        )}

        {extra && (
          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-primary">
              {extra.extra_type ? EXTRA_TYPE_LABEL[extra.extra_type] : "EXTRA"}
            </span>
            <p className="text-[15px] leading-relaxed text-foreground">{extra.description ?? extra.title}</p>
          </div>
        )}

        {current.exploreLinks.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-[12px] font-medium text-disabled">🐇 Vrei să afli mai mult?</p>
            {current.exploreLinks.map((link) => (
              <a
                key={link.id}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-[14px] text-primary hover:underline"
              >
                <ExternalLink size={13} />
                {link.title}
              </a>
            ))}
          </div>
        )}

        {extra && (
          <p className="text-[13px] leading-relaxed text-disabled">
            Ceilalți au descoperit ceva puțin diferit.
            <br />
            Întreabă-i ce au primit. 👋
          </p>
        )}

        <div className="mt-auto pt-4">
          <Btn onClick={handleAdvance}>
            {index + 1 >= questions.length ? "GATA" : "URMĂTOAREA ÎNTREBARE"}
          </Btn>
        </div>
      </div>
    </main>
  );
}
