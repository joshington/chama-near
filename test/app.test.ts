import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/app.ts";
import { SimulatedTreasury } from "../src/treasury.ts";
import type { ChamaRules } from "../src/types.ts";

const DAY = 86_400_000;
const rules: ChamaRules = {
  name: "API Test Chama",
  members: ["a.testnet", "b.testnet", "c.testnet"],
  contribution: 1000,
  startMs: Date.UTC(2026, 10, 16),
  cycleMs: 7 * DAY,
  graceMs: DAY,
  lateFeeBps: 1000,
};

const server = createApp({
  rules,
  mode: "sim",
  makeTreasury: () => new SimulatedTreasury(rules),
  formatAmount: (n) => `${(n / 100).toFixed(2)} USDC`,
  htmlPath: fileURLToPath(new URL("../src/web/index.html", import.meta.url)),
});
let base = "";

before(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => void server.close());

const post = (path: string, body: unknown = {}, type = "application/json") =>
  fetch(base + path, { method: "POST", headers: { "content-type": type }, body: JSON.stringify(body) });
const getState = async () => (await fetch(base + "/api/state")).json() as Promise<any>;

describe("web app API", () => {
  it("serves the page and the starting state", async () => {
    const page = await fetch(base + "/");
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Chama on NEAR/);
    const s = await getState();
    assert.equal(s.mode, "sim");
    assert.equal(s.cycles.length, 3);
    assert.equal(s.cycles[0].status, "open");
    assert.equal(s.cycles[1].status, "future");
    assert.equal(s.pot, "30.00 USDC");
  });

  it("pays the recipient automatically once everyone has contributed", async () => {
    await post("/api/reset");
    for (const m of rules.members) {
      const res = await post("/api/contribute", { member: m, cycle: 0 });
      assert.equal(res.status, 200);
    }
    const s = await getState();
    assert.equal(s.cycles[0].status, "paid_out");
    assert.match(s.cycles[0].payout.txId, /^sim-tx-/);
    assert.ok(s.log.some((e: any) => /Paid cycle 1/.test(e.text)));
  });

  it("rejects duplicates, non-members and cycles that have not started", async () => {
    await post("/api/reset");
    await post("/api/contribute", { member: "a.testnet", cycle: 0 });
    assert.equal((await post("/api/contribute", { member: "a.testnet", cycle: 0 })).status, 400);
    assert.equal((await post("/api/contribute", { member: "x.testnet", cycle: 0 })).status, 400);
    assert.equal((await post("/api/contribute", { member: "b.testnet", cycle: 2 })).status, 400);
    assert.equal((await post("/api/contribute", { member: "b.testnet", cycle: "zero" })).status, 400);
  });

  it("holds the payout for a late member, reminds, then pays after they contribute", async () => {
    await post("/api/reset");
    await post("/api/contribute", { member: "a.testnet", cycle: 0 });
    await post("/api/contribute", { member: "b.testnet", cycle: 0 });
    await post("/api/advance", { days: 6 }); // day 6: inside the last quarter of the cycle
    let s = await getState();
    assert.ok(s.log.some((e: any) => /due soon/.test(e.text)));
    await post("/api/advance", { days: 3 }); // day 9: past due + grace
    s = await getState();
    assert.equal(s.cycles[0].status, "late");
    assert.ok(s.log.some((e: any) => /is late/.test(e.text)));
    assert.ok(s.log.some((e: any) => /on hold/.test(e.text)));
    await post("/api/contribute", { member: "c.testnet", cycle: 0 });
    s = await getState();
    assert.equal(s.cycles[0].status, "paid_out");
    assert.equal(s.reserve, "1.00 USDC"); // 10% late fee on 10.00
  });

  it("validates advance input and blocks cross-site style posts", async () => {
    assert.equal((await post("/api/advance", { days: 0 })).status, 400);
    assert.equal((await post("/api/advance", { days: 99 })).status, 400);
    assert.equal((await post("/api/advance", { days: 1 }, "text/plain")).status, 415);
    assert.equal((await fetch(base + "/nope")).status, 404);
  });

  it("serialises overlapping requests so a cycle is paid exactly once", async () => {
    await post("/api/reset");
    await Promise.all(rules.members.map((m) => post("/api/contribute", { member: m, cycle: 0 })));
    await Promise.all([post("/api/advance", { days: 1 }), post("/api/advance", { days: 1 })]);
    const s = await getState();
    const payouts = s.cycles.filter((c: any) => c.status === "paid_out");
    assert.equal(payouts.length, 1);
  });
});
