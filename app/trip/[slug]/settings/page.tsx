"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Plus, MapPin, Calendar, Clock, Trophy, Eye, EyeOff, CheckCircle2, AlertTriangle, RefreshCw } from "lucide-react";
import { getTripTimezone, type Trip } from "@/lib/trip";
import { addChildProfile, updateParticipant, deleteParticipant, type Participant } from "@/lib/participant";
import type { ParticipantRole } from "@/lib/supabase/types";
import { getPrizeStatus, type PrizeStatus } from "@/lib/prize";
import { getAccountDetails, getStoredAccountId, getTripsForCurrentAccount, updateAccountDetails } from "@/lib/creatorAccount";
import { validateTripContent, publishTrip, type ContentValidationIssue, type PublishTripResult } from "@/lib/adminContent";
import { TripNav } from "@/components/TripNav";
import { Centered } from "@/components/ui";
import { TripsList } from "@/components/TripsList";
import { useTrip, useProfiles } from "@/lib/hooks";

type Tab = "trips" | "config" | "users" | "info" | "publish";

const TABS: { id: Tab; label: string }[] = [
  { id: "trips", label: "Toate călătoriile" },
  { id: "config", label: "Configurare" },
  { id: "users", label: "Utilizatori" },
  { id: "info", label: "Info" },
  { id: "publish", label: "Publicare" },
];

