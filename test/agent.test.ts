import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { TreasurerAgent } from "../src/agent.ts";
import { PolicyViolation, SimulatedTreasury } from "../src/treasury.ts";
import type { ChamaRules, Notifier } from "../src/types.ts";

const DAY = 86_400_000;
const rules: ChamaRules = {
  name: "Test Chama",
  members: ["a.near", "b.near", "c.near"],
  contribution: 1000,
  startMs: 0,
  cycleMs: 7 * DAY,
  graceMs: DAY,
  lateFeeBps: 1000,
};

let treasury: SimulatedTreasury;
let agent: TreasurerAgent;
let messages: { member: string; message: string }[];

beforeEach(() => {
  treasury = new SimulatedTreasury(rules);
  messages = [];
  const notifier: Notifier = {
    async send(member, message) {
      messages.push({ member, message });
    },
  };
  agent = new TreasurerAgent(rules, treasury, notifier);
});

describe("SimulatedTreasury", () => {
  it("rejects non-members and duplicate contributions", async () => {
    await assert.rejects(treasury.recordContribution("x.near", 0, DAY), /not a member/);
    await treasury.recordContribution("a.near", 0, DAY);
    await assert.rejects(treasury.recordContribution("a.near", 0, 2 * DAY), /already paid/);
  });

  it("adds late fees to the reserve", async () => {
    const c = await treasury.recordContribution("a.near", 0, 9 * DAY);
    assert.equal(c.fee, 100);
    assert.equal(treasury.reserve, 100);
  });

  it("refuses a payout that breaks the policy", async () => {
    await assert.rejects(
      treasury.sendPayout({ cycle: 0, recipient: "a.near", amount: 3000, at: DAY }),
      PolicyViolation,
    );
  });
});

describe("TreasurerAgent", () => {
  it("pays the recipient once the cycle is fully funded", async () => {
    for (const m of rules.members) await treasury.recordContribution(m, 0, DAY);
    const actions = await agent.tick(2 * DAY);
    assert.deepEqual(actions, [
      { type: "payout", cycle: 0, recipient: "a.near", amount: 3000, txId: "sim-tx-1" },
    ]);
    assert.equal(messages[0]?.member, "a.near");
  });

  it("does not pay twice on later ticks", async () => {
    for (const m of rules.members) await treasury.recordContribution(m, 0, DAY);
    await agent.tick(2 * DAY);
    assert.deepEqual(await agent.tick(3 * DAY), []);
    assert.equal((await treasury.listPayouts()).length, 1);
  });

  it("holds the payout while someone is missing and sends a due-soon reminder once", async () => {
    await treasury.recordContribution("a.near", 0, DAY);
    await treasury.recordContribution("b.near", 0, DAY);
    const first = await agent.tick(6 * DAY);
    assert.deepEqual(first, [{ type: "reminder", cycle: 0, member: "c.near", kind: "due_soon" }]);
    assert.deepEqual(await agent.tick(6.5 * DAY), []);
    assert.equal((await treasury.listPayouts()).length, 0);
  });

  it("sends late reminders and escalates exactly once after the grace period", async () => {
    await treasury.recordContribution("a.near", 0, DAY);
    await treasury.recordContribution("b.near", 0, DAY);
    const actions = await agent.tick(9 * DAY);
    assert.deepEqual(actions, [
      { type: "reminder", cycle: 0, member: "c.near", kind: "late" },
      { type: "escalate", cycle: 0, missing: ["c.near"] },
    ]);
    assert.deepEqual(await agent.tick(10 * DAY), []);
    assert.equal(messages.filter((m) => m.message.includes("on hold")).length, 3);
  });

  it("pays out after a late member finally contributes", async () => {
    await treasury.recordContribution("a.near", 0, DAY);
    await treasury.recordContribution("b.near", 0, DAY);
    await agent.tick(9 * DAY);
    await treasury.recordContribution("c.near", 0, 9.5 * DAY);
    const actions = await agent.tick(9.5 * DAY);
    assert.equal(actions[0]?.type, "payout");
    assert.equal(treasury.reserve, 100);
  });

  it("does nothing before the chama starts", async () => {
    const early = new TreasurerAgent({ ...rules, startMs: 10 * DAY }, treasury, { send: async () => {} });
    assert.deepEqual(await early.tick(DAY), []);
  });
});
