import { setDefaultResultOrder } from "node:dns";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { createLlmNotifier, parseLanguages } from "./llm-notifier.js";
import { createNearAccount } from "./near/client.js";
import { loadNearConfig } from "./near/config.js";
import { AccountPayer, NearTreasury } from "./near-treasury.js";
import { SimulatedTreasury } from "./treasury.js";
import type { ChamaRules } from "./types.js";

// Start with: npm start   (then open http://localhost:3000)
//   Simulation (default): no blockchain, nothing to set up.
//   Live testnet: set CHAMA_MODE=live and fill in .env (see GUIDE.md).

// Some networks time out when Node tries IPv6 first; prefer IPv4 for reaching the NEAR RPC.
setDefaultResultOrder("ipv4first");

const DAY = 86_400_000;
const mode = process.env.CHAMA_MODE === "live" ? "live" : "sim";

const envMembers = (process.env.CHAMA_MEMBERS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const members = envMembers.length >= 2 ? envMembers : ["alice.testnet", "bob.testnet", "carol.testnet", "dave.testnet"];

const rules: ChamaRules = {
  name: process.env.CHAMA_NAME ?? "Kampala Traders Chama",
  members,
  contribution: 1000,
  startMs: Date.UTC(2026, 10, 16),
  cycleMs: 7 * DAY,
  graceMs: DAY,
  lateFeeBps: 1000,
};

let formatAmount = (minor: number): string => `${(minor / 100).toFixed(2)} USDC`;
let makeTreasury = (): SimulatedTreasury => new SimulatedTreasury(rules);
let explorerTxUrl: ((txId: string) => string) | undefined;

if (mode === "live") {
  // Never fall back to placeholder names in live mode: those accounts belong to other people.
  if (envMembers.length < 2) {
    throw new Error("Live mode needs CHAMA_MEMBERS in .env: at least 2 accounts you control, comma-separated.");
  }
  const cfg = loadNearConfig();
  if (cfg.network !== "testnet") throw new Error("Live mode only runs on testnet.");
  const { account } = createNearAccount(cfg);
  const payer = new AccountPayer(account);
  makeTreasury = () => new NearTreasury(rules, payer, { yoctoPerMinorUnit: cfg.yoctoPerMinorUnit, ledgerPath: "ledger.json" });
  // 1e20 yocto per minor unit by default, so NEAR with 4 decimals = minor * yocto / 1e20 / 10000.
  formatAmount = (minor) => `${(Number((BigInt(minor) * cfg.yoctoPerMinorUnit) / 10n ** 20n) / 10_000).toFixed(4)} NEAR`;
  explorerTxUrl = (txId) => `https://testnet.nearblocks.io/txns/${txId}`;
}

const apiKey = process.env.ANTHROPIC_API_KEY;
const languageFor = parseLanguages(process.env.LLM_LANGUAGES);

const server = createApp({
  rules,
  mode,
  makeTreasury,
  formatAmount,
  ...(explorerTxUrl ? { explorerTxUrl } : {}),
  ...(apiKey && process.env.LLM_LANGUAGES
    ? { wrapNotifier: (inner) => createLlmNotifier(inner, { apiKey, languageFor }) }
    : {}),
  htmlPath: fileURLToPath(new URL("./web/index.html", import.meta.url)),
});

const port = Number(process.env.PORT ?? 3000);
// Bound to localhost on purpose: in live mode this server can move testnet funds.
server.listen(port, "127.0.0.1", () => {
  console.log(`Chama running in ${mode.toUpperCase()} mode: http://localhost:${port}`);
  if (apiKey && process.env.LLM_LANGUAGES) console.log("Language-model reminders: ON");
});
