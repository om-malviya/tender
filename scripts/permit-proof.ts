// One-signature USDT payment on Whitechain Sepolia: the customer signs an EIP-2612 permit and pays in ONE
// transaction (no separate approve). Proves the permit really worked by requiring a zero allowance first:
// payInvoiceWithPermit swallows a failed permit, so with no allowance the payment could only succeed via it.
//   npx tsx scripts/permit-proof.ts            (uses DEPLOYER_PK from .env as both merchant and payer)
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, parseAbi, parseEventLogs, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { checkoutCoreAbi, loadChains } from "@tender/core";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const deployed = Object.fromEntries(
  readFileSync(new URL("../deployments/whitechain-sepolia.env", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);

const cfg = loadChains({ ...env, ...deployed })["whitechain-sepolia"];
const checkout = cfg.checkout!;
const USDT = cfg.settleToken.address;
const account = privateKeyToAccount((process.env.DEPLOYER_PK ?? env.DEPLOYER_PK) as Hex);
const pub = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpcUrl) });
const wallet = createWalletClient({ account, chain: cfg.chain, transport: http(cfg.rpcUrl) });
const erc20 = parseAbi([
  "function allowance(address,address) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function nonces(address) view returns (uint256)",
]);
const amount = 500_000n; // 0.50 USDT

const allowance = await pub.readContract({ address: USDT, abi: erc20, functionName: "allowance", args: [account.address, checkout] });
if (allowance !== 0n) throw new Error(`allowance is ${allowance}, must be 0 for this to prove the permit`);

// 1. merchant creates the invoice; the id comes from the transaction's own InvoiceCreated event
const createHash = await wallet.writeContract({
  address: checkout,
  abi: checkoutCoreAbi,
  functionName: "createInvoice",
  args: [USDT, amount, BigInt(Math.floor(Date.now() / 1000) + 3600), "0x" + "70".repeat(32) as Hex],
});
const created = await pub.waitForTransactionReceipt({ hash: createHash, timeout: 300_000 });
const id = parseEventLogs({ abi: checkoutCoreAbi, eventName: "InvoiceCreated", logs: created.logs })[0]!.args.id;

// 2. customer signs the permit (domain matched against the token's DOMAIN_SEPARATOR) and pays in one tx
const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
const nonce = await pub.readContract({ address: USDT, abi: erc20, functionName: "nonces", args: [account.address] });
const sig = await wallet.signTypedData({
  domain: { name: "Tether USD", version: "1", chainId: cfg.chain.id, verifyingContract: USDT },
  types: {
    Permit: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  },
  primaryType: "Permit",
  message: { owner: account.address, spender: checkout, value: amount, nonce, deadline },
});
const r = sig.slice(0, 66) as Hex;
const s = ("0x" + sig.slice(66, 130)) as Hex;
const v = Number.parseInt(sig.slice(130, 132), 16);
const payHash = await wallet.writeContract({ address: checkout, abi: checkoutCoreAbi, functionName: "payInvoiceWithPermit", args: [id, deadline, v, r, s] });
const paid = await pub.waitForTransactionReceipt({ hash: payHash, timeout: 300_000 });
if (paid.status !== "success") throw new Error("payment reverted");

const inv = await pub.readContract({ address: checkout, abi: checkoutCoreAbi, functionName: "getInvoice", args: [id] });
const held = await pub.readContract({ address: USDT, abi: erc20, functionName: "balanceOf", args: [checkout] });
console.log(`invoice #${id}: status ${inv.status} (2 = Paid), contract holds ${held} USDT`);
console.log(`one-signature permit payment: ${cfg.explorer}/tx/${payHash}`);
