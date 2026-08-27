"use client";

// Root-level fallback for an uncaught exception outside /trip/[slug]
// (its own error.tsx covers everything under there). global-error.tsx
// replaces the whole root layout, so it renders its own <html>/<body> --
// same reasoning as trip/[slug]/error.tsx: show the actual message
// instead of Next's generic "a apărut o excepție la nivelul clientului",
// since a bug report here only ever arrives as a phone screenshot.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ro" translate="no" className="notranslate">
      <body className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#F7F7F5] px-6 text-center font-sans">
        <p className="text-[15px] font-semibold text-[#1a1a1a]">A apărut o eroare neașteptată.</p>
        <p className="max-w-sm break-words text-[13px] text-[#6b6b6b]">{error.message || "(fără mesaj)"}</p>
        {error.digest && <p className="text-[11px] text-[#999]">Cod: {error.digest}</p>}
        <button
          onClick={reset}
          className="mt-2 rounded-2xl bg-[#1a1a1a] px-6 py-3 text-[15px] font-semibold text-white"
        >
          Încearcă din nou
        </button>
      </body>
    </html>
  );
}
