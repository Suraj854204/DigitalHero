import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Create your account" };

export default async function Signup() {
  const session = await getSession();
  if (session && !session.actor.suspended) redirect(session.profile.onboarding_completed_at ? "/app" : "/onboarding");
  return (
    <>
      <h1 className="text-2xl font-bold">Join <span className="serif-accent">Digital Heroes.</span></h1>
      <p className="mt-1 text-sm text-muted">Create your account first. Next you'll choose your charity and plan, and see every price before you pay.</p>
      <div className="mt-6"><SignupForm /></div>
      <p className="mt-6 text-center text-sm text-muted">Already a member? <Link className="font-semibold text-forest underline underline-offset-4" href="/login">Log in</Link></p>
    </>
  );
}
