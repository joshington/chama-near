import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { TreasurerAgent } from "../src/agent.ts";
import { AccountPayer, isConnectFailure, NearTreasury, type Payer } from "../src/near-treasury.ts";
import { PolicyViolation, SimulatedTreasury } from "../src/treasury.ts";
import type { ChamaRules } from "../src/types.ts";

const DAY = 86_400_000;
const rules: ChamaRules = {
  name: "Test Chama",
  members: ["a.testnet", "b.testnet", "c.testnet"],
  contribution: 1000,
  startMs: 0,
  cycleMs: 7 * DAY,
  graceMs: DAY,
  lateFeeBps: 1000,
};
const SCALE = 100_000_000_000_000_000_000n; // 1e20 yocto per minor unit

function fakePayer(): { payer: Payer; sent: { to: string; yocto: bigint }[] } {
  const sent: { to: string; yocto: bigint }[] = [];
  return {
    sent,
    payer: {
      async transfer(to, yocto) {
        sent.push({ to, yocto });
        return `tx-${sent.length}`;
      },
    },
  };
}

async function fund(t: SimulatedTreasury, cycle: number): Promise<void> {
  for (const m of rules.members) await t.recordContribution(m, cycle, cycle * 7 * DAY + DAY);
}

describe("NearTreasury", () => {
  it("pays the right recipient the right amount in yoctoNEAR and records the tx id", async () => {
    const { payer, sent } = fakePayer();
    const t = new NearTreasury(rules, payer, { yoctoPerMinorUnit: SCALE });
    await fund(t, 0);
    const p = await t.sendPayout({ cycle: 0, recipient: "a.testnet", amount: 3000, at: 2 * DAY });
    assert.equal(p.txId, "tx-1");
    assert.deepEqual(sent, [{ to: "a.testnet", yocto: 3000n * SCALE }]);
  });

  it("never reaches the payer when the policy blocks the payout", async () => {
    const { payer, sent } = fakePayer();
    const t = new NearTreasury(rules, payer, { yoctoPerMinorUnit: SCALE });
    await t.recordContribution("a.testnet", 0, DAY); // underfunded
    await assert.rejects(t.sendPayout({ cycle: 0, recipient: "a.testnet", amount: 3000, at: DAY }), PolicyViolation);
    await fund(new NearTreasury(rules, payer, { yoctoPerMinorUnit: SCALE }), 1);
    assert.equal(sent.length, 0);
  });

  it("does not record a payout if the transfer fails, so the agent can retry", async () => {
    let fail = true;
    const payer: Payer = {
      async transfer() {
        if (fail) throw new Error("rpc down");
        return "tx-ok";
      },
    };
    const t = new NearTreasury(rules, payer, { yoctoPerMinorUnit: SCALE });
    await fund(t, 0);
    const req = { cycle: 0, recipient: "a.testnet", amount: 3000, at: 2 * DAY };
    await assert.rejects(t.sendPayout(req), /rpc down/);
    assert.equal((await t.listPayouts()).length, 0);
    fail = false;
    assert.equal((await t.sendPayout(req)).txId, "tx-ok");
  });

  it("blocks a second payout for the same cycle even while the first is in flight", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    const payer: Payer = {
      async transfer() {
        calls++;
        await gate;
        return "tx-1";
      },
    };
    const t = new NearTreasury(rules, payer, { yoctoPerMinorUnit: SCALE });
    await fund(t, 0);
    const req = { cycle: 0, recipient: "a.testnet", amount: 3000, at: 2 * DAY };
    const first = t.sendPayout(req);
    await assert.rejects(t.sendPayout(req), /already in progress/);
    release();
    await first;
    assert.equal(calls, 1);
  });
});

describe("ledger persistence", () => {
  it("survives a restart without paying the same cycle twice", async () => {
    const dir = mkdtempSync(join(tmpdir(), "chama-"));
    const ledgerPath = join(dir, "ledger.json");
    try {
      const { payer, sent } = fakePayer();
      const t1 = new NearTreasury(rules, payer, { yoctoPerMinorUnit: SCALE, ledgerPath });
      await fund(t1, 0);
      await new TreasurerAgent(rules, t1, { send: async () => {} }).tick(2 * DAY);
      assert.equal(sent.length, 1);

      // "Restart": a brand-new treasury and agent read the same ledger file.
      const t2 = new NearTreasury(rules, payer, { yoctoPerMinorUnit: SCALE, ledgerPath });
      const actions = await new TreasurerAgent(rules, t2, { send: async () => {} }).tick(3 * DAY);
      assert.deepEqual(actions, []);
      assert.equal(sent.length, 1);
      assert.equal((await t2.listPayouts()).length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("AccountPayer retries", () => {
  const withCode = (code: string) => Object.assign(new TypeError("fetch failed"), { cause: { code } });
  const ok = { transaction_outcome: { id: "tx-real" } };

  it("retries when the connection could not be opened, then succeeds", async () => {
    let calls = 0;
    const payer = new AccountPayer(
      {
        async transfer() {
          if (++calls < 3) throw withCode("UND_ERR_CONNECT_TIMEOUT");
          return ok;
        },
      },
      { backoffMs: 0 },
    );
    assert.equal(await payer.transfer("a.testnet", 5n), "tx-real");
    assert.equal(calls, 3);
  });

  it("does NOT retry an error where the transfer may already have been sent", async () => {
    let calls = 0;
    const payer = new AccountPayer(
      {
        async transfer() {
          calls++;
          throw withCode("ECONNRESET");
        },
      },
      { backoffMs: 0 },
    );
    await assert.rejects(payer.transfer("a.testnet", 5n), /fetch failed/);
    assert.equal(calls, 1);
  });

  it("gives up after the attempt limit", async () => {
    let calls = 0;
    const payer = new AccountPayer(
      {
        async transfer() {
          calls++;
          throw withCode("UND_ERR_CONNECT_TIMEOUT");
        },
      },
      { attempts: 3, backoffMs: 0 },
    );
    await assert.rejects(payer.transfer("a.testnet", 5n));
    assert.equal(calls, 3);
  });

  it("classifies errors", () => {
    assert.equal(isConnectFailure(withCode("ENOTFOUND")), true);
    assert.equal(isConnectFailure(withCode("ECONNRESET")), false);
    assert.equal(isConnectFailure(new Error("Access key does not exist")), false);
    assert.equal(isConnectFailure(null), false);
  });
});
