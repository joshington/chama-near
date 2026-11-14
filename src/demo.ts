import { TreasurerAgent } from "./agent.js";
import { SimulatedTreasury } from "./treasury.js";
import type { ChamaRules, Notifier } from "./types.js";

const DAY = 86_400_000;
const START = Date.UTC(2026, 10, 16);
const at = (day: number): number => START + day * DAY;

const rules: ChamaRules = {
  name: "Kampala Traders Chama",
  members: ["alice.near", "bob.near", "carol.near", "dave.near"],
  contribution: 2000, // 20.00 USDC
  startMs: START,
  cycleMs: 7 * DAY,
  graceMs: 1 * DAY,
  lateFeeBps: 1000, // 10%
};

let currentDay = 0;
const notifier: Notifier = {
  async send(member, message) {
    console.log(`  [day ${currentDay.toFixed(1)}] -> ${member}: ${message}`);
  },
};

const treasury = new SimulatedTreasury(rules);
const agent = new TreasurerAgent(rules, treasury, notifier);

async function pay(member: string, cycle: number, day: number): Promise<void> {
  currentDay = day;
  const c = await treasury.recordContribution(member, cycle, at(day));
  console.log(`[day ${day}] ${member} paid cycle ${cycle + 1}${c.fee ? ` (late fee ${(c.fee / 100).toFixed(2)})` : ""}`);
}

async function tick(day: number): Promise<void> {
  currentDay = day;
  await agent.tick(at(day));
}

console.log(`\n=== ${rules.name}: ${rules.members.length} members, 20.00 USDC per week ===\n`);

// Cycle 1 (days 0-7): everyone pays on time, alice receives the pot.
for (const [i, m] of rules.members.entries()) {
  await pay(m, 0, 1 + i);
  await tick(1 + i);
}

// Cycle 2 (days 7-14): bob forgets. The agent reminds him, holds the payout, then he pays late.
await pay("alice.near", 1, 8);
await pay("carol.near", 1, 9);
await pay("dave.near", 1, 10);
await tick(10);
await tick(13); // inside the final quarter of the cycle: due-soon reminder
await tick(16); // past the due date + grace: late reminder and escalation
await pay("bob.near", 1, 16.5);
await tick(16.5);

// Cycles 3 and 4: on time.
for (const cycle of [2, 3]) {
  for (const [i, m] of rules.members.entries()) {
    await pay(m, cycle, cycle * 7 + 3 + i);
    await tick(cycle * 7 + 3 + i);
  }
}

console.log("\n=== Summary ===");
for (const p of await treasury.listPayouts()) {
  console.log(`cycle ${p.cycle + 1}: ${(p.amount / 100).toFixed(2)} USDC -> ${p.recipient} (${p.txId})`);
}
console.log(`group reserve from late fees: ${(treasury.reserve / 100).toFixed(2)} USDC`);
