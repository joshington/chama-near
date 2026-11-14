# Guide: every file, then your testnet steps

## The idea in one paragraph
A chama is a group where everyone pays the same amount each cycle and one member takes the whole pot, in rotation. Here an agent plays treasurer: it checks who has paid, pays the pot to the right member once everyone has contributed, reminds late members, and cannot pay outside the rules.

## Files, one by one

### `src/types.ts`: the vocabulary
Plain data shapes used everywhere: `ChamaRules` (members, contribution, cycle length, grace period, late fee), `Contribution`, `Payout`, `PayoutRequest`, `Notifier` (how messages reach members) and `AgentAction` (what the agent did). Amounts are integers in "minor units" (2000 = 20.00) so there are no rounding bugs. Times are epoch milliseconds.

### `src/rules.ts`: the rules engine (no I/O, pure functions)
- `validateRules`: rejects bad groups (under 2 members, duplicates, zero contribution, bad grace/fee).
- `cycleOf`, `cycleDueMs`, `recipientFor`: which cycle is running, when it is due, who gets the pot (member `i` gets cycle `i`).
- `isLate`, `lateFee`: late after due date + grace; fee is a percentage (basis points) of the contribution.
- `checkPayoutPolicy`: **the safety gate.** Returns `null` if a payout is allowed, otherwise the reason. It blocks: wrong recipient, wrong amount, cycle not fully funded, double payout, cycle outside the rotation.

### `src/treasury.ts`: the ledger and the gate
- `Treasury` interface: the only thing the agent talks to.
- `SimulatedTreasury`: keeps contributions and payouts, applies late fees to a reserve, and runs `checkPayoutPolicy` before every payout. It takes an optional `settle` function (how money really moves) and an optional `ledgerPath` (saves to a JSON file so a restart cannot pay a cycle twice). It also locks a cycle while its payout is in flight, so two overlapping runs cannot double pay.

### `src/agent.ts`: the AI treasurer
`TreasurerAgent.tick(now)` looks at every cycle up to now. Fully funded and unpaid: pay out and notify the recipient. Close to due: one "due soon" reminder per member. Past due plus grace: one "late" reminder per member, and one "payout on hold" message to the whole group. Each message is sent only once. It acts only through the treasury, so the policy gate always applies. Note: this version is rule-based; there is no language model inside it yet.

### `src/near-treasury.ts`: the NEAR connection for payouts
`NearTreasury` is the simulated treasury with a real `settle`: after the policy approves, it sends a real NEAR transfer from your treasury account and stores the transaction hash. `AccountPayer` wraps near-api-js. `Payer` is a tiny interface so tests can use a fake one. **Contributions are still recorded in the ledger, not detected on-chain.**

### `src/near/config.ts`, `client.ts`: settings and connection
`config.ts` reads environment variables (`.env`): network, RPC URL, treasury account id, private key, and the scale from minor units to NEAR. `client.ts` builds the near-api-js provider, signer and account.

### `src/near/check.ts` (`npm run near:check`)
Connects to testnet and prints your account's balance. Run this first; if it works, your account and key are set up correctly.

### `src/near/keygen.ts` (`npm run near:keygen -- 3`)
Makes throwaway keys and their implicit account ids (64 hex characters). An implicit account exists once someone sends it NEAR, so these work as demo members.

### `src/demo.ts` (`npm run demo`)
No network. Plays 4 members over 4 cycles with one late payer. Good for a screen recording of the logic.

### `src/live-demo.ts` (`npm run demo:live`)
Needs `.env`. Records contributions for cycle 1 and lets the agent send the real testnet payout, then prints the transaction link. Time is simulated; the transfer is real.

