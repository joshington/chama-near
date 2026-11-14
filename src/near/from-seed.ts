import { createInterface } from "node:readline/promises";
import { parseSeedPhrase } from "near-api-js/seed-phrase";

// Run with: npm run near:from-seed -- ed25519:<the PUBLIC key shown on the explorer>
// Turns your wallet's 12-word recovery phrase into the private key for NEAR_PRIVATE_KEY.
// Runs only on your computer. Never paste your recovery phrase into a chat or a website.
const expected = process.argv[2];
if (!expected?.startsWith("ed25519:")) {
  throw new Error("Pass the public key from the explorer, e.g. npm run near:from-seed -- ed25519:DeZB...");
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const phrase = (await rl.question("Type or paste your recovery phrase, then press Enter: ")).trim().replace(/\s+/g, " ");
rl.close();

const key = parseSeedPhrase(phrase);
const derived = key.getPublicKey().toString();
console.log(`\nderived public key: ${derived}`);

if (derived === expected) {
  console.log("MATCH: this phrase controls the key your account accepts.\n");
  console.log("Put this in .env as NEAR_PRIVATE_KEY (keep it secret):");
  console.log(key.toString());
} else {
  console.log(`NO MATCH with ${expected}. Either this phrase belongs to a different account/wallet, or the account's key was`);
  console.log("created another way. Do not use this key. Try another phrase, or see the other options in the guide.");
  process.exitCode = 1;
}
