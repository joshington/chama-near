import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { checkPayoutPolicy, lateFee, totalCycles, validateRules } from "./rules.js";
import type { ChamaRules, Contribution, Payout, PayoutRequest } from "./types.js";

/**
 * What the agent needs from a treasury. The agent only ever talks to this interface,
 * so it does not care whether money moves in memory or on NEAR.
 */
export interface Treasury {
  listContributions(): Promise<Contribution[]>;
  listPayouts(): Promise<Payout[]>;
  sendPayout(req: PayoutRequest): Promise<Payout>;
}

export class PolicyViolation extends Error {}

/** Moves the money for an approved payout and returns a transaction id. */
export type SettleFn = (req: PayoutRequest) => Promise<string>;

export interface TreasuryOptions {
  /** How a payout is actually paid. Default: an in-memory fake that returns "sim-tx-N". */
  settle?: SettleFn;
  /** If set, the ledger is saved here after every change and reloaded on start. */
  ledgerPath?: string;
}

interface LedgerFile {
  contributions: Contribution[];
  payouts: Payout[];
  reserve: number;
}

/**
 * The ledger plus the policy gate. With the default `settle` it is a pure simulation;
 * give it a real `settle` (see near-treasury.ts) and payouts become real transfers.
 * The policy check always runs first, so a payout outside the rules never reaches `settle`.
 */
export class SimulatedTreasury implements Treasury {
  private contributions: Contribution[] = [];
  private payouts: Payout[] = [];
  private reserveBalance = 0;
  /** Cycles whose payout is being settled right now, so two ticks can't pay the same cycle twice. */
  private inFlight = new Set<number>();
  private readonly settle: SettleFn;
  private readonly ledgerPath: string | undefined;

  constructor(
    private readonly rules: ChamaRules,
    opts: TreasuryOptions = {},
  ) {
    validateRules(rules);
    this.ledgerPath = opts.ledgerPath;
    this.settle = opts.settle ?? (async () => `sim-tx-${this.payouts.length + 1}`);
    this.load();
  }

  /** A member pays into the pot. Late payments carry a fee that goes to the reserve. */
  async recordContribution(member: string, cycle: number, at: number): Promise<Contribution> {
    if (!this.rules.members.includes(member)) throw new Error(`${member} is not a member`);
    if (cycle < 0 || cycle >= totalCycles(this.rules)) throw new Error(`cycle ${cycle} is outside the rotation`);
    if (this.contributions.some((c) => c.member === member && c.cycle === cycle)) {
      throw new Error(`${member} already paid for cycle ${cycle}`);
    }
    const fee = lateFee(this.rules, cycle, at);
    const entry: Contribution = { member, cycle, amount: this.rules.contribution, fee, at };
    this.contributions.push(entry);
    this.reserveBalance += fee;
    this.save();
    return entry;
  }

  async listContributions(): Promise<Contribution[]> {
    return [...this.contributions];
  }

  async listPayouts(): Promise<Payout[]> {
    return [...this.payouts];
  }

  async sendPayout(req: PayoutRequest): Promise<Payout> {
    if (this.inFlight.has(req.cycle)) throw new PolicyViolation(`cycle ${req.cycle} payout is already in progress`);
    const violation = checkPayoutPolicy(this.rules, this.contributions, this.payouts, req);
    if (violation) throw new PolicyViolation(violation);

    this.inFlight.add(req.cycle);
    try {
      const txId = await this.settle(req);
      const payout: Payout = { ...req, txId };
      this.payouts.push(payout);
      this.save();
      return payout;
    } finally {
      this.inFlight.delete(req.cycle);
    }
  }

  get reserve(): number {
    return this.reserveBalance;
  }

  private load(): void {
    if (!this.ledgerPath || !existsSync(this.ledgerPath)) return;
    const data = JSON.parse(readFileSync(this.ledgerPath, "utf8")) as LedgerFile;
    this.contributions = data.contributions;
    this.payouts = data.payouts;
    this.reserveBalance = data.reserve;
  }

  private save(): void {
    if (!this.ledgerPath) return;
    const data: LedgerFile = {
      contributions: this.contributions,
      payouts: this.payouts,
      reserve: this.reserveBalance,
    };
    writeFileSync(this.ledgerPath, JSON.stringify(data, null, 2));
  }
}
