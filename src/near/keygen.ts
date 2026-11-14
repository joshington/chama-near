import { KeyPair, keyToImplicitAddress } from "near-api-js";

// Run with: npm run near:keygen -- 4
// Makes N throwaway ed25519 keys and their implicit account ids (64 hex characters).
// An implicit account exists as soon as someone sends it NEAR, so these work as demo
// chama members without creating named accounts. Testnet only: do not reuse these keys.
const count = Number(process.argv[2] ?? 1);
if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error("pass a number between 1 and 20");

for (let i = 0; i < count; i++) {
  const key = KeyPair.fromRandom("ed25519");
  console.log(`# key ${i + 1}`);
  console.log(`account:     ${keyToImplicitAddress(key.getPublicKey())}`);
  console.log(`private key: ${key.toString()}\n`);
}
