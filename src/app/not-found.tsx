import { LinkButton } from "@/components/ui/primitives";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto grid min-h-[70dvh] max-w-xl place-items-center px-5 text-center">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-forest">404</p>
        <h1 className="mt-3 text-4xl font-bold">We can't find that <span className="serif-accent">page.</span></h1>
        <p className="mt-3 text-ink-2">It may have moved, or the link might be mistyped.</p>
        <div className="mt-6 flex justify-center gap-3"><LinkButton href="/">Back home</LinkButton><LinkButton href="/charities" variant="secondary">Browse charities</LinkButton></div>
      </div>
    </main>
  );
}
