import { TreasurerAgent } from "./agent.js";
import { createNearAccount } from "./near/client.js";
import { loadNearConfig } from "./near/config.js";
import { AccountPayer, NearTreasury } from "./near-treasury.js";
import type { ChamaRules, Notifier } from "./types.js";

// Run with: npm run demo:live
// A short chama on NEAR testnet. Time is simulated (so you don't wait a week per cycle),
// but every payout is a REAL testnet transfer from your treasury account.
// Members come from CHAMA_MEMBERS (comma-separated account ids, in rotation order).

const DAY = 86_400_000;
const START = Date.UTC(2026, 10, 16);
const at = (day: number): number => START + day * DAY;

const cfg = loadNearConfig();
if (cfg.network !== "testnet") throw new Error("The live demo only runs on testnet.");

const members = (process.env.CHAMA_MEMBERS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
if (members.length < 2) throw new Error("Set CHAMA_MEMBERS to at least 2 comma-separated account ids.");

const rules: ChamaRules = {
  name: "Live Testnet Chama",
  members,
  contribution: 1000, // 0.1 NEAR with the default scale
  startMs: START,
  cycleMs: 7 * DAY,
  graceMs: DAY,
  lateFeeBps: 1000,
};

const { account } = createNearAccount(cfg);
const treasury = new NearTreasury(rules, new AccountPayer(account), {
  yoctoPerMinorUnit: cfg.yoctoPerMinorUnit,
  ledgerPath: "ledger.json",
});

const notifier: Notifier = {
  async send(member, message) {
    console.log(`  -> ${member}: ${message}`);
  },
};
const agent = new TreasurerAgent(rules, treasury, notifier);

console.log(`\n${rules.name}: ${members.length} members, treasury account ${cfg.accountId}\n`);

// Only the first cycle is shown live to keep the demo short and the testnet cost tiny.
const paidCycles = new Set((await treasury.listPayouts()).map((p) => p.cycle));
if (paidCycles.has(0)) {
  console.log("Cycle 1 was already paid (see ledger.json). Delete ledger.json to run the demo again.");
} else {
  const existing = new Set((await treasury.listContributions()).filter((c) => c.cycle === 0).map((c) => c.member));
  for (const [i, m] of members.entries()) {
    if (existing.has(m)) continue;
    await treasury.recordContribution(m, 0, at(1 + i));
    console.log(`${m} contributed for cycle 1`);
  }
  await agent.tick(at(1 + members.length));
}

console.log("\nPayouts:");
for (const p of await treasury.listPayouts()) {
  console.log(`  cycle ${p.cycle + 1} -> ${p.recipient}`);
  console.log(`  tx ${p.txId}`);
  console.log(`  https://testnet.nearblocks.io/txns/${p.txId}`);
}
