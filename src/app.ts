import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { TreasurerAgent } from "./agent.js";
import { cycleDueMs, cycleOf, recipientFor } from "./rules.js";
import type { SimulatedTreasury } from "./treasury.js";
import type { ChamaRules, Notifier } from "./types.js";

const DAY = 86_400_000;
const MAX_BODY = 10_000;

export interface AppDeps {
  rules: ChamaRules;
  mode: "sim" | "live";
  /** Builds a fresh treasury. Called at start and on reset (reset is simulation-only). */
  makeTreasury: () => SimulatedTreasury;
  /** Lets the caller wrap the logging notifier, e.g. with the language-model rewriter. */
  wrapNotifier?: (inner: Notifier) => Notifier;
  formatAmount: (minor: number) => string;
  explorerTxUrl?: (txId: string) => string;
  /** Where the page HTML lives. */
  htmlPath: string;
}

interface LogEntry {
  day: number;
  kind: "member" | "agent" | "system";
  text: string;
}

export type CycleStatus = "paid_out" | "open" | "late" | "funded" | "future";

export function createApp(deps: AppDeps): Server {
  const { rules } = deps;
  const html = readFileSync(deps.htmlPath, "utf8");

  let now = rules.startMs;
  let log: LogEntry[] = [];
  let treasury = deps.makeTreasury();
  let agent!: TreasurerAgent;
  const day = (): number => Math.round(((now - rules.startMs) / DAY) * 10) / 10;
  const push = (kind: LogEntry["kind"], text: string): void => {
    log.unshift({ day: day(), kind, text });
    log = log.slice(0, 200);
  };

  const build = async (): Promise<void> => {
    const logging: Notifier = { send: async (member, message) => push("agent", `To ${member}: ${message}`) };
    agent = new TreasurerAgent(rules, treasury, deps.wrapNotifier?.(logging) ?? logging, deps.formatAmount);
    // Resume the clock from a saved ledger so a restart does not travel back in time.
    const times = [...(await treasury.listContributions()), ...(await treasury.listPayouts())].map((e) => e.at);
    now = Math.max(rules.startMs, ...times);
  };

  /** Runs the agent once and returns how many things it did (-1 if it hit an error). */
  const runAgent = async (): Promise<number> => {
    try {
      const actions = await agent.tick(now);
      for (const a of actions) {
        if (a.type === "payout") push("agent", `Paid cycle ${a.cycle + 1}: ${deps.formatAmount(a.amount)} to ${a.recipient} (${a.txId})`);
        if (a.type === "blocked") push("system", `Payout blocked by policy: ${a.reason}`);
      }
      return actions.length;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      push(
        "system",
        `Agent error: ${msg}. The payout was not recorded. Press "Run agent now" to retry. ` +
          `If the error mentions fetch or network, check your connection first; if you are unsure whether a transfer was sent, look at the treasury account on the explorer before retrying.`,
      );
      return -1;
    }
  };

  // One request at a time, so two clicks can never run the agent twice at once.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(fn, fn);
    queue = next.catch(() => undefined);
    return next;
  };

  async function state() {
    const contributions = await treasury.listContributions();
    const payouts = await treasury.listPayouts();
    const current = cycleOf(rules, now);
    const cycles = rules.members.map((_, c) => {
      const paid = new Set(contributions.filter((x) => x.cycle === c).map((x) => x.member));
      const payout = payouts.find((p) => p.cycle === c);
      const due = cycleDueMs(rules, c);
      let status: CycleStatus;
      if (payout) status = "paid_out";
      else if (c > current) status = "future";
      else if (paid.size === rules.members.length) status = "funded";
      else if (now > due + rules.graceMs) status = "late";
      else status = "open";
      return {
        cycle: c,
        recipient: recipientFor(rules, c),
        dueDay: Math.round(((due - rules.startMs) / DAY) * 10) / 10,
        status,
        members: rules.members.map((m) => ({ member: m, paid: paid.has(m) })),
        payout: payout
          ? { txId: payout.txId, amount: deps.formatAmount(payout.amount), url: deps.explorerTxUrl?.(payout.txId) ?? null }
          : null,
      };
    });
    return {
      name: rules.name,
      mode: deps.mode,
      day: day(),
      currentCycle: current,
      contribution: deps.formatAmount(rules.contribution),
      pot: deps.formatAmount(rules.contribution * rules.members.length),
      reserve: deps.formatAmount(treasury.reserve),
      cycles,
      log,
    };
  }

  const json = (res: ServerResponse, code: number, body: unknown): void => {
    res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };

  const readJson = (req: IncomingMessage): Promise<Record<string, unknown>> =>
    new Promise((resolve, reject) => {
      let size = 0;
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => {
        size += c.length;
        if (size > MAX_BODY) {
          reject(new Error("body too large"));
          req.destroy();
        } else chunks.push(c);
      });
      req.on("end", () => {
        try {
          const v: unknown = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
          resolve(v && typeof v === "object" ? (v as Record<string, unknown>) : {});
        } catch {
          reject(new Error("invalid JSON"));
        }
      });
      req.on("error", reject);
    });

  const ready = build();

  return createServer(async (req, res) => {
    try {
      await ready;
      const url = new URL(req.url ?? "/", "http://localhost");

      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        return void res.end(html);
      }
      if (req.method === "GET" && url.pathname === "/api/state") return json(res, 200, await serial(state));

      if (req.method === "POST") {
        // A browser form on another site cannot send JSON, so this blocks cross-site posts.
        if (!(req.headers["content-type"] ?? "").startsWith("application/json")) {
          return json(res, 415, { error: "content-type must be application/json" });
        }
        const body = await readJson(req);

        if (url.pathname === "/api/contribute") {
          const member = String(body.member ?? "");
          const cycle = Number(body.cycle);
          return json(
            res,
            200,
            await serial(async () => {
              if (!Number.isInteger(cycle) || cycle < 0 || cycle > cycleOf(rules, now)) {
                throw new HttpError(400, "that cycle has not started yet");
              }
              try {
                await treasury.recordContribution(member, cycle, now);
              } catch (e) {
                throw new HttpError(400, e instanceof Error ? e.message : "could not record");
              }
              push("member", `${member} contributed ${deps.formatAmount(rules.contribution)} for cycle ${cycle + 1}`);
              await runAgent();
              return state();
            }),
          );
        }

        if (url.pathname === "/api/advance") {
          const days = Number(body.days);
          if (!Number.isInteger(days) || days < 1 || days > 14) throw new HttpError(400, "days must be 1 to 14");
          return json(
            res,
            200,
            await serial(async () => {
              for (let i = 0; i < days; i++) {
                now += DAY;
                await runAgent(); // the agent wakes up every day
              }
              return state();
            }),
          );
        }

        if (url.pathname === "/api/tick") {
          return json(
            res,
            200,
            await serial(async () => {
              if ((await runAgent()) === 0) push("agent", "Agent checked the chama: nothing to do right now.");
              return state();
            }),
          );
        }

        if (url.pathname === "/api/reset") {
          if (deps.mode !== "sim") throw new HttpError(403, "reset is only available in simulation mode");
          return json(
            res,
            200,
            await serial(async () => {
              treasury = deps.makeTreasury();
              log = [];
              await build();
              now = rules.startMs;
              push("system", "Chama reset");
              return state();
            }),
          );
        }
      }
      json(res, 404, { error: "not found" });
    } catch (e) {
      if (e instanceof HttpError) return json(res, e.code, { error: e.message });
      json(res, 400, { error: e instanceof Error ? e.message : "bad request" });
    }
  });
}

class HttpError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}


