import type { Notifier } from "./types.js";

export interface LlmNotifierOptions {
  apiKey: string;
  /** Language to write to each member, e.g. "Luganda". Members not listed get the original English text. */
  languageFor: (member: string) => string | undefined;
  model?: string;
  /** Injectable so tests need no network. */
  fetchFn?: typeof fetch;
}

const numbersIn = (s: string): string[] => s.match(/\d+(?:[.,]\d+)?/g) ?? [];

/**
 * Wraps another notifier and rewrites reminders in the member's own language using Claude.
 * The language model only changes the WORDS. The rules and the money are decided elsewhere.
 * Any failure (no network, bad reply, a number that went missing) falls back to the original
 * English message, so a reminder is never lost and never shows a wrong amount.
 */
export function createLlmNotifier(inner: Notifier, opts: LlmNotifierOptions): Notifier {
  const doFetch = opts.fetchFn ?? fetch;
  const model = opts.model ?? "claude-haiku-5-5";

  return {
    async send(member, message) {
      const language = opts.languageFor(member);
      if (!language || language.toLowerCase() === "english") return inner.send(member, message);

      try {
        const res = await doFetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": opts.apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model,
            max_tokens: 300,
            messages: [
              {
                role: "user",
                content:
                  `Rewrite this savings-group message in ${language}. Keep it short, friendly and clear. ` +
                  `Keep every number, amount, account name and transaction id exactly as written. ` +
                  `Reply with the message only.\n\n${message}`,
              },
            ],
          }),
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { content?: { type: string; text?: string }[] };
        const text = data.content?.find((c) => c.type === "text")?.text?.trim();
        if (!text) throw new Error("empty reply");

        const out = numbersIn(text);
        if (!numbersIn(message).every((n) => out.includes(n))) throw new Error("numbers changed");
        return inner.send(member, text);
      } catch {
        return inner.send(member, message);
      }
    },
  };
}

/** Parses "alice.testnet=Luganda,bob.testnet=Swahili" into a lookup. */
export function parseLanguages(spec: string | undefined): (member: string) => string | undefined {
  const map = new Map<string, string>();
  for (const part of (spec ?? "").split(",")) {
    const [member, lang] = part.split("=").map((s) => s.trim());
    if (member && lang) map.set(member, lang);
  }
  return (member) => map.get(member);
}
