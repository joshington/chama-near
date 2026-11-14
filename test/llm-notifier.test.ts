import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createLlmNotifier, parseLanguages } from "../src/llm-notifier.ts";
import type { Notifier } from "../src/types.ts";

function collector(): { notifier: Notifier; got: { member: string; message: string }[] } {
  const got: { member: string; message: string }[] = [];
  return { got, notifier: { send: async (member, message) => void got.push({ member, message }) } };
}

const reply = (text: string): typeof fetch =>
  (async () => new Response(JSON.stringify({ content: [{ type: "text", text }] }), { status: 200 })) as typeof fetch;

const original = "Reminder: 0.10 NEAR is due soon for cycle 2.";

describe("createLlmNotifier", () => {
  it("passes English or unlisted members through without calling the API", async () => {
    const { notifier, got } = collector();
    let calls = 0;
    const n = createLlmNotifier(notifier, {
      apiKey: "k",
      languageFor: (m) => (m === "bob" ? "English" : undefined),
      fetchFn: (async () => void calls++) as unknown as typeof fetch,
    });
    await n.send("bob", original);
    await n.send("zed", original);
    assert.equal(calls, 0);
    assert.deepEqual(got.map((g) => g.message), [original, original]);
  });

  it("uses the rewritten message when every number is kept", async () => {
    const { notifier, got } = collector();
    const translated = "Kujjukiza: 0.10 NEAR ejja okusasulwa mu cycle 2.";
    const n = createLlmNotifier(notifier, { apiKey: "k", languageFor: () => "Luganda", fetchFn: reply(translated) });
    await n.send("alice", original);
    assert.equal(got[0]?.message, translated);
  });

  it("falls back to the original if the model changes a number", async () => {
    const { notifier, got } = collector();
    const n = createLlmNotifier(notifier, {
      apiKey: "k",
      languageFor: () => "Luganda",
      fetchFn: reply("Kujjukiza: 1.00 NEAR ejja okusasulwa mu cycle 2."),
    });
    await n.send("alice", original);
    assert.equal(got[0]?.message, original);
  });

  it("falls back on HTTP errors and network failures", async () => {
    for (const fetchFn of [
      (async () => new Response("no", { status: 500 })) as typeof fetch,
      (async () => {
        throw new Error("offline");
      }) as typeof fetch,
    ]) {
      const { notifier, got } = collector();
      await createLlmNotifier(notifier, { apiKey: "k", languageFor: () => "Swahili", fetchFn }).send("a", original);
      assert.equal(got[0]?.message, original);
    }
  });

  it("sends the key and message in the request", async () => {
    const { notifier } = collector();
    let seen: { headers: Record<string, string>; body: { model: string; messages: { content: string }[] } } | undefined;
    const fetchFn = (async (_url: string, init: RequestInit) => {
      seen = {
        headers: init.headers as Record<string, string>,
        body: JSON.parse(init.body as string),
      };
      return new Response(JSON.stringify({ content: [{ type: "text", text: original }] }), { status: 200 });
    }) as unknown as typeof fetch;
    await createLlmNotifier(notifier, { apiKey: "secret", languageFor: () => "Luganda", fetchFn }).send("a", original);
    assert.equal(seen?.headers["x-api-key"], "secret");
    assert.equal(seen?.body.model, "claude-haiku-5-5");
    assert.match(seen?.body.messages[0]?.content ?? "", /Luganda/);
    assert.match(seen?.body.messages[0]?.content ?? "", /0\.10 NEAR/);
  });
});

describe("parseLanguages", () => {
  it("reads member=language pairs", () => {
    const f = parseLanguages("alice.testnet=Luganda, bob.testnet = Swahili");
    assert.equal(f("alice.testnet"), "Luganda");
    assert.equal(f("bob.testnet"), "Swahili");
    assert.equal(f("x"), undefined);
    assert.equal(parseLanguages(undefined)("a"), undefined);
  });
});
