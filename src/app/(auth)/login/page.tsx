import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Alert } from "@/components/ui/primitives";
import { safeNext } from "@/lib/redirect";
import { getSession } from "@/lib/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Log in" };

export default async function Login({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const session = await getSession();
  if (session && !session.actor.suspended) redirect(session.profile.role === "admin" ? "/admin" : "/app");
  return (
    <>
      <h1 className="text-2xl font-bold">Welcome <span className="serif-accent">back.</span></h1>
      <p className="mt-1 text-sm text-muted">Log in to see your scores, charity impact and draws.</p>
      <div className="mt-5 space-y-3">
        {sp.setup && <Alert tone="warn">This environment isn't connected to Supabase yet. See docs/SETUP.md to configure it.</Alert>}
        {sp.suspended && <Alert tone="error">This account has been suspended. Please contact support.</Alert>}
        {sp.error === "link" && <Alert tone="error">That link has expired or was already used. Please try again.</Alert>}
      </div>
      <div className="mt-6"><LoginForm next={sp.next ? safeNext(sp.next, "") || undefined : undefined} /></div>
      <p className="mt-6 text-center text-sm text-muted">New here? <Link className="font-semibold text-forest underline underline-offset-4" href="/signup">Create an account</Link></p>
    </>
  );
}
