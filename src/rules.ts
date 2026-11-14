import type { ChamaRules, Contribution, Payout, PayoutRequest } from "./types.js";

export function validateRules(r: ChamaRules): void {
  if (!r.name.trim()) throw new Error("name is required");
  if (r.members.length < 2) throw new Error("a chama needs at least 2 members");
  if (new Set(r.members).size !== r.members.length) throw new Error("duplicate members");
  if (!Number.isSafeInteger(r.contribution) || r.contribution <= 0) {
    throw new Error("contribution must be a positive integer (minor units)");
  }
  if (!Number.isSafeInteger(r.startMs)) throw new Error("startMs must be an integer");
  if (!Number.isSafeInteger(r.cycleMs) || r.cycleMs <= 0) throw new Error("cycleMs must be positive");
  if (r.graceMs < 0 || r.graceMs >= r.cycleMs) throw new Error("graceMs must be in [0, cycleMs)");
  if (r.lateFeeBps < 0 || r.lateFeeBps > 10_000) throw new Error("lateFeeBps must be in [0, 10000]");
}

/** One full rotation: every member receives the pot exactly once. */
export const totalCycles = (r: ChamaRules): number => r.members.length;

/** Index of the cycle running at `now` (-1 before start, capped at the last cycle). */
export function cycleOf(r: ChamaRules, now: number): number {
  if (now < r.startMs) return -1;
  return Math.min(Math.floor((now - r.startMs) / r.cycleMs), totalCycles(r) - 1);
}

/** When cycle `c` ends, which is when contributions for it are due. */
export const cycleDueMs = (r: ChamaRules, c: number): number => r.startMs + (c + 1) * r.cycleMs;

export function recipientFor(r: ChamaRules, c: number): string {
  const m = r.members[c];
  if (c < 0 || m === undefined) throw new Error(`cycle ${c} is outside the rotation`);
  return m;
}

export const isLate = (r: ChamaRules, c: number, at: number): boolean =>
  at > cycleDueMs(r, c) + r.graceMs;

export const lateFee = (r: ChamaRules, c: number, at: number): number =>
  isLate(r, c, at) ? Math.floor((r.contribution * r.lateFeeBps) / 10_000) : 0;

/**
 * The payout policy. Returns null if the payout is allowed, or the reason it is not.
 * The same check runs in the simulated treasury and (later) before the agent
 * proposes a payout to the on-chain DAO, so the agent can never go outside the rules.
 */
export function checkPayoutPolicy(
  r: ChamaRules,
  contributions: readonly Contribution[],
  payouts: readonly Payout[],
  req: PayoutRequest,
): string | null {
  if (req.cycle < 0 || req.cycle >= totalCycles(r)) return `cycle ${req.cycle} is outside the rotation`;
  if (req.recipient !== recipientFor(r, req.cycle)) {
    return `${req.recipient} is not the recipient for cycle ${req.cycle}`;
  }
  if (payouts.some((p) => p.cycle === req.cycle)) return `cycle ${req.cycle} was already paid out`;
  const paid = new Set(contributions.filter((c) => c.cycle === req.cycle).map((c) => c.member));
  const missing = r.members.filter((m) => !paid.has(m));
  if (missing.length > 0) return `cycle ${req.cycle} is not fully funded (missing: ${missing.join(", ")})`;
  const pot = r.contribution * r.members.length;
  if (req.amount !== pot) return `amount ${req.amount} does not match the pot ${pot}`;
  return null;
}
