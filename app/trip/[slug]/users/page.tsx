"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";
import { getTripBySlug, type Trip } from "@/lib/trip";
import { listProfilesForDevice, addChildProfile, type Participant } from "@/lib/participant";
import { TripNav } from "@/components/TripNav";
import { Centered } from "@/components/ui";

type Step = "loading" | "error" | "not-joined" | "ready";

export default function UsersPage() {
  const { slug } = useParams<{ slug: string }>();

  const [step, setStep] = useState<Step>("loading");
  const [trip, setTrip] = useState<Trip | null>(null);
  const [profiles, setProfiles] = useState<Participant[]>([]);
  const [showAddChild, setShowAddChild] = useState(false);
  const [childName, setChildName] = useState("");
  const [childAge, setChildAge] = useState("");

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
    await addChildProfile(trip.id, adult.id, childName.trim(), Number(childAge));
    setChildName("");
    setChildAge("");
    setShowAddChild(false);
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

  const adult = profiles.find((p) => p.role === "adult");

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-2 px-5 pb-32 pt-14">
      <h1 className="text-[28px] font-semibold tracking-tight text-foreground">Utilizatori</h1>
      <p className="mb-4 text-[15px] text-muted-foreground">Profiluri de pe acest dispozitiv</p>

      <div className="flex flex-col">
        {profiles.map((p) => (
          <div key={p.id} className="flex items-center justify-between border-b border-secondary py-4">
            <p className="text-[15px] font-medium text-foreground">{p.display_name}</p>
            <p className="text-[13px] text-muted-foreground">
              {p.role === "adult" ? "Adult" : `Copil · ${p.age} ani`}
            </p>
          </div>
        ))}
      </div>

      <div className="pt-3">
        {showAddChild ? (
          <form
            onSubmit={handleAddChild}
            className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-[0_2px_12px_rgba(0,0,0,0.05)]"
          >
            <p className="text-[15px] font-semibold text-foreground">Adaugă profil copil</p>
            <input
              className="rounded-xl border border-border bg-background px-4 py-3 text-[15px] text-foreground outline-none transition-colors placeholder:text-disabled focus:border-primary"
              placeholder="Numele copilului"
              value={childName}
              onChange={(e) => setChildName(e.target.value)}
            />
            <input
              className="rounded-xl border border-border bg-background px-4 py-3 text-[15px] text-foreground outline-none transition-colors placeholder:text-disabled focus:border-primary"
              placeholder="Vârsta"
              type="number"
              min={0}
              max={17}
              value={childAge}
              onChange={(e) => setChildAge(e.target.value)}
            />
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowAddChild(false)}
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
              onClick={() => setShowAddChild(true)}
              className="flex items-center gap-2 py-4 text-[15px] font-medium text-primary"
            >
              <Plus size={17} />
              Adaugă profil copil
            </button>
          )
        )}
      </div>

      <TripNav slug={slug} />
    </main>
  );
}
