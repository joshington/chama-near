import type { KeyPairString } from "near-api-js";

export interface NearConfig {
  network: "testnet" | "mainnet";
  rpcUrl: string;
  accountId: string;
  privateKey: KeyPairString;
  /** How many yoctoNEAR one minor unit of the chama's currency is worth on testnet. */
  yoctoPerMinorUnit: bigint;
}

const DEFAULT_RPC = {
  testnet: "https://test.rpc.fastnear.com",
  mainnet: "https://free.rpc.fastnear.com",
} as const;

function required(env: NodeJS.ProcessEnv, name: string): string {
  const v = env[name];
  if (!v) throw new Error(`Missing ${name}. Copy .env.example to .env and fill it in.`);
  return v;
}

/** Reads settings from environment variables. Never log the private key. */
export function loadNearConfig(env: NodeJS.ProcessEnv = process.env): NearConfig {
  const network = (env.NEAR_NETWORK ?? "testnet") as NearConfig["network"];
  if (network !== "testnet" && network !== "mainnet") throw new Error("NEAR_NETWORK must be testnet or mainnet");
  const privateKey = required(env, "NEAR_PRIVATE_KEY");
  if (!privateKey.startsWith("ed25519:")) throw new Error("NEAR_PRIVATE_KEY must look like ed25519:...");
  return {
    network,
    rpcUrl: env.NEAR_RPC_URL ?? DEFAULT_RPC[network],
    accountId: required(env, "NEAR_ACCOUNT_ID"),
    privateKey: privateKey as KeyPairString,
    // Default: 1 minor unit = 0.0001 NEAR, so a 20.00 contribution (2000) is 0.2 NEAR on testnet.
    yoctoPerMinorUnit: BigInt(env.YOCTO_PER_MINOR_UNIT ?? "100000000000000000000"),
  };
}