### `src/app.ts`, `src/server.ts`, `src/web/index.html`: the web app
`server.ts` picks the mode (simulation by default, live testnet when `CHAMA_MODE=live`) and starts the app on localhost. `app.ts` is a small zero-dependency HTTP server: `GET /api/state`, `POST /api/contribute`, `POST /api/advance`, `POST /api/reset` (simulation only). Requests run one at a time so the agent can never run twice at once, POSTs must be JSON (blocks cross-site form posts), and it listens on 127.0.0.1 only because live mode can move testnet funds. Every time a member pays or a day passes, the agent runs. `index.html` is the phone-friendly page: cycles, who has paid, "Mark as paid" buttons, time controls, the agent's activity feed, and a transaction link for live payouts.

### `src/llm-notifier.ts`: reminders in the member's language
Optional. If `ANTHROPIC_API_KEY` and `LLM_LANGUAGES` are set, each reminder is rewritten in that member's language by Claude (model `claude-haiku-5-5`). The model only changes the words: if the reply is missing any number from the original, or the call fails, the original English message is sent. Not tested against the real API (my workspace has no network access to it), only with a mocked one. Have a native speaker check the translations before you show them.

### `test/*.test.ts` (`npm test`)
44 tests: rules, policy gate, agent behaviour, payout amounts, failed-transfer retry, double-payout lock, restart safety, the language rewriter (mocked), the web API (late member, duplicates, overlapping requests), and payout retries. They need no network.

### Config files
`package.json` (scripts and dependencies), `tsconfig.json` (strict TypeScript), `.env.example` (copy to `.env`), `.gitignore` (keeps `.env` and `ledger.json` out of git).

## Your testnet steps

1. **Install the CLI:** `npm install -g near-cli-rs@latest`
2. **Create the treasury account (free, funded by the faucet):**
   `near create-account YOURNAME-chama.testnet --useFaucet`
   Pick a unique name. It must end in `.testnet`. Follow the prompts to save the key. Write down any seed phrase and never share it.
3. **Get the private key:** `near account export-account YOURNAME-chama.testnet`
4. **Make the config:** `cp .env.example .env`, then set `NEAR_ACCOUNT_ID` and `NEAR_PRIVATE_KEY`.
5. **Check the connection:** `npm install` then `npm run near:check`. You should see a balance.
6. **Make members:** `npm run near:keygen -- 3`. Put the three account ids (comma-separated) in `CHAMA_MEMBERS` in `.env`.
7. **Run it:** `npm run demo:live`. Open the printed transaction link to see the payout on testnet.

If step 2 fails, tell me the exact error. Faucet rules change, and I could not test these steps from my side because my workspace cannot reach testnet.
8. **Run the web app:** `npm start`, then open http://localhost:3000. With no setup it runs in simulation. To make payouts real, set `CHAMA_MODE=live` in `.env` (with steps 1 to 6 done) and run `npm start` again. In live mode, only mark members as paid after you have funded the treasury account.

## If the live payout fails
- **"fetch failed" or a timeout in the activity feed:** your computer could not reach the NEAR RPC server. The payout was not recorded, so nothing is lost. The app retries by itself when the connection cannot be opened. If it still fails, press **Run agent now** to try again (this does not move time forward).
- **Still failing:** add `NEAR_RPC_URL=https://near-testnet.drpc.org` to `.env` (other options: `https://testnet-rpc.intea.rs`, `https://api.zan.top/near-testnet`), turn off any VPN, or try your phone's hotspot.
- **"Access key ... does not exist":** the private key in `.env` is not registered on the account. Run `npm run near:check`; it must say `key check: OK`. `npm run near:from-seed` can turn a wallet recovery phrase into the right key.
- **Not sure whether a transfer went through?** Open your treasury account on https://testnet.nearblocks.io and look at its Transactions tab before pressing Run agent now. The app only retries by itself when the connection never opened; for any other error it waits for you, because a second transfer would pay twice.

## Recording your demo (suggested order, about 90 seconds)
1. Show the page in simulation: two members pay, move time forward 7 days, the agent warns about the late member and holds the payout.
2. The late member pays: the agent pays out automatically and the 10% late fee appears in the reserve.
3. Switch to live mode and repeat cycle 1 with real testnet members. Show the payout transaction link opening on the explorer.
