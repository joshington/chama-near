import { KeyPairSigner, yoctoToNear } from "near-api-js";
import { createNearAccount } from "./client.js";
import { loadNearConfig } from "./config.js";

// Run with: npm run near:check
// Proves the connection works AND that your private key can sign for your account.
const cfg = loadNearConfig();
const { account, provider } = createNearAccount(cfg);

console.log(`network:  ${cfg.network}`);
console.log(`rpc:      ${cfg.rpcUrl}`);
console.log(`account:  ${cfg.accountId}`);

const balance = await account.getBalance();
console.log(`balance:  ${yoctoToNear(balance, 4)} NEAR`);

// Reading a balance needs no key. Sending money does, so test the key too.
const publicKey = (await KeyPairSigner.fromSecretKey(cfg.privateKey).getPublicKey()).toString();
console.log(`key in .env (public part): ${publicKey}`);

try {
  const info = await provider.viewAccessKey({ accountId: cfg.accountId, publicKey, finalityQuery: { finality: "final" } });
  const perm = info.permission === "FullAccess" ? "full access" : "LIMITED (function-call only): cannot send NEAR";
  console.log(`key check: OK, this key is registered on ${cfg.accountId} (${perm})`);
  if (info.permission !== "FullAccess") process.exitCode = 1;
} catch {
  console.log(`key check: FAILED. This key is NOT registered on ${cfg.accountId}.`);
  console.log("Payouts will fail. Re-export the key for this exact account (see GUIDE.md) and fix NEAR_PRIVATE_KEY in .env.");
  process.exitCode = 1;
}
