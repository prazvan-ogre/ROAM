"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getTripBySlug, type Trip } from "@/lib/trip";
import { listProfilesForDevice, addChildProfile, type Participant } from "@/lib/participant";
import { TripNav } from "@/components/TripNav";

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
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 px-6 py-10">
      <h1 className="text-center text-2xl font-semibold">Utilizatori</h1>

      <ul className="flex flex-col gap-2">
        {profiles.map((p) => (
          <li key={p.id} className="flex items-center justify-between rounded-xl bg-slate-100 px-4 py-2">
            <span>{p.display_name}</span>
            <span className="text-xs uppercase text-slate-500">
              {p.role === "adult" ? "Adult" : `Copil${p.age ? `, ${p.age}` : ""}`}
            </span>
          </li>
        ))}
      </ul>

      {showAddChild ? (
        <form onSubmit={handleAddChild} className="flex flex-col gap-2 rounded-xl bg-slate-50 p-4">
          <input
            className="rounded-lg border border-slate-300 px-3 py-2"
            placeholder="Numele copilului"
            value={childName}
            onChange={(e) => setChildName(e.target.value)}
          />
          <input
            className="rounded-lg border border-slate-300 px-3 py-2"
            placeholder="Vârsta"
            type="number"
            min={0}
            max={17}
            value={childAge}
            onChange={(e) => setChildAge(e.target.value)}
          />
          <div className="flex gap-2">
            <button type="submit" className="flex-1 rounded-lg bg-slate-900 px-3 py-2 text-white">
              Adaugă
            </button>
            <button
              type="button"
              onClick={() => setShowAddChild(false)}
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2"
            >
              Anulează
            </button>
          </div>
        </form>
      ) : (
        adult && (
          <button
            onClick={() => setShowAddChild(true)}
            className="rounded-xl border border-dashed border-slate-300 px-4 py-2 text-slate-600"
          >
            + Adaugă profil copil
          </button>
        )
      )}

      <TripNav slug={slug} />
    </main>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center text-slate-600">
      {children}
    </main>
  );
}
