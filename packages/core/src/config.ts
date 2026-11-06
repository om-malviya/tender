import { defineChain, type Address, type Chain } from "viem";
import { unichainSepolia } from "viem/chains";

/** Whitechain Sepolia is not in viem's built-in list, so we describe it ourselves. */
export const whitechainSepolia = defineChain({
  id: 1874,
  name: "Whitechain Sepolia",
  nativeCurrency: { name: "Whitechain Token", symbol: "WBT", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.whitechain.io/"] } },
  blockExplorers: { default: { name: "Whitechain Explorer", url: "https://explorer.testnet.whitechain.io" } },
  // Multicall3 (batch reads) at its standard address, checked deployed on Whitechain Sepolia on Nov 5.
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
  testnet: true,
});

export type ChainKey = "unichain-sepolia" | "whitechain-sepolia";

export interface ChainConfig {
  key: ChainKey;
  chain: Chain;
  rpcUrl: string;
  /** Our deployed checkout contract (UniswapCheckout on Unichain, CheckoutCore on Whitechain). */
  checkout?: Address;
  /** Block the checkout was deployed in; event scans start here. */
  deployBlock: bigint;
  /** Max blocks per getLogs call. Public RPCs cap this: Unichain Sepolia rejects >1000, Whitechain accepts 5000
   *  (both measured Nov 5). */
  logChunk: bigint;
  /** The stablecoin invoices are priced in. */
  settleToken: { address: Address; symbol: string; decimals: number };
  /** Only Unichain has Uniswap: there the payer can pay with other tokens. */
  swaps?: {
    quoter: Address;
    weth: Address;
    /** Extra tokens the pay page scans the payer's wallet for (besides WETH). */
    extraTokens: { address: Address; symbol: string; decimals: number }[];
    /**
     * Vetted pools: if set, routes may ONLY use these. Testnets are full of pools with absurd prices
     * (our fork test found a WETH/USDC pool pricing WETH at trillions of dollars), and on mainnet a
     * thin or manipulated pool is the same risk. Unset = any pool the Quoter can find.
     */
    pools?: AllowedPool[];
    /** The CheckoutHook: pools with it attached settle invoices from inside ANY router's swap. */
    hook?: Address;
    /** A generic v4 router (Uniswap's PoolSwapTest) the pay page uses for hook routes: proves "any router" works. */
    swapRouter?: Address;
  };
  explorer: string;
}

/** One hook-free v4 pool: the two tokens (any order), fee and tick spacing. */
export interface AllowedPool {
  a: Address;
  b: Address;
  fee: number;
  tickSpacing: number;
  /** address(0) / undefined = plain pool (usable by UniswapCheckout); otherwise the hook attached to it */
  hooks?: Address;
}

/** Uniswap v4 fee tiers we look for pools in: fee (hundredths of a bip) + matching tick spacing. */
export const FEE_TIERS = [
  { fee: 500, tickSpacing: 10 },
  { fee: 3000, tickSpacing: 60 },
  { fee: 10000, tickSpacing: 200 },
] as const;

const addr = (v: string | undefined): Address | undefined => (v ? (v as Address) : undefined);

/**
 * Reads network settings from environment variables, with the verified testnet defaults.
 * Every value can be overridden, e.g. RPC URLs pointing at a local anvil fork for testing.
 */
/** Node's process.env when on a server; an empty object in the browser (which gets config from /api/config). */
const defaultEnv = (): Record<string, string | undefined> =>
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

export function loadChains(env: Record<string, string | undefined> = defaultEnv()): Record<ChainKey, ChainConfig> {
  const demo = addr(env.DEMO);
  const usdc = (env.UNICHAIN_USDC ?? "0x31d0220469e10c4E71834a79b1f276d740d3768F") as Address;
  const weth: Address = "0x4200000000000000000000000000000000000006";
  // The three pools SeedPools.s.sol creates/funds. TENDER_ANY_POOL=1 lifts the allowlist.
  const hook = addr(env.UNICHAIN_HOOK);
  const seededPools: AllowedPool[] | undefined =
    demo && env.TENDER_ANY_POOL !== "1"
      ? [
          { a: weth, b: usdc, fee: 500, tickSpacing: 10 },
          { a: demo, b: weth, fee: 3000, tickSpacing: 60 },
          { a: demo, b: usdc, fee: 3000, tickSpacing: 60 },
          ...(hook ? [{ a: weth, b: usdc, fee: 500, tickSpacing: 10, hooks: hook }, { a: demo, b: usdc, fee: 3000, tickSpacing: 60, hooks: hook }] : []),
        ]
      : undefined;
  return {
    "unichain-sepolia": {
      key: "unichain-sepolia",
      chain: env.UNICHAIN_CHAIN_ID ? { ...unichainSepolia, id: Number(env.UNICHAIN_CHAIN_ID) } : unichainSepolia,
      rpcUrl: env.UNICHAIN_SEPOLIA_RPC ?? "https://sepolia.unichain.org",
      checkout: addr(env.UNICHAIN_CHECKOUT),
      deployBlock: BigInt(env.UNICHAIN_DEPLOY_BLOCK ?? "0"),
      logChunk: BigInt(env.UNICHAIN_LOG_CHUNK ?? "1000"),
      settleToken: { address: usdc, symbol: "USDC", decimals: 6 },
      swaps: {
        quoter: (env.UNICHAIN_QUOTER ?? "0x56DCD40A3F2d466F48e7F48bDBE5Cc9B92Ae4472") as Address,
        weth,
        extraTokens: demo ? [{ address: demo, symbol: "DEMO", decimals: 18 }] : [],
        pools: seededPools,
        hook,
        swapRouter: addr(env.UNICHAIN_SWAP_ROUTER) ?? (hook ? "0x9140a78c1a137c7ff1c151ec8231272af78a99a4" : undefined),
      },
      explorer: env.UNICHAIN_EXPLORER ?? "https://sepolia.uniscan.xyz",
    },
    "whitechain-sepolia": {
      key: "whitechain-sepolia",
      chain: whitechainSepolia,
      rpcUrl: env.WHITECHAIN_SEPOLIA_RPC ?? "https://rpc.testnet.whitechain.io/",
      checkout: addr(env.WHITECHAIN_CHECKOUT),
      deployBlock: BigInt(env.WHITECHAIN_DEPLOY_BLOCK ?? "0"),
      logChunk: BigInt(env.WHITECHAIN_LOG_CHUNK ?? "5000"),
      settleToken: { address: "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7", symbol: "USDT", decimals: 6 },
      explorer: "https://explorer.testnet.whitechain.io",
    },
  };
}

export const txUrl = (cfg: ChainConfig, hash: string) => `${cfg.explorer}/tx/${hash}`;
