# Chama on NEAR

**A savings group (chama) run by an AI treasurer that cannot step outside the rules.**

Members contribute every cycle, one member takes the whole pot, and an agent checks who has paid, reminds people who are late, and sends the payout as a real NEAR transfer, but only when the group's rules allow it.

Built for the [NEAR Hackathon](https://nearhackathon.com/). Tracks: **Social Money** and **Real-World Money**.

| | |
|---|---|
| Demo video | `https://x.com/bosa_josh/status/2121604676579737905` |
| Announcement on X | https://x.com/bosa_josh/status/2121604676579737905` |
| Live payout on NEAR testnet | [View the transaction](https://testnet.nearblocks.io/txns/9rL2JExLNgiesyzYmLFZvUyc3aMYVMMsAgaSuSMELFhg): 0.4 NEAR, cycle 1 payout |
| Treasury account (testnet) | `josh-chama.testnet` |

## The problem

Across Africa, people save together. In Uganda's FinScope 2023 survey, village savings groups were the most common way people save (47%), and merry-go-round groups, where members take turns receiving the pot, were used by 9% ([Daily Monitor](https://www.monitor.co.ug/uganda/business/finance/60-of-ugandans-are-saving-says-2023-finscope-report-4587790)). In the World Bank's Global Findex 2021, only 23% of adults in Sub-Saharan Africa saved formally ([World Bank](https://www.worldbank.org/en/publication/globalfindex/brief/data-from-the-global-findex-2021-financial-wellbeing-in-sub-saharan-africa)). Chamas, SACCOs and rotating savings groups fill that gap.

They work because of trust, and trust is also where they break:

- One person, the treasurer, holds the money. If they disappear, the group's savings go with them.
- Records live in a notebook or a WhatsApp chat, so "who paid?" becomes an argument.
- Chasing late members is awkward, personal work that falls on one volunteer.

## The solution

Chama on NEAR replaces the single point of trust with rules the treasurer cannot bend.

1. A group sets its rules: members and rotation order, contribution amount, cycle length, grace period and late fee.
2. Each cycle, members contribute. The agent keeps a ledger anyone in the group can see.
3. As the due date nears, the agent sends reminders. After the grace period, it flags late members, charges the late fee to the group reserve, and tells the whole group the payout is on hold.
4. When everyone has paid, the agent pays the pot to that cycle's recipient as a real NEAR transfer, and records the transaction.

**AI where it is safe, rules where it is money.** Every decision about money is made by deterministic rules. The optional language model only writes the reminders, in the member's own language, and its output is discarded if it changes a single number.

## What the agent can and cannot do

A payout policy checks every payout before any money moves. It blocks:

- paying anyone other than that cycle's recipient
- paying any amount other than the full pot
- paying a cycle that is not fully funded
- paying the same cycle twice

If a transfer fails, it is never recorded, so it can be retried. The ledger is saved to disk, so restarting the app cannot pay a cycle twice, and two overlapping requests cannot either.

## Why NEAR

- **Cheap, fast transfers** make small, frequent group contributions practical.
- **Implicit accounts**: a member can receive funds with just a key, with no bank account or sign-up step. Our demo members are such accounts.
- **Roadmap fit**: SputnikDAO for on-chain group governance and NEAR Intents for contributions from any chain (see "What we did not build yet").

## What works today

- **Web app** (`npm start`): a phone-friendly page showing each cycle, who has paid, the agent's activity and payout transaction links. Simulation mode needs no setup.
- **Rules and payout policy** (`src/rules.ts`): cycles, rotation, late fees, and the payout gate.
- **Treasurer agent** (`src/agent.ts`): wakes every simulated day, pays funded cycles, sends due-soon and late reminders once each, and announces a held cycle.
- **Real payouts on NEAR testnet** (`src/near-treasury.ts`, `CHAMA_MODE=live`): after the policy approves, a real transfer is sent and its transaction hash stored. Verified on testnet; see the transaction link above.
- **Reminders in the member's language** (`src/llm-notifier.ts`, optional): Claude rewrites reminders (for example in Luganda or Swahili). Falls back to English if the call fails or any number changes.
- **Resilient and safe**: automatic retry only when the connection to NEAR could not be opened; for any other error it stops and asks you to check the explorer, because a blind retry could pay twice.
- **44 automated tests** (`npm test`), no network needed.

## What we did not build yet

Being straight about the edges of this prototype:

- **Contributions are recorded in the app, not detected on-chain.** A "Mark as paid" click stands in for a member's deposit. Detecting deposits needs an indexer.
- **Time is simulated**, so a demo does not take weeks. Only the payout transfers are real.
- **Testnet only.** Do not use real funds. The agent's key is a full-access key held by the app, and the payout policy is enforced in application code, not on-chain.
- The Claude reminder rewriting has been tested with a mocked API, not yet against the live Claude API. Have a native speaker check translations before relying on them.
- **Next:** a SputnikDAO treasury so the rules and money live on-chain, NEAR Intents deposits, a Telegram or WhatsApp bot so members never need a wallet, mobile-money on and off ramps (M-Pesa, MTN MoMo), member loans, and a private reputation score.

## Run it

Requires Node 22.9 or newer.

```bash
npm install
npm test                    # 44 tests, no network
npm start                   # web app at http://localhost:3000, simulation mode
npm run demo                # same logic in the terminal
```

For real testnet payouts, set up an account and a `.env` file (see [GUIDE.md](GUIDE.md)), then:

```bash
npm run near:check          # proves the connection and that your key can sign
CHAMA_MODE=live npm start   # real payouts on NEAR testnet
```

[GUIDE.md](GUIDE.md) explains every file, the testnet setup, and what to do if a payout fails.

## Security notes

- Never commit `.env` (it holds your private key). It is in `.gitignore`.
- The server listens on localhost only, because live mode can move testnet funds.
- POST requests must be JSON, which blocks cross-site form attacks.

## Sources

- Daily Monitor, [60% of Ugandans are saving, says 2023 FinScope report](https://www.monitor.co.ug/uganda/business/finance/60-of-ugandans-are-saving-says-2023-finscope-report-4587790)
- World Bank, [Global Findex 2021: Financial wellbeing in Sub-Saharan Africa](https://www.worldbank.org/en/publication/globalfindex/brief/data-from-the-global-findex-2021-financial-wellbeing-in-sub-saharan-africa)
