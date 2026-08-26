"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Plus, MapPin, Calendar, Trophy } from "lucide-react";
import { getTripBySlug, type Trip } from "@/lib/trip";
import {
  listProfilesForDevice,
  addChildProfile,
  updateParticipant,
  deleteParticipant,
  type Participant,
} from "@/lib/participant";
import type { ParticipantRole } from "@/lib/supabase/types";
import { TripNav } from "@/components/TripNav";
import { Centered } from "@/components/ui";

type Step = "loading" | "error" | "not-joined" | "ready";
type Tab = "config" | "users" | "info";

const TABS: { id: Tab; label: string }[] = [
  { id: "config", label: "Configurare" },
  { id: "users", label: "Utilizatori" },
  { id: "info", label: "Info" },
];

export default function SettingsPage() {
  const { slug } = useParams<{ slug: string }>();

  const [step, setStep] = useState<Step>("loading");
  const [tab, setTab] = useState<Tab>("users");
  const [trip, setTrip] = useState<Trip | null>(null);
  const [profiles, setProfiles] = useState<Participant[]>([]);
  const [showAddChild, setShowAddChild] = useState(false);
  const [childName, setChildName] = useState("");
  const [childAge, setChildAge] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const loadProfiles = useCallback(async (tripId: string) => {
    const list = await listProfilesForDevice(tripId);
    setProfiles(list);
    return list;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const t = await getTripBySlug(slug);
        if (cancelled || !t) return;
        setTrip(t);

        const list = await loadProfiles(t.id);
        if (cancelled) return;
        setStep(list.length === 0 ? "not-joined" : "ready");
      } catch {
        if (!cancelled) setStep("error");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [slug, loadProfiles]);

  async function handleAddChild(e: FormEvent) {
    e.preventDefault();
    if (!trip || !childName.trim() || !childAge) return;
    const adult = profiles.find((p) => p.role === "adult");
    if (!adult) return;
    await addChildProfile(trip.id, childName.trim(), Number(childAge), adult.id);
    setChildName("");
    setChildAge("");
    setShowAddChild(false);
    await loadProfiles(trip.id);
  }

  async function handleSaveEdit(id: string, displayName: string, role: ParticipantRole, age: number | null) {
    if (!trip) return;
    await updateParticipant(id, displayName, role, age);
    setEditingId(null);
    await loadProfiles(trip.id);
  }

  async function handleDelete(id: string) {
    if (!trip) return;
    if (!window.confirm("Sigur ștergi acest profil?")) return;
    await deleteParticipant(id);
    await loadProfiles(trip.id);
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

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-2 px-5 pb-32 pt-14">
      <h1 className="mb-4 text-[28px] font-semibold tracking-tight text-foreground">Setări</h1>

      <div className="mb-6 flex rounded-xl bg-secondary p-1">
        {TABS.map((t) => (
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

      {tab === "config" && trip && <ConfigSection trip={trip} />}

      {tab === "users" && (
        <UsersSection
          profiles={profiles}
          editingId={editingId}
          onStartEdit={setEditingId}
          onCancelEdit={() => setEditingId(null)}
          onSaveEdit={handleSaveEdit}
          onDelete={handleDelete}
          showAddChild={showAddChild}
          onShowAddChild={() => setShowAddChild(true)}
          onCancelAddChild={() => setShowAddChild(false)}
          childName={childName}
          onChildNameChange={setChildName}
          childAge={childAge}
          onChildAgeChange={setChildAge}
          onAddChild={handleAddChild}
        />
      )}

      {tab === "info" && <InfoSection />}

      <TripNav slug={slug} />
    </main>
  );
}

function ConfigSection({ trip }: { trip: Trip }) {
  return (
    <div className="flex flex-col gap-3">
      <ConfigRow icon={<MapPin size={17} />} label="Destinație" value={trip.destination ?? "Nesetată"} />
      <ConfigRow
        icon={<Calendar size={17} />}
        label="Durata competiției"
        value={`${trip.duration_days} zile`}
      />
      <ConfigRow
        icon={<Trophy size={17} />}
        label="Premiul competiției"
        value={trip.prize ?? "Nu a fost stabilit încă"}
      />
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
  showAddChild,
  onShowAddChild,
  onCancelAddChild,
  childName,
  onChildNameChange,
  childAge,
  onChildAgeChange,
  onAddChild,
}: {
  profiles: Participant[];
  editingId: string | null;
  onStartEdit: (id: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: (id: string, displayName: string, role: ParticipantRole, age: number | null) => Promise<void>;
  onDelete: (id: string) => void;
  showAddChild: boolean;
  onShowAddChild: () => void;
  onCancelAddChild: () => void;
  childName: string;
  onChildNameChange: (v: string) => void;
  childAge: string;
  onChildAgeChange: (v: string) => void;
  onAddChild: (e: FormEvent) => void;
}) {
  const adult = profiles.find((p) => p.role === "adult");

  return (
    <div className="flex flex-col gap-2">
      <p className="mb-2 text-[15px] text-muted-foreground">Profiluri de pe acest dispozitiv</p>

      {profiles.map((p) =>
        editingId === p.id ? (
          <EditProfileForm key={p.id} profile={p} onSave={onSaveEdit} onCancel={onCancelEdit} />
        ) : (
          <div key={p.id} className="flex items-center justify-between border-b border-secondary py-4">
            <div>
              <p className="text-[15px] font-medium text-foreground">{p.display_name}</p>
              <p className="text-[13px] text-muted-foreground">
                {p.role === "adult" ? "Adult" : `Copil · ${p.age} ani`}
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
            />
            <input
              className="rounded-xl border border-border bg-background px-4 py-3 text-[15px] text-foreground outline-none transition-colors placeholder:text-disabled focus:border-primary"
              placeholder="Vârsta"
              type="number"
              min={0}
              max={17}
              value={childAge}
              onChange={(e) => onChildAgeChange(e.target.value)}
            />
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={onCancelAddChild}
                className="flex-1 rounded-xl bg-secondary py-3 text-[14px] font-semibold text-muted-foreground"
              >
                Anulează
              </button>
              <button
                type="submit"
                className="flex-1 rounded-xl bg-primary py-3 text-[14px] font-semibold text-primary-foreground"
              >
                Adaugă
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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    try {
      await onSave(profile.id, name.trim(), role, role === "child" ? Number(age) || null : null);
    } catch {
      setError("Nu s-a putut salva. Încearcă din nou.");
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
      />

      <div className="flex rounded-[10px] bg-secondary p-1">
        {(["adult", "child"] as const).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRole(r)}
            className={`flex-1 rounded-[7px] py-2 text-[14px] font-semibold transition-all duration-200 ${
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
          placeholder="Vârsta"
          type="number"
          min={0}
          max={17}
          value={age}
          onChange={(e) => setAge(e.target.value)}
        />
      )}

      {error && <p className="text-[13px] text-destructive">{error}</p>}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-xl bg-secondary py-3 text-[14px] font-semibold text-muted-foreground"
        >
          Anulează
        </button>
        <button type="submit" className="flex-1 rounded-xl bg-primary py-3 text-[14px] font-semibold text-primary-foreground">
          Salvează
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
        descoperit, individual), și Battle-ul de seară (Părinți vs. Copii).
      </InfoCard>

      <InfoCard title="Scorul serii">
        La Battle-ul de seară, fiecare răspuns corect valorează <strong>10 puncte</strong>.
        La Marea Finală (ultima seară), fiecare răspuns corect valorează{" "}
        <strong>5 puncte</strong>, adăugate la scorul acumulat până atunci.
      </InfoCard>

      <InfoCard title="PĂRINȚI vs COPII">
        Scorul afișat pe pagina Scor nu e suma brută de puncte, ci numărul de seri
        câștigate: echipa cu mai multe puncte în seara respectivă primește +1. În caz
        de egalitate, ambele echipe primesc +1. Scorul total e suma acestor seri
        câștigate pe parcursul întregii competiții.
      </InfoCard>

      <InfoCard title="Clasamentul individual">
        Clasamentul „Cine răspunde la toate întrebările?” din pagina Scor e separat de
        scorul Părinți vs. Copii — e doar pentru distracție, calculat din întrebările de
        dimineață/prânz la care a răspuns fiecare participant.
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
