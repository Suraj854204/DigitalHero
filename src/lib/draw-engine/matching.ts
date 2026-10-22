/**
 * Matching a frozen score snapshot against the winning numbers.
 *
 * SET SEMANTICS: a winning number counts at most once, and each distinct
 * winning number matches if the participant's snapshot contains that value in
 * ANY of the five scores. Two scores of "30" therefore cannot yield two matches.
 * A participant lands in exactly one tier (their highest), so they can never be
 * counted twice in a tier or across tiers.
 */
import { validateWinningNumbers } from "./numbers.ts";
import {
  NUMBER_MAX,
  NUMBER_MIN,
  SCORES_REQUIRED,
  type FrozenParticipant,
  type MatchTier,
} from "./types.ts";

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotError";
  }
}

export function validateSnapshot(p: FrozenParticipant): void {
  if (!p || typeof p.userId !== "string" || p.userId.length === 0) {
    throw new SnapshotError("participant is missing a userId");
  }
  if (!Array.isArray(p.scores) || p.scores.length !== SCORES_REQUIRED) {
    throw new SnapshotError(`participant ${p.userId} must have exactly ${SCORES_REQUIRED} scores`);
  }
  for (const s of p.scores) {
    if (!Number.isInteger(s.value) || s.value < NUMBER_MIN || s.value > NUMBER_MAX) {
      throw new SnapshotError(`participant ${p.userId} has invalid score ${s.value}`);
    }
  }
}

export function countMatches(winning: readonly number[], participant: FrozenParticipant): number {
  validateWinningNumbers(winning);
  validateSnapshot(participant);
  const values = new Set(participant.scores.map((s) => s.value));
  let matches = 0;
  for (const n of winning) if (values.has(n)) matches += 1;
  return matches;
}

export function tierForMatches(matches: number): MatchTier | null {
  if (matches >= 5) return 5;
  if (matches === 4) return 4;
  if (matches === 3) return 3;
  return null;
}

export interface MatchOutcome {
  userId: string;
  matches: number;
  tier: MatchTier | null;
}

export interface MatchRun {
  outcomes: MatchOutcome[];
  winnersByTier: Record<MatchTier, string[]>;
  /** Participants rejected for malformed snapshots (reported, never silently dropped). */
  rejected: { userId: string; error: string }[];
}

export function matchParticipants(winning: readonly number[], participants: readonly FrozenParticipant[]): MatchRun {
  validateWinningNumbers(winning);
  const outcomes: MatchOutcome[] = [];
  const rejected: MatchRun["rejected"] = [];
  const winnersByTier: Record<MatchTier, string[]> = { 5: [], 4: [], 3: [] };
  const seen = new Set<string>();
  for (const p of participants) {
    if (seen.has(p?.userId)) {
      rejected.push({ userId: p.userId, error: "duplicate participant" });
      continue;
    }
    try {
      const matches = countMatches(winning, p);
      const tier = tierForMatches(matches);
      seen.add(p.userId);
      outcomes.push({ userId: p.userId, matches, tier });
      if (tier) winnersByTier[tier].push(p.userId);
    } catch (e) {
      rejected.push({ userId: p?.userId ?? "<unknown>", error: (e as Error).message });
    }
  }
  return { outcomes, winnersByTier, rejected };
}
