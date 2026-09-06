"use client";

import { useRef, useState } from "react";
import { submitFeedback } from "@/lib/feedback";
import { trackEvent } from "@/lib/analytics";
import { Btn } from "@/components/ui";

const SCALE = [1, 2, 3, 4, 5] as const;
const ANTICIPATED_OPTIONS = [
  { value: "da", label: "Da" },
  { value: "uneori", label: "Uneori" },
  { value: "nu", label: "Nu" },
] as const;
const USE_AGAIN_OPTIONS = [
  { value: "sigur", label: "Cu siguranță" },
  { value: "probabil", label: "Probabil" },
  { value: "probabil_nu", label: "Probabil nu" },
  { value: "nu", label: "Nu" },
] as const;

export function FeedbackForm({
  tripId,
  participantId,
  onSubmitted,
}: {
  tripId: string;
  participantId: string | null;
  onSubmitted: () => void;
}) {
  const [learnedNew, setLearnedNew] = useState<number | null>(null);
  const [conversations, setConversations] = useState<number | null>(null);
  const [searchedMore, setSearchedMore] = useState<boolean | null>(null);
  const [anticipatedNext, setAnticipatedNext] = useState<string | null>(null);
  const [wouldUseAgain, setWouldUseAgain] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // R4 correction (2026-09-06 batch, round 2): requestId is a real
  // idempotency key (client_request_id, src/lib/feedback.ts) -- generated
  // once per distinct submission attempt, kept stable across a retry of
  // THAT attempt, and reset whenever an answer actually changes (a
  // correction before resubmitting is a new attempt, not a retry of the
  // old one -- see the on-change handlers below).
  const requestIdRef = useRef<string | null>(null);

  function handleLearnedNew(v: number) {
    requestIdRef.current = null;
    setLearnedNew(v);
  }
  function handleConversations(v: number) {
    requestIdRef.current = null;
    setConversations(v);
  }
  function handleSearchedMore(v: boolean) {
    requestIdRef.current = null;
    setSearchedMore(v);
  }
  function handleAnticipatedNext(v: string) {
    requestIdRef.current = null;
    setAnticipatedNext(v);
  }
  function handleWouldUseAgain(v: string) {
    requestIdRef.current = null;
    setWouldUseAgain(v);
  }
  function handleCommentChange(v: string) {
    requestIdRef.current = null;
    setComment(v);
  }

  const canSubmit =
    learnedNew !== null &&
    conversations !== null &&
    searchedMore !== null &&
    anticipatedNext !== null &&
    wouldUseAgain !== null;

  // R4 (2026-09-06 batch; corrected round 2): submitFeedback is
  // idempotent on requestId (src/lib/feedback.ts) -- a retry after a
  // lost confirmation safely recognizes THIS attempt's own earlier
  // insert instead of erroring or creating a duplicate. onSubmitted()
  // (which marks this trip's feedback as given, app/trip/[slug]/final/
  // page.tsx) only ever runs after the save itself is confirmed -- never
  // before, and never delayed by analytics (trackEvent is fire-and-
  // forget: it never throws, but a slow/unavailable endpoint must not
  // hold up the confirmation for a submission that already succeeded).
  async function handleSubmit() {
    if (!canSubmit || submitting) return;
    if (!requestIdRef.current) requestIdRef.current = crypto.randomUUID();
    setSubmitting(true);
    setError(null);
    try {
      await submitFeedback(
        {
          trip_id: tripId,
          participant_id: participantId,
          learned_new: learnedNew,
          generated_conversations: conversations,
          searched_more: searchedMore,
          anticipated_next: anticipatedNext as "da" | "uneori" | "nu",
          would_use_again: wouldUseAgain as "sigur" | "probabil" | "probabil_nu" | "nu",
          comment: comment.trim() || null,
        },
        requestIdRef.current,
      );
      requestIdRef.current = null;
      void trackEvent(tripId, "feedback_submitted", participantId ?? undefined);
      onSubmitted();
    } catch (err) {
      console.error("submitFeedback failed", err);
      setError("Nu am putut trimite răspunsurile. Verifică-ți conexiunea și încearcă din nou.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-8 px-5 pb-12 pt-14">
      <h1 className="text-[26px] font-semibold tracking-tight text-foreground">Câteva întrebări rapide</h1>

      <ScaleQuestion
        label="Ai aflat lucruri pe care nu le știai?"
        value={learnedNew}
        onChange={handleLearnedNew}
        lowLabel="Deloc"
        highLabel="Foarte multe"
      />
      <ScaleQuestion
        label="Întrebările ROAM au generat conversații cu ceilalți?"
        value={conversations}
        onChange={handleConversations}
        lowLabel="Deloc"
        highLabel="Foarte multe"
      />

      <ChoiceQuestion
        label="Ai căutat singur informații după una dintre întrebări?"
        options={[
          { value: "true", label: "Da" },
          { value: "false", label: "Nu" },
        ]}
        value={searchedMore === null ? null : String(searchedMore)}
        onChange={(v) => handleSearchedMore(v === "true")}
      />

      <ChoiceQuestion
        label="Ai așteptat cu interes următoarea întrebare?"
        options={ANTICIPATED_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        value={anticipatedNext}
        onChange={handleAnticipatedNext}
      />

      <ChoiceQuestion
        label="Ai folosi ROAM în următoarea vacanță?"
        options={USE_AGAIN_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        value={wouldUseAgain}
        onChange={handleWouldUseAgain}
      />

      <div className="flex flex-col gap-2">
        <label className="text-[15px] font-medium text-foreground" htmlFor="comment">
          Ce ai schimba?
        </label>
        <textarea
          id="comment"
          className="min-h-24 rounded-xl border border-border bg-card px-4 py-3 text-[15px] text-foreground outline-none transition-colors placeholder:text-disabled focus:border-primary"
          value={comment}
          onChange={(e) => handleCommentChange(e.target.value)}
          placeholder="Opțional"
        />
      </div>

      {error && <p className="text-center text-[13px] text-destructive">{error}</p>}
      <Btn onClick={handleSubmit} disabled={!canSubmit || submitting}>
        {submitting ? "..." : error ? "ÎNCEARCĂ DIN NOU" : "TRIMITE"}
      </Btn>
    </main>
  );
}

function ScaleQuestion({
  label,
  value,
  onChange,
  lowLabel,
  highLabel,
}: {
  label: string;
  value: number | null;
  onChange: (v: number) => void;
  lowLabel: string;
  highLabel: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[15px] font-medium text-foreground">{label}</p>
      <div className="flex justify-between gap-2">
        {SCALE.map((n) => (
          <button
            key={n}
            onClick={() => onChange(n)}
            className={`flex h-11 w-11 items-center justify-center rounded-full border text-[16px] font-medium transition-all ${
              value === n ? "border-primary bg-primary text-primary-foreground" : "border-border text-foreground"
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="flex justify-between text-[12px] text-muted-foreground">
        <span>{lowLabel}</span>
        <span>{highLabel}</span>
      </div>
    </div>
  );
}

function ChoiceQuestion({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string | null;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[15px] font-medium text-foreground">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`rounded-lg border px-4 py-2 text-[14px] font-medium transition-all ${
              value === opt.value ? "border-primary bg-primary text-primary-foreground" : "border-border text-foreground"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
