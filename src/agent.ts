import { cycleDueMs, cycleOf, recipientFor } from "./rules.js";
import { PolicyViolation, type Treasury } from "./treasury.js";
import type { AgentAction, ChamaRules, Notifier } from "./types.js";

const defaultFmt = (minor: number): string => (minor / 100).toFixed(2);

/**
 * The AI treasurer. Each tick it looks at the ledger, pays out fully funded cycles,
 * reminds members who are close to or past their due date, and escalates a cycle to
 * the group once when someone is late. It only acts through the treasury, which
 * enforces the payout policy, so it cannot move money outside the rules.
 */
export class TreasurerAgent {
  private readonly done = new Set<string>();

  constructor(
    private readonly rules: ChamaRules,
    private readonly treasury: Treasury,
    private readonly notifier: Notifier,
    /** Turns a minor-unit amount into text for messages, e.g. "0.30 NEAR". */
    private readonly fmt: (minor: number) => string = defaultFmt,
  ) {}

  /** Run one pass at time `now` and return what the agent did. */
  async tick(now: number): Promise<AgentAction[]> {
    const actions: AgentAction[] = [];
    const current = cycleOf(this.rules, now);
    if (current < 0) return actions;

    const contributions = await this.treasury.listContributions();
    const payouts = await this.treasury.listPayouts();

    for (let cycle = 0; cycle <= current; cycle++) {
      if (payouts.some((p) => p.cycle === cycle)) continue;

      const paid = new Set(contributions.filter((c) => c.cycle === cycle).map((c) => c.member));
      const missing = this.rules.members.filter((m) => !paid.has(m));

      if (missing.length === 0) {
        const recipient = recipientFor(this.rules, cycle);
        const amount = this.rules.contribution * this.rules.members.length;
        try {
          const p = await this.treasury.sendPayout({ cycle, recipient, amount, at: now });
          actions.push({ type: "payout", cycle, recipient, amount, txId: p.txId });
          await this.notifier.send(
            recipient,
            `Cycle ${cycle + 1} is fully funded. ${this.fmt(amount)} was paid out to you (${p.txId}).`,
          );
        } catch (e) {
          if (!(e instanceof PolicyViolation)) throw e;
          actions.push({ type: "blocked", cycle, reason: e.message });
        }
        continue;
      }

      const due = cycleDueMs(this.rules, cycle);
      if (now > due + this.rules.graceMs) {
        for (const member of missing) {
          if (this.once(`late:${cycle}:${member}`)) {
            actions.push({ type: "reminder", cycle, member, kind: "late" });
            await this.notifier.send(
              member,
              `Your contribution for cycle ${cycle + 1} is late. A ${this.rules.lateFeeBps / 100}% fee now applies.`,
            );
          }
        }
        if (this.once(`escalate:${cycle}`)) {
          actions.push({ type: "escalate", cycle, missing });
          for (const member of this.rules.members) {
            await this.notifier.send(
              member,
              `Cycle ${cycle + 1} payout is on hold. Still waiting on: ${missing.join(", ")}.`,
            );
          }
        }
      } else if (now >= due - this.rules.cycleMs / 4) {
        for (const member of missing) {
          if (this.once(`due_soon:${cycle}:${member}`)) {
            actions.push({ type: "reminder", cycle, member, kind: "due_soon" });
            await this.notifier.send(
              member,
              `Reminder: ${this.fmt(this.rules.contribution)} is due soon for cycle ${cycle + 1}.`,
            );
          }
        }
      }
    }
    return actions;
  }

  /** True the first time a key is seen, so each reminder goes out only once. */
  private once(key: string): boolean {
    if (this.done.has(key)) return false;
    this.done.add(key);
    return true;
  }
}
