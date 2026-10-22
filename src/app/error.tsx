"use client";
import { buttonClass } from "@/components/ui/button-styles";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="mx-auto grid min-h-[70dvh] max-w-xl place-items-center px-5 text-center">
      <div role="alert">
        <h1 className="text-3xl font-bold">Something went wrong on our side.</h1>
        <p className="mt-3 text-ink-2">No money or scores were changed by this error. Please try again.</p>
        {error.digest && <p className="mt-2 font-mono text-xs text-muted">Reference: {error.digest}</p>}
        <button onClick={reset} className={`${buttonClass("primary")} mt-6`}>Try again</button>
      </div>
    </main>
  );
}
