import { Logo } from "@/components/site/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden px-5 py-10">
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 size-[30rem] rounded-full bg-mint/70 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-32 -left-20 size-[26rem] rounded-full bg-coral-soft/70 blur-3xl" />
      <main id="main" className="relative w-full max-w-md">
        <div className="mb-6 flex justify-center"><Logo /></div>
        <div className="rounded-[var(--radius-lg)] border border-line bg-card p-7 shadow-lift sm:p-9">{children}</div>
      </main>
    </div>
  );
}
