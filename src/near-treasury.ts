import { SimulatedTreasury, type SettleFn } from "./treasury.js";
import type { ChamaRules } from "./types.js";

/** The one thing the treasury needs from NEAR: send `yocto` to `receiverId`, get a tx hash back. */
export interface Payer {
  transfer(receiverId: string, yocto: bigint): Promise<string>;
}

/** The part of a near-api-js Account that the payer uses (kept small so tests can fake it). */
export interface Transferer {
  transfer(args: { receiverId: string; amount: bigint }): Promise<{ transaction_outcome: { id: string } }>;
}

const CONNECT_FAILURES = new Set(["UND_ERR_CONNECT_TIMEOUT", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"]);

/** True only when the request never reached the server, so trying again cannot pay twice. */
export function isConnectFailure(e: unknown): boolean {
  const code = (e as { cause?: { code?: unknown } } | null)?.cause?.code;
  return typeof code === "string" && CONNECT_FAILURES.has(code);
}

/**
 * Real payer: signs and sends a NEAR transfer from the group's treasury account.
 * It retries automatically ONLY when the connection could not be opened. Any other failure
 * (for example the connection dropping after the transfer was sent) is thrown, because the
 * transfer might have gone through and sending again could pay twice.
 */
export class AccountPayer implements Payer {
  constructor(
    private readonly account: Transferer,
    private readonly opts: { attempts?: number; backoffMs?: number } = {},
  ) {}

  async transfer(receiverId: string, yocto: bigint): Promise<string> {
    const attempts = this.opts.attempts ?? 4;
    const backoffMs = this.opts.backoffMs ?? 1500;
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await this.account.transfer({ receiverId, amount: yocto });
        return res.transaction_outcome.id;
      } catch (e) {
        if (attempt >= attempts || !isConnectFailure(e)) throw e;
        await new Promise((r) => setTimeout(r, backoffMs * attempt));
      }
    }
  }
}

export interface NearTreasuryOptions {
  yoctoPerMinorUnit: bigint;
  ledgerPath?: string;
}

/**
 * Hybrid treasury for the hackathon build:
 *  - Payouts are REAL NEAR transfers, but only after the payout policy approves them.
 *  - Contributions are still recorded in the ledger (recordContribution), not detected on-chain.
 *    Detecting deposits needs an indexer; that is the next step and is not built.
 */
export class NearTreasury extends SimulatedTreasury {
  constructor(rules: ChamaRules, payer: Payer, opts: NearTreasuryOptions) {
    const settle: SettleFn = (req) => payer.transfer(req.recipient, BigInt(req.amount) * opts.yoctoPerMinorUnit);
    super(rules, { settle, ...(opts.ledgerPath ? { ledgerPath: opts.ledgerPath } : {}) });
  }
}
