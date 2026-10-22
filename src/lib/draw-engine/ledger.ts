/**
 * Double-entry style transfer ledger for a single draw run.
 *
 * Every entry moves `amountMinor` from one account to another, so money cannot
 * be created or destroyed by construction. `validateLedger` re-checks that
 * invariant independently of the code that produced the entries.
 *
 * Account namespaces:
 *   SOURCES       pool:<drawId>, jackpot:carry_in           (only ever debited)
 *   INTERMEDIATE  tier:<n>                                  (net zero after the run)
 *   SINKS         winner:<userId>, jackpot:carry_out, reserve:unclaimed (only ever credited)
 */
import { sum } from "./money.ts";
import type { LedgerEntry } from "./types.ts";

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerError";
  }
}

const isSource = (a: string) => a.startsWith("pool:") || a === "jackpot:carry_in";
const isIntermediate = (a: string) => a.startsWith("tier:");

export function netByAccount(entries: readonly LedgerEntry[]): Map<string, number> {
  const net = new Map<string, number>();
  for (const e of entries) {
    net.set(e.from, (net.get(e.from) ?? 0) - e.amountMinor);
    net.set(e.to, (net.get(e.to) ?? 0) + e.amountMinor);
  }
  return net;
}

/**
 * Throws LedgerError when any invariant fails:
 *  - every amount is a positive safe integer and from !== to
 *  - total debits == total credits (conservation)
 *  - sources are only debited, sinks only credited, tier accounts net to zero
 *  - total paid out to sinks equals the funded amount (pool + carry-in)
 */
export function validateLedger(entries: readonly LedgerEntry[], fundedMinor: number): void {
  for (const e of entries) {
    if (!Number.isSafeInteger(e.amountMinor) || e.amountMinor <= 0) {
      throw new LedgerError(`invalid amount ${e.amountMinor} for ${e.kind}`);
    }
    if (e.from === e.to) throw new LedgerError(`entry ${e.kind} moves money within ${e.from}`);
    // Direction rules are checked per entry: net balances alone would hide a
    // sink-to-sink transfer (e.g. one winner's prize quietly moved to another).
    if (!isSource(e.from) && !isIntermediate(e.from)) {
      throw new LedgerError(`sink ${e.from} was debited by ${e.kind}`);
    }
    if (isSource(e.to)) throw new LedgerError(`source ${e.to} was credited by ${e.kind}`);
  }
  const net = netByAccount(entries);
  const total = sum([...net.values()]);
  if (total !== 0) throw new LedgerError(`ledger does not balance, net ${total}`);

  let sourceOut = 0;
  let sinkIn = 0;
  for (const [account, balance] of net) {
    if (isSource(account)) {
      if (balance > 0) throw new LedgerError(`source ${account} was credited`);
      sourceOut += -balance;
    } else if (isIntermediate(account)) {
      if (balance !== 0) throw new LedgerError(`${account} retains ${balance}`);
    } else {
      if (balance < 0) throw new LedgerError(`sink ${account} was debited`);
      sinkIn += balance;
    }
  }
  if (sourceOut !== fundedMinor) {
    throw new LedgerError(`sources released ${sourceOut} but funding is ${fundedMinor}`);
  }
  if (sinkIn !== fundedMinor) {
    throw new LedgerError(`sinks received ${sinkIn} but funding is ${fundedMinor}`);
  }
}