export default function SettingsPage() {
  const { slug } = useParams<{ slug: string }>();
  const { data: trip, error: tripError } = useTrip(slug);
  const { data: profiles, error: profilesError, mutate: mutateProfiles } = useProfiles(trip?.id);

  const [tab, setTab] = useState<Tab>("users");
  const [showAddChild, setShowAddChild] = useState(false);
  const [childName, setChildName] = useState("");
  const [childAge, setChildAge] = useState("");
  const [addChildSubmitting, setAddChildSubmitting] = useState(false);
  const [addChildError, setAddChildError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // R4 (2026-09-06 batch): "loading" (null) is distinct from "loaded, no
  // options yet" ([]) and from "failed to load" ("error") -- getPrizeStatus
  // used to collapse a genuine fetch failure into permanent null (shown as
  // "Se încarcă..." forever, since nothing ever retries or reports it).
  const [prizeStatus, setPrizeStatus] = useState<PrizeStatus | null | "error">(null);
  // Same distinction for the account's trip list: a failed fetch used to
  // be indistinguishable from "this account genuinely has zero trips".
  const [accountTrips, setAccountTrips] = useState<Trip[] | "error">([]);
  const [isAdmin, setIsAdmin] = useState(false);

  // "Toate călătoriile" tab is only shown to whoever is logged into
  // "Călătoriile mele" on this device (app/trips/page.tsx) -- most
  // participants just join a trip by device id and never create that
  // account, so this stays hidden for them.
  const hasAccount = getStoredAccountId() !== null;
  const loadAccountTrips = useCallback(() => {
    if (!hasAccount) return;
    getTripsForCurrentAccount()
      .then(({ isAdmin, trips }) => {
        setIsAdmin(isAdmin);
        setAccountTrips(trips);
      })
      .catch((err) => {
        console.error("getTripsForCurrentAccount failed", err);
        setAccountTrips("error");
      });
  }, [hasAccount]);
  useEffect(() => {
    loadAccountTrips();
    // Only ever needs to run once per mount (plus whenever the retry
    // button below calls loadAccountTrips directly) -- hasAccount doesn't
    // change while this page is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Content (Discover/Battle) is drafted as a separate manual step after
  // a publicly-created trip's row exists (see app/trip/[slug]/page.tsx)
  // -- prize status is meaningless before that. Keyed on trip id/status
  // alone (not profiles), so adding/editing a child on this same page
  // doesn't needlessly refetch it.
  const loadPrizeStatus = useCallback(() => {
    if (!trip || trip.content_status !== "ready") return;
    getPrizeStatus(trip.id)
      .then(setPrizeStatus)
      .catch((err) => {
        console.error("getPrizeStatus failed", err);
        setPrizeStatus("error");
      });
  }, [trip]);
  useEffect(() => {
    loadPrizeStatus();
  }, [loadPrizeStatus]);

  // Defaults the tab strip once per trip -- to Toate călătoriile when
  // this device has an account but hasn't joined this particular trip
  // (or it isn't ready yet), otherwise Utilizatori. Re-evaluated on every
  // trip switch (the "trips" tab's own dropdown-like list) since this
  // component instance persists across a router.push between two
  // /trip/*/settings routes, but guarded by a ref so it doesn't also
  // re-fire and clobber the user's own tab choice every time `profiles`
  // revalidates in the background (e.g. right after adding a child here).
  const defaultedForTripId = useRef<string | null>(null);
  useEffect(() => {
    if (!trip || !profiles) return;
    if (defaultedForTripId.current === trip.id) return;
    defaultedForTripId.current = trip.id;
    const joined = profiles.length > 0;
    setTab(hasAccount && (trip.content_status !== "ready" || !joined) ? "trips" : "users");
  }, [trip, profiles, hasAccount]);

  // R4 correction (2026-09-06 batch, round 2): addChildProfile now keys
  // off a real idempotency key (client_request_id) instead of a time
  // window -- generated once per distinct attempt here, kept across a
  // retry of THAT attempt, and reset (null) whenever the person actually
  // changes the name/age (a correction, not a retry -- see
  // handleChildNameChange/handleChildAgeChange below) or after a
  // successful add (the next add is a new attempt).
  const addChildRequestIdRef = useRef<string | null>(null);

  function handleChildNameChange(v: string) {
    addChildRequestIdRef.current = null;
    setChildName(v);
  }
  function handleChildAgeChange(v: string) {
    addChildRequestIdRef.current = null;
    setChildAge(v);
  }

  async function handleAddChild(e: FormEvent) {
    e.preventDefault();
    if (!trip || !childName.trim() || !profiles || addChildSubmitting) return;
    const adult = profiles.find((p) => p.role === "adult");
    if (!adult) return;
    if (!addChildRequestIdRef.current) addChildRequestIdRef.current = crypto.randomUUID();
    setAddChildSubmitting(true);
    setAddChildError(null);
    try {
      await addChildProfile(
        trip.id,
        childName.trim(),
        childAge ? Number(childAge) : null,
        addChildRequestIdRef.current,
        adult.id,
      );
      addChildRequestIdRef.current = null;
      setChildName("");
      setChildAge("");
      setShowAddChild(false);
      await mutateProfiles();
    } catch (err) {
      console.error("addChildProfile failed", err);
      setAddChildError("Nu am putut adăuga profilul. Încearcă din nou.");
    } finally {
      setAddChildSubmitting(false);
    }
  }

  // R4 (2026-09-06 batch): no longer closes the form itself (setEditingId
  // used to run here, right after this step) -- EditProfileForm may still
  // have a second, separate save (account phone/PIN) to attempt after
  // this one, and closing here meant that second save's own failure was
  // invisible: the form was already gone by the time it could show an
  // error. EditProfileForm now closes itself, only once every step it
  // actually needs has succeeded.
  async function handleSaveEdit(id: string, displayName: string, role: ParticipantRole, age: number | null) {
    if (!trip) return;
    await updateParticipant(id, displayName, role, age);
    await mutateProfiles();
  }

  async function handleDelete(id: string) {
    if (!trip) return;
    if (!window.confirm("Sigur ștergi acest profil?")) return;
    setDeleteError(null);
    try {
      await deleteParticipant(id);
      await mutateProfiles();
    } catch (err) {
      console.error("deleteParticipant failed", err);
      setDeleteError("Nu am putut șterge profilul. Încearcă din nou.");
    }
  }

  if (tripError || profilesError) {
    return (
      <Centered>
        <p>Nu am putut încărca datele. Verifică-ți conexiunea.</p>
        <button onClick={() => window.location.reload()} className="mt-4 underline">
          Încearcă din nou
        </button>
      </Centered>
    );
  }

  // !trip covers both "still fetching" and "slug doesn't resolve to a
  // trip" the same way the pre-SWR version did (it never distinguished
  // the two, silently staying on the loading screen for a bad slug).
  if (!trip || !profiles) return <Centered>Se încarcă...</Centered>;

  // No account and never joined this trip on this device -- the one
  // case with nowhere else useful to send someone (arriving here from a
  // direct/shared link, e.g.), so this stays a full block instead of a
  // tab strip with nothing behind any of its tabs.
  if (trip.content_status === "ready" && profiles.length === 0 && !hasAccount) {
    return (
      <Centered>
        <p>Trebuie să te alături călătoriei mai întâi.</p>
        <Link href={`/trip/${slug}`} className="mt-4 inline-block underline">
          Înapoi acasă
        </Link>
      </Centered>
    );
  }
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-2 px-5 pb-32 pt-14">
      <h1 className="mb-4 text-[28px] font-semibold tracking-tight text-foreground">Setări</h1>

      <div className="mb-6 flex rounded-xl bg-secondary p-1">
        {TABS.filter((t) => (t.id !== "trips" || hasAccount) && (t.id !== "publish" || isAdmin)).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 rounded-lg py-2 text-[13px] font-semibold transition-all duration-200 ${
              tab === t.id ? "bg-card text-foreground shadow-[0_1px_4px_rgba(0,0,0,0.10)]" : "text-muted-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "trips" && (
        <TripsList trips={accountTrips} isAdmin={isAdmin} currentSlug={slug} onRetry={loadAccountTrips} />
      )}

      {tab === "config" && trip && (
        trip.content_status !== "ready" ? (
          <TripPendingNotice tripName={trip.name} />
        ) : profiles.length === 0 ? (
          <NotJoinedNotice slug={slug} />
        ) : (
          <ConfigSection trip={trip} prizeStatus={prizeStatus} onRetryPrize={loadPrizeStatus} />
        )
      )}

      {tab === "users" && trip && (
        trip.content_status !== "ready" ? (
          <TripPendingNotice tripName={trip.name} />
        ) : profiles.length === 0 ? (
          <NotJoinedNotice slug={slug} />
        ) : (
          <UsersSection
            profiles={profiles}
            editingId={editingId}
            onStartEdit={setEditingId}
            onCancelEdit={() => setEditingId(null)}
            onSaveEdit={handleSaveEdit}
            onDelete={handleDelete}
            deleteError={deleteError}
            showAddChild={showAddChild}
            onShowAddChild={() => setShowAddChild(true)}
            onCancelAddChild={() => {
              setShowAddChild(false);
              setAddChildError(null);
              addChildRequestIdRef.current = null;
            }}
            childName={childName}
            onChildNameChange={handleChildNameChange}
            childAge={childAge}
            onChildAgeChange={handleChildAgeChange}
            onAddChild={handleAddChild}
            addChildSubmitting={addChildSubmitting}
            addChildError={addChildError}
          />
        )
      )}

      {tab === "info" && <InfoSection />}

      {/* R7: admin-only (filtered out of the tab strip above for anyone
          else), and deliberately NOT gated on trip.content_status ===
          "ready" like Configurare/Utilizatori above -- this tab's whole
          purpose is to show WHY a pending/failed trip isn't ready yet,
          and to publish it once it is. Client-side isAdmin only decides
          what's SHOWN here; app/api/admin/trips/[slug]/{validate,publish}
          re-verify admin rights server-side regardless. */}
      {tab === "publish" && isAdmin && trip && <PublishSection trip={trip} />}

      <TripNav slug={slug} />
    </main>
  );
}

// Configurare/Utilizatori have nothing meaningful to show before a
// trip's Discover/Battle content exists (see the load effect above) --
// shown inline instead of blocking the whole page, so Toate călătoriile
// stays reachable.
function TripPendingNotice({ tripName }: { tripName: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card px-5 py-8 text-center">
      <p className="text-[15px] font-semibold text-foreground">Pregătim {tripName}...</p>
      <p className="mx-auto mt-2 max-w-xs text-[14px] text-muted-foreground">
        Întrebările și provocările pentru această călătorie sunt în lucru. Revino mai târziu.
      </p>
    </div>
  );
}

// Shown instead of Configurare/Utilizatori when this device hasn't
// joined a ready trip -- e.g. an admin/creator-account holder auto-
// redirected here from /trips (app/trips/page.tsx) without ever having
// personally joined that particular trip as a participant.
function NotJoinedNotice({ slug }: { slug: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card px-5 py-8 text-center">
      <p className="text-[15px] font-semibold text-foreground">Nu ești încă participant la această călătorie.</p>
      <Link href={`/trip/${slug}`} className="mt-3 inline-block text-[14px] font-medium text-primary underline">
        Alătură-te acum
      </Link>
    </div>
  );
}

// R7: check_key prefixes map to a short, non-technical Romanian label --
// the operator sees "Lipsă Discover Dimineață/Prânz" instead of the raw
// "discover.missing" the SQL validator returns (those keys stay stable
// for tooling/tests; this mapping is display-only).
const ISSUE_LABEL: Record<string, string> = {
  "trip.name_missing": "Călătoria nu are nume",
  "trip.destination_missing": "Călătoria nu are destinație",
  "trip.timezone_missing": "Călătoria nu are fus orar setat",
  "trip.timezone_invalid": "Fusul orar setat nu e valid",
  "trip.start_date_missing": "Călătoria nu are dată de start",
  "trip.duration_days_out_of_range": "Durata călătoriei e în afara intervalului permis",
  "trip.content_status_inconsistent": "Marcată gata, dar conținutul nu mai e valid",
  "discover.missing": "Lipsește o întrebare Discover",
  "discover.not_published": "Întrebare Discover nepublicată/neverificată",
  "discover.prompt_missing": "Întrebare Discover fără text",
  "discover.published_without_verification": "Întrebare Discover publicată dar neverificată",
  "discover.insufficient_options": "Întrebare Discover cu prea puține opțiuni",
  "discover.correct_option_count": "Întrebare Discover fără exact un răspuns corect",
  "discover.points_invalid": "Întrebare Discover cu punctaj invalid",
  "battle.daily_missing": "Lipsește Battle-ul zilei",
  "battle.daily_empty": "Battle-ul zilei nu are întrebări",
  "battle.multiple_active_for_day": "Mai multe Battle-uri active în aceeași zi",
  "battle.final_missing": "Lipsește Battle-ul Final",
  "battle.final_empty": "Battle-ul Final nu are întrebări",
  "battle.multiple_final": "Mai multe Battle-uri Finale active",
  "battle.not_published": "Întrebare Battle nepublicată/neverificată",
  "battle.question_trip_mismatch": "Întrebare Battle asociată greșit",
  "battle.duplicate_order_index": "Ordine ambiguă a întrebărilor din Battle",
  "battle.prompt_missing": "Întrebare Battle fără text",
  "battle.published_without_verification": "Întrebare Battle publicată dar neverificată",
  "battle.insufficient_options": "Întrebare Battle cu prea puține opțiuni",
  "battle.correct_option_count": "Întrebare Battle fără exact un răspuns corect",
  "battle.points_invalid": "Întrebare Battle cu punctaj invalid",
  "extra.type_missing": "Extra publicat fără tip",
  "extra.published_without_verification": "Extra publicat dar neverificat",
  "extra.trip_mismatch": "Extra asociat greșit",
  "link.invalid_url": "Link extern invalid",
  "link.trip_mismatch": "Link extern asociat greșit",
  "prize.not_configured": "Lipsesc opțiunile pentru votul premiului",
  "trip.not_found": "Călătoria nu a fost găsită",
};

function issueLabel(issue: ContentValidationIssue): string {
  return ISSUE_LABEL[issue.check_key] ?? issue.check_key;
}

const CONTENT_STATUS_LABEL: Record<string, string> = {
  pending: "În pregătire",
  generating: "Se generează",
  ready: "Publicat",
  failed: "Eșuat",
};

type PublishState = "loading" | "loaded" | "error" | "publishing";

function PublishSection({ trip }: { trip: Trip }) {
  const [state, setState] = useState<PublishState>("loading");
  const [contentStatus, setContentStatus] = useState<string>(trip.content_status);
  const [issues, setIssues] = useState<ContentValidationIssue[]>([]);
  const [publishResult, setPublishResult] = useState<PublishTripResult | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(() => {
    setState("loading");
    setActionError(null);
    validateTripContent(trip.slug)
      .then((result) => {
        setContentStatus(result.contentStatus);
        setIssues(result.issues);
        setState("loaded");
      })
      .catch((err) => {
        console.error("validateTripContent failed", err);
        setState("error");
      });
  }, [trip.slug]);

  useEffect(() => {
    load();
  }, [load]);

  async function handlePublish() {
    setState("publishing");
    setActionError(null);
    try {
      const result = await publishTrip(trip.slug);
      setPublishResult(result);
      setIssues(result.issues);
      if (result.status !== "rejected") setContentStatus("ready");
      setState("loaded");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Nu am putut publica. Încearcă din nou.");
      setState("loaded");
    }
  }

  if (state === "loading") {
    return <p className="py-8 text-center text-[14px] text-muted-foreground">Se verifică conținutul...</p>;
  }

  if (state === "error") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card px-5 py-8 text-center">
        <p className="text-[15px] text-muted-foreground">Nu am putut verifica conținutul.</p>
        <button onClick={load} className="text-[14px] font-semibold text-primary underline">
          Încearcă din nou
        </button>
      </div>
    );
  }

  const errorIssues = issues.filter((i) => i.severity === "error");
  const isClean = errorIssues.length === 0;
  const publishing = state === "publishing";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
            contentStatus === "ready" ? "bg-accent text-primary" : "bg-secondary text-muted-foreground"
          }`}
        >
          {isClean ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Status conținut</p>
          <p className="mt-0.5 text-[15px] font-medium text-foreground">
            {CONTENT_STATUS_LABEL[contentStatus] ?? contentStatus}
          </p>
        </div>
        <button
          onClick={load}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary"
          aria-label="Verifică din nou"
          title="Verifică din nou"
        >
          <RefreshCw size={15} />
        </button>
      </div>

      {isClean ? (
        <p className="text-[14px] text-muted-foreground">
          Toate verificările au trecut -- {errorIssues.length === 0 ? "conținutul e complet." : ""}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
            {errorIssues.length} de rezolvat înainte de publicare
          </p>
          <div className="flex flex-col gap-2">
            {errorIssues.map((issue, i) => (
              <div key={`${issue.check_key}-${issue.day_number ?? ""}-${issue.entity_id ?? i}`} className="rounded-xl bg-secondary px-4 py-3">
                <p className="text-[14px] font-medium text-foreground">
                  {issueLabel(issue)}
                  {issue.day_number != null ? ` -- Ziua ${issue.day_number}` : ""}
                </p>
                <p className="mt-0.5 text-[12px] text-muted-foreground">{issue.message}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {actionError && <p className="text-[13px] text-destructive">{actionError}</p>}

      {publishResult && (
        <p className="text-[13px] text-muted-foreground">
          {publishResult.status === "published"
            ? "Publicat cu succes."
            : publishResult.status === "already_published"
              ? "Era deja publicată -- nimic de schimbat."
              : "Publicarea a fost respinsă -- vezi lista de mai sus."}
        </p>
      )}

      <button
        onClick={handlePublish}
        disabled={!isClean || publishing}
        className="rounded-2xl bg-primary py-[14px] text-[15px] font-semibold text-primary-foreground transition-all duration-150 hover:bg-primary-hover active:scale-[0.98] disabled:opacity-40"
      >
        {publishing ? "Se publică..." : contentStatus === "ready" ? "Republică" : "Publică"}
      </button>

      <p className="text-center text-[12px] leading-relaxed text-disabled">
        Conținutul (întrebări, Battle-uri, Extra-uri) se editează în continuare din Supabase Studio -- publicarea de
        aici doar verifică și marchează călătoria ca gata, nu creează sau modifică întrebări.
      </p>
    </div>
  );
}

function ConfigSection({
  trip,
  prizeStatus,
  onRetryPrize,
}: {
  trip: Trip;
  prizeStatus: PrizeStatus | null | "error";
  onRetryPrize: () => void;
}) {
  const prizeValue =
    prizeStatus === null
      ? "Se încarcă..."
      : prizeStatus === "error"
        ? "Nu am putut încărca"
        : prizeStatus.options.length === 0
          ? "Nu a fost stabilit încă"
          : !prizeStatus.votingOpen && prizeStatus.winner
            ? prizeStatus.winner.title
            : "Se stabilește prin vot (fiecare participant votează la înscriere)";

  return (
    <div className="flex flex-col gap-3">
      <ConfigRow icon={<MapPin size={17} />} label="Destinație" value={trip.destination ?? "Nesetată"} />
      <ConfigRow
        icon={<Calendar size={17} />}
        label="Durata competiției"
        value={`${trip.duration_days} zile`}
      />
      {/* R6 follow-up: fusul orar al DESTINAȚIEI, nu al dispozitivului
          care se uită la Setări acum -- getTripTimezone falls back to
          Europe/Bucharest doar pentru un trip vechi, pre-R6, fără
          valoare stocată. */}
      <ConfigRow icon={<Clock size={17} />} label="Fus orar (ora destinației)" value={getTripTimezone(trip)} />
      <ConfigRow icon={<Trophy size={17} />} label="Premiul competiției" value={prizeValue} />
      {prizeStatus === "error" && (
        <button onClick={onRetryPrize} className="self-start text-[13px] font-semibold text-primary underline">
          Încearcă din nou
        </button>
      )}
    </div>
  );
}

function ConfigRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-primary">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-0.5 text-[15px] font-medium text-foreground">{value}</p>
      </div>
    </div>
  );
}

function UsersSection({
  profiles,
  editingId,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  deleteError,
  showAddChild,
  onShowAddChild,
  onCancelAddChild,
  childName,
  onChildNameChange,
  childAge,
  onChildAgeChange,
  onAddChild,
  addChildSubmitting,
  addChildError,
}: {
  profiles: Participant[];
  editingId: string | null;
  onStartEdit: (id: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: (id: string, displayName: string, role: ParticipantRole, age: number | null) => Promise<void>;
  onDelete: (id: string) => void;
  deleteError: string | null;
  showAddChild: boolean;
  onShowAddChild: () => void;
  onCancelAddChild: () => void;
  childName: string;
  onChildNameChange: (v: string) => void;
  childAge: string;
  onChildAgeChange: (v: string) => void;
  onAddChild: (e: FormEvent) => void;
  addChildSubmitting: boolean;
  addChildError: string | null;
}) {
  const adult = profiles.find((p) => p.role === "adult");

  return (
    <div className="flex flex-col gap-2">
      <p className="mb-2 text-[15px] text-muted-foreground">Profiluri de pe acest dispozitiv</p>
      {deleteError && <p className="mb-2 text-[13px] text-destructive">{deleteError}</p>}

      {profiles.map((p) =>
        editingId === p.id ? (
          <EditProfileForm key={p.id} profile={p} onSave={onSaveEdit} onCancel={onCancelEdit} />
        ) : (
          <div key={p.id} className="flex items-center justify-between border-b border-secondary py-4">
            <div>
              <p className="text-[15px] font-medium text-foreground">{p.display_name}</p>
              <p className="text-[13px] text-muted-foreground">
                {p.role === "adult" ? "Adult" : p.age ? `Copil · ${p.age} ani` : "Copil"}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => onStartEdit(p.id)} className="text-[14px] font-medium text-primary">
                Editează
              </button>
              <button onClick={() => onDelete(p.id)} className="text-[14px] font-medium text-destructive">
                Șterge
              </button>
            </div>
          </div>
        ),
      )}

      <div className="pt-3">
        {showAddChild ? (
          <form
            onSubmit={onAddChild}
            className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-[0_2px_12px_rgba(0,0,0,0.05)]"
          >
            <p className="text-[15px] font-semibold text-foreground">Adaugă profil copil</p>
            <input
              className="rounded-xl border border-border bg-background px-4 py-3 text-[15px] text-foreground outline-none transition-colors placeholder:text-disabled focus:border-primary"
              placeholder="Numele copilului"
              value={childName}
              onChange={(e) => onChildNameChange(e.target.value)}
              disabled={addChildSubmitting}
            />
            <input
              className="rounded-xl border border-border bg-background px-4 py-3 text-[15px] text-foreground outline-none transition-colors placeholder:text-disabled focus:border-primary"
              placeholder="Vârsta (opțional)"
              type="number"
              min={0}
              max={17}
              value={childAge}
              onChange={(e) => onChildAgeChange(e.target.value)}
              disabled={addChildSubmitting}
            />
            {addChildError && <p className="text-[13px] text-destructive">{addChildError}</p>}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={onCancelAddChild}
                disabled={addChildSubmitting}
                className="flex-1 rounded-xl bg-secondary py-3 text-[14px] font-semibold text-muted-foreground disabled:opacity-60"
              >
                Anulează
              </button>
              <button
                type="submit"
                disabled={addChildSubmitting || !childName.trim()}
                className="flex-1 rounded-xl bg-primary py-3 text-[14px] font-semibold text-primary-foreground disabled:opacity-60"
              >
                {addChildSubmitting ? "..." : "Adaugă"}
              </button>
            </div>
          </form>
        ) : (
          adult && (
            <button
              onClick={onShowAddChild}
              className="flex items-center gap-2 py-4 text-[15px] font-medium text-primary"
            >
              <Plus size={17} />
              Adaugă profil copil
            </button>
          )
        )}
      </div>
    </div>
  );
}

function EditProfileForm({
  profile,
  onSave,
  onCancel,
}: {
  profile: Participant;
  onSave: (id: string, displayName: string, role: ParticipantRole, age: number | null) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(profile.display_name);
  const [role, setRole] = useState<ParticipantRole>(profile.role);
  const [age, setAge] = useState(profile.age?.toString() ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // R4 (2026-09-06 batch): the profile fields and the account phone/PIN
  // are two separate writes (updateParticipant, then updateAccountDetails)
  // that cannot be treated as one transaction -- once the first succeeds,
  // a retry must never repeat it (harmless here since it's a plain update
  // by id, but pointless and would mask which half actually still needs
  // retrying). Tracks that distinction so the error message says exactly
  // what saved and what didn't.
  const [profileSaved, setProfileSaved] = useState(false);

  // Only the specific adult profile this device's "Călătoriile mele"
  // account actually created (profile.account_id, set server-side after
  // login -- see app/api/account/route.ts and
  // src/lib/security/participantLink.ts, batch 2) gets phone/PIN fields
  // here -- not just any adult profile on a device that happens to have
  // some account logged in (a device can have more than one adult
  // profile, e.g. an admin account plus an unrelated participant profile
  // used for testing). accountId is read once (not re-checked on every
  // render) since it doesn't change while this form is open; this is a
  // display-only comparison (which fields to show), not a security
  // boundary -- account_id itself is column-locked at the database
  // layer (20260907091000_batch2_participant_lockdown.sql).
  const [accountId] = useState(() => getStoredAccountId());
  const showAccountFields = Boolean(accountId) && profile.account_id === accountId;
  const [phoneNumber, setPhoneNumber] = useState("");
  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);

  useEffect(() => {
    if (!showAccountFields || !accountId) return;
    getAccountDetails()
      .then((details) => setPhoneNumber(details.phoneNumber))
      .catch(() => undefined);
    // Only ever needs to run once per mount of this form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // R4-fix6 (2026-09-06 batch, review round 2): a stale save for THIS
  // profile that resolves after the person has already switched to
  // editing a DIFFERENT profile (parent unmounts this instance by
  // changing editingId, per-profile `key`) used to still call onCancel()
  // -- a plain closure into the parent's setEditingId(null), unaffected
  // by this component's own unmount -- and silently close whichever
  // OTHER profile's form was now open, discarding anything typed into
  // it. React already no-ops this component's own setState calls after
  // unmount, but onCancel reaches into the PARENT, so it needs its own
  // guard.
  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // R4 (2026-09-06 batch): closes the form itself (onCancel), only after
  // every step it actually needs has succeeded -- previously onSave alone
  // closed it (see handleSaveEdit above), before the account-details save
  // below even ran, so that second save's own failure was invisible. On
  // retry, a profile save that already succeeded is skipped (profileSaved)
  // -- only the account-details save (the part that actually failed)
  // runs again.
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    // React state setters don't update their own variable's binding
    // within the same function call (only on the next render) -- this
    // local mirrors profileSaved for the DURATION of this one call, so
    // the catch block below knows correctly whether THIS call's own
    // profile save just succeeded, not last render's stale value.
    let profileJustSaved = profileSaved;
    try {
      if (!profileSaved) {
        await onSave(profile.id, name.trim(), role, role === "child" ? Number(age) || null : null);
        profileJustSaved = true;
        if (mountedRef.current) setProfileSaved(true);
      }
      if (showAccountFields && accountId) {
        await updateAccountDetails({
          phoneNumber: phoneNumber.trim(),
          pin: pin.trim() ? pin.trim() : undefined,
        });
      }
      // Only ever close THIS form if it's still the one open -- a switch
      // to a different profile while this save was in flight must not
      // close that other, now-open form out from under the person using
      // it.
      if (mountedRef.current) onCancel();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Nu s-a putut salva. Încearcă din nou.";
      if (mountedRef.current) {
        setError(profileJustSaved ? `Profilul a fost salvat, dar detaliile contului nu: ${message}` : message);
      } else {
        console.error("EditProfileForm save failed after switching away", err);
      }
    } finally {
      if (mountedRef.current) setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-[0_2px_12px_rgba(0,0,0,0.05)]"
    >
      <input
        className="rounded-xl border border-border bg-background px-4 py-3 text-[15px] text-foreground outline-none transition-colors focus:border-primary"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
        disabled={submitting || profileSaved}
      />

      <div className="flex rounded-[10px] bg-secondary p-1">
        {(["adult", "child"] as const).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRole(r)}
            disabled={submitting || profileSaved}
            className={`flex-1 rounded-[7px] py-2 text-[14px] font-semibold transition-all duration-200 disabled:opacity-60 ${
              role === r ? "bg-card text-foreground shadow-[0_1px_4px_rgba(0,0,0,0.10)]" : "text-muted-foreground"
            }`}
          >
            {r === "adult" ? "Adult" : "Copil"}
          </button>
        ))}
      </div>

      {role === "child" && (
        <input
          className="rounded-xl border border-border bg-background px-4 py-3 text-[15px] text-foreground outline-none transition-colors focus:border-primary"
          placeholder="Vârsta (opțional)"
          type="number"
          min={0}
          max={17}
          value={age}
          onChange={(e) => setAge(e.target.value)}
          disabled={submitting || profileSaved}
        />
      )}

      {showAccountFields && (
        <>
          <div className="mt-1 border-t border-secondary pt-3">
            <p className="mb-2 text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
              Contul &quot;Călătoriile mele&quot;
            </p>
          </div>
          <input
            className="rounded-xl border border-border bg-background px-4 py-3 text-[15px] text-foreground outline-none transition-colors focus:border-primary"
            placeholder="Număr de telefon"
            type="tel"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            disabled={submitting}
          />
          <div className="relative">
            <input
              className="w-full rounded-xl border border-border bg-background px-4 py-3 pr-11 text-[15px] text-foreground outline-none transition-colors focus:border-primary"
              placeholder="PIN nou (lasă gol ca să-l păstrezi)"
              type={showPin ? "text" : "password"}
              inputMode="numeric"
              pattern="[0-9]{4,6}"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              disabled={submitting}
            />
            <button
              type="button"
              onClick={() => setShowPin((v) => !v)}
              aria-label={showPin ? "Ascunde PIN-ul" : "Arată PIN-ul"}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            >
              {showPin ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>
        </>
      )}

      {error && <p className="text-[13px] text-destructive">{error}</p>}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="flex-1 rounded-xl bg-secondary py-3 text-[14px] font-semibold text-muted-foreground disabled:opacity-60"
        >
          Anulează
        </button>
        <button
          type="submit"
          disabled={submitting || !name.trim()}
          className="flex-1 rounded-xl bg-primary py-3 text-[14px] font-semibold text-primary-foreground disabled:opacity-60"
        >
          {submitting ? "..." : "Salvează"}
        </button>
      </div>
    </form>
  );
}

function InfoSection() {
  return (
    <div className="flex flex-col gap-4 text-[15px] leading-relaxed text-secondary-foreground">
      <InfoCard title="Cum se joacă">
        În fiecare zi sunt trei momente: Dimineața și Prânzul (câte o întrebare de
        descoperit, individual), și Battle-ul de seară (Părinți vs. Copii). La Battle
        răspunde fiecare participant pe rând, de pe același telefon.
      </InfoCard>

      <InfoCard title="Punctajul">
        Fiecare răspuns corect valorează <strong>10 puncte</strong> — la Dimineață,
        Prânz și Battle-ul de seară. La Marea Finală (ultima seară), fiecare răspuns
        corect valorează <strong>5 puncte</strong>.
      </InfoCard>

      <InfoCard title="PĂRINȚI vs COPII">
        La fiecare Battle, scorul unei echipe e media punctelor membrilor ei (suma
        punctelor împărțită la câți au răspuns) — ca numărul de adulți și de copii să
        nu fie egal să nu conteze. Echipa cu media mai mare primește +1 la scorul
        total; egalitate → +1 pentru ambele echipe. Doar răspunsurile de la Battle
        contează pentru acest scor — cele de dimineață/prânz nu.
      </InfoCard>

      <InfoCard title="Rezultatul serii">
        Rezultatul Battle-ului nu e vizibil primele 15 minute de la primul răspuns, cât
        încă mai răspund ceilalți. După ce trece timpul, cine mai răspunde încă
        primește punctele la scorul personal, dar nu mai schimbă rezultatul serii.
      </InfoCard>

      <InfoCard title="Clasamentul individual">
        Clasamentul „Cine răspunde la toate întrebările?” din pagina Scor e separat de
        scorul Părinți vs. Copii — e doar pentru distracție, calculat din toate
        răspunsurile corecte ale fiecărui participant (dimineață, prânz și Battle).
      </InfoCard>
    </div>
  );
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
      <p className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-primary">{title}</p>
      <p>{children}</p>
    </div>
  );
}
