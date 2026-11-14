import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkPayoutPolicy,
  cycleDueMs,
  cycleOf,
  isLate,
  lateFee,
  recipientFor,
  validateRules,
} from "../src/rules.ts";
import type { ChamaRules, Contribution } from "../src/types.ts";

const DAY = 86_400_000;
export const rules: ChamaRules = {
  name: "Test Chama",
  members: ["a.near", "b.near", "c.near"],
  contribution: 1000,
  startMs: 0,
  cycleMs: 7 * DAY,
  graceMs: DAY,
  lateFeeBps: 1000,
};

const fullCycle = (cycle: number): Contribution[] =>
  rules.members.map((member) => ({ member, cycle, amount: 1000, fee: 0, at: cycle * 7 * DAY }));

describe("validateRules", () => {
  it("accepts valid rules", () => {
    assert.doesNotThrow(() => validateRules(rules));
  });
  it("rejects bad input", () => {
    assert.throws(() => validateRules({ ...rules, members: ["a.near"] }), /at least 2/);
    assert.throws(() => validateRules({ ...rules, members: ["a.near", "a.near"] }), /duplicate/);
    assert.throws(() => validateRules({ ...rules, contribution: 0 }), /positive/);
    assert.throws(() => validateRules({ ...rules, contribution: 10.5 }), /integer/);
    assert.throws(() => validateRules({ ...rules, graceMs: 7 * DAY }), /graceMs/);
    assert.throws(() => validateRules({ ...rules, lateFeeBps: 20_000 }), /lateFeeBps/);
  });
});

describe("cycles", () => {
  it("maps time to a cycle and caps at the last one", () => {
    assert.equal(cycleOf({ ...rules, startMs: 100 }, 50), -1);
    assert.equal(cycleOf(rules, 0), 0);
    assert.equal(cycleOf(rules, 7 * DAY), 1);
    assert.equal(cycleOf(rules, 100 * DAY), 2);
  });
  it("rotates recipients in member order", () => {
    assert.equal(recipientFor(rules, 0), "a.near");
    assert.equal(recipientFor(rules, 2), "c.near");
    assert.throws(() => recipientFor(rules, 3), /outside the rotation/);
  });
});

describe("late fees", () => {
  it("charges nothing within the grace period and a fee after it", () => {
    const due = cycleDueMs(rules, 0);
    assert.equal(isLate(rules, 0, due + DAY), false);
    assert.equal(lateFee(rules, 0, due + DAY), 0);
    assert.equal(isLate(rules, 0, due + DAY + 1), true);
    assert.equal(lateFee(rules, 0, due + DAY + 1), 100);
  });
});

describe("checkPayoutPolicy", () => {
  const req = { cycle: 0, recipient: "a.near", amount: 3000, at: 0 };

  it("allows a correct payout for a fully funded cycle", () => {
    assert.equal(checkPayoutPolicy(rules, fullCycle(0), [], req), null);
  });
  it("blocks the wrong recipient", () => {
    assert.match(checkPayoutPolicy(rules, fullCycle(0), [], { ...req, recipient: "b.near" }) ?? "", /not the recipient/);
  });
  it("blocks the wrong amount", () => {
    assert.match(checkPayoutPolicy(rules, fullCycle(0), [], { ...req, amount: 3001 }) ?? "", /does not match the pot/);
  });
  it("blocks an underfunded cycle and names who is missing", () => {
    const partial = fullCycle(0).slice(0, 2);
    assert.match(checkPayoutPolicy(rules, partial, [], req) ?? "", /missing: c\.near/);
  });
  it("blocks a double payout", () => {
    const paid = [{ ...req, txId: "t1" }];
    assert.match(checkPayoutPolicy(rules, fullCycle(0), paid, req) ?? "", /already paid out/);
  });
  it("blocks a cycle outside the rotation", () => {
    assert.match(checkPayoutPolicy(rules, [], [], { ...req, cycle: 9 }) ?? "", /outside the rotation/);
  });
});
