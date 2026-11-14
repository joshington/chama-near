import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/app.ts";
import { SimulatedTreasury } from "../src/treasury.ts";
import type { ChamaRules } from "../src/types.ts";

const DAY = 86_400_000;
const rules: ChamaRules = {
  name: "Retry Chama",
  members: ["a.testnet", "b.testnet"],
  contribution: 1000,
  startMs: Date.UTC(2026, 10, 16),
  cycleMs: 7 * DAY,
  graceMs: DAY,
  lateFeeBps: 1000,
};

// The first payout attempt fails (like a network error); later attempts succeed.
let attempts = 0;
const server = createApp({
  rules,
  mode: "sim",
  makeTreasury: () =>
    new SimulatedTreasury(rules, {
      settle: async () => {
        if (++attempts === 1) throw new Error("fetch failed");
        return "tx-after-retry";
      },
    }),
  formatAmount: (n) => `${n}`,
  htmlPath: fileURLToPath(new URL("../src/web/index.html", import.meta.url)),
});
let base = "";
before(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => void server.close());

const post = (path: string, body: unknown = {}) =>
  fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const state = async () => (await fetch(base + "/api/state")).json() as Promise<any>;

describe("retrying a failed payout", () => {
  it("keeps the cycle funded and unpaid after a failed transfer, and explains how to retry", async () => {
    await post("/api/contribute", { member: "a.testnet", cycle: 0 });
    await post("/api/contribute", { member: "b.testnet", cycle: 0 });
    const s = await state();
    assert.equal(s.cycles[0].status, "funded");
    assert.equal(s.cycles[0].payout, null);
    assert.ok(s.log.some((e: any) => /Agent error: fetch failed/.test(e.text) && /Run agent now/.test(e.text)));
  });

  it("Run agent now retries without moving time, and pays exactly once", async () => {
    const before = await state();
    await post("/api/tick");
    const after = await state();
    assert.equal(after.day, before.day);
    assert.equal(after.cycles[0].status, "paid_out");
    assert.equal(after.cycles[0].payout.txId, "tx-after-retry");
    assert.equal(attempts, 2);
  });

  it("says so when there is nothing to do and does not pay again", async () => {
    await post("/api/tick");
    const s = await state();
    assert.ok(s.log.some((e: any) => /nothing to do/.test(e.text)));
    assert.equal(attempts, 2);
  });
});
