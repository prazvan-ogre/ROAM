"use client";

import { useState } from "react";
import { submitFeedback } from "@/lib/feedback";
import { trackEvent } from "@/lib/analytics";

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

  const canSubmit =
    learnedNew !== null &&
    conversations !== null &&
    searchedMore !== null &&
    anticipatedNext !== null &&
    wouldUseAgain !== null;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await submitFeedback({
        trip_id: tripId,
        participant_id: participantId,
        learned_new: learnedNew,
        generated_conversations: conversations,
        searched_more: searchedMore,
        anticipated_next: anticipatedNext as "da" | "uneori" | "nu",
        would_use_again: wouldUseAgain as "sigur" | "probabil" | "probabil_nu" | "nu",
        comment: comment.trim() || null,
      });
      await trackEvent(tripId, "feedback_submitted", participantId ?? undefined);
      onSubmitted();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-8 px-6 py-10">
      <h1 className="text-center text-2xl font-semibold">Câteva întrebări rapide</h1>

      <ScaleQuestion
        label="Ai aflat lucruri pe care nu le știai?"
        value={learnedNew}
        onChange={setLearnedNew}
        lowLabel="Deloc"
        highLabel="Foarte multe"
      />
      <ScaleQuestion
        label="Întrebările ROAM au generat conversații cu ceilalți?"
        value={conversations}
        onChange={setConversations}
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
        onChange={(v) => setSearchedMore(v === "true")}
      />

      <ChoiceQuestion
        label="Ai așteptat cu interes următoarea întrebare?"
        options={ANTICIPATED_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        value={anticipatedNext}
        onChange={setAnticipatedNext}
      />

      <ChoiceQuestion
        label="Ai folosi ROAM în următoarea vacanță?"
        options={USE_AGAIN_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        value={wouldUseAgain}
        onChange={setWouldUseAgain}
      />

      <div className="flex flex-col gap-2">
        <label className="font-medium" htmlFor="comment">
          Ce ai schimba?
        </label>
        <textarea
          id="comment"
          className="min-h-24 rounded-xl border border-slate-300 px-4 py-3"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Opțional"
        />
      </div>

      <button
        onClick={handleSubmit}
        disabled={!canSubmit || submitting}
        className="rounded-xl bg-slate-900 px-4 py-3 text-lg font-semibold text-white disabled:opacity-40"
      >
        {submitting ? "..." : "TRIMITE"}
      </button>
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
      <p className="font-medium">{label}</p>
      <div className="flex justify-between gap-2">
        {SCALE.map((n) => (
          <button
            key={n}
            onClick={() => onChange(n)}
            className={`h-11 w-11 rounded-full border text-lg font-medium ${
              value === n ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300"
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="flex justify-between text-xs text-slate-500">
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
      <p className="font-medium">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`rounded-lg border px-4 py-2 ${
              value === opt.value ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
