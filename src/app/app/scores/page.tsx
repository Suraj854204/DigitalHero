import type { Metadata } from "next";
import { Alert, PageHeader } from "@/components/ui/primitives";
import { getMyScores } from "@/lib/data/subscriber";
import { todayISO } from "@/lib/format";
import { requireUserPage } from "@/lib/session";
import { AddScoreForm, ScoreList } from "./scores-manager";

export const metadata: Metadata = { title: "My scores" };

export default async function Scores() {
  await requireUserPage();
  const scores = await getMyScores();
  const today = todayISO();
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Scores" title="Your five" accent="latest rounds.">We keep your five most recent scores, newest first. Adding a sixth replaces the oldest.</PageHeader>
      <AddScoreForm today={today} />
      <section aria-labelledby="mine"><h2 id="mine" className="mb-3 text-xl font-bold">Your scores <span className="text-base font-normal text-muted">({scores.length}/5)</span></h2>
        {scores.length > 0 && scores.length < 5 && <Alert tone="info" className="mb-4">Add {5 - scores.length} more to be eligible for the next draw.</Alert>}
        <ScoreList scores={scores} today={today} /></section>
      <p className="text-xs text-muted">When a draw is approved, your five scores at that moment are frozen. Editing scores afterwards never changes a past draw.</p>
    </div>
  );
}
