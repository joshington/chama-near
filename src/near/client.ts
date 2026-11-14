import { Account, JsonRpcProvider, KeyPairSigner } from "near-api-js";
import type { NearConfig } from "./config.js";

/** Builds the connection to NEAR: an RPC provider plus an account that can sign transactions. */
export function createNearAccount(cfg: NearConfig): { provider: JsonRpcProvider; account: Account } {
  const provider = new JsonRpcProvider({ url: cfg.rpcUrl });
  const signer = KeyPairSigner.fromSecretKey(cfg.privateKey);
  const account = new Account(cfg.accountId, provider, signer);
  return { provider, account };
}
