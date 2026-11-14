/** Amounts are integers in minor units (e.g. 2000 = 20.00 USDC). Times are epoch milliseconds. */

export interface ChamaRules {
  name: string;
  /** NEAR account ids, in rotation order: members[i] receives the pot for cycle i. */
  members: string[];
  /** Amount each member pays per cycle. */
  contribution: number;
  startMs: number;
  cycleMs: number;
  /** Extra time after a cycle ends before a contribution counts as late. */
  graceMs: number;
  /** Late fee as basis points of the contribution (1000 = 10%). Goes to the group reserve. */
  lateFeeBps: number;
}

export interface Contribution {
  member: string;
  cycle: number;
  amount: number;
  fee: number;
  at: number;
}

export interface Payout {
  cycle: number;
  recipient: string;
  amount: number;
  at: number;
  txId: string;
}

export interface PayoutRequest {
  cycle: number;
  recipient: string;
  amount: number;
  at: number;
}

export interface Notifier {
  send(member: string, message: string): Promise<void>;
}

export type AgentAction =
  | { type: "payout"; cycle: number; recipient: string; amount: number; txId: string }
  | { type: "reminder"; cycle: number; member: string; kind: "due_soon" | "late" }
  | { type: "escalate"; cycle: number; missing: string[] }
  | { type: "blocked"; cycle: number; reason: string };
