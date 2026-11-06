import { erc20Abi, type Abi, type Address, type ContractFunctionArgs, type ContractFunctionName, type TransactionReceipt } from "viem";
import { useConfig, useConnection, useSwitchChain, useWriteContract } from "wagmi";
import { getPublicClient } from "wagmi/actions";

/**
 * Every transaction the app sends goes through here:
 *  1. switch the wallet to the right chain
 *  2. approve EXACTLY the amount needed (never "unlimited"), only if the current allowance is too low
 *  3. send, wait for the receipt, fail loudly if it reverted
 */
export function useTx() {
  const config = useConfig();
  const { address, chainId } = useConnection();
  const switchChain = useSwitchChain();
  const write = useWriteContract();

  const client = (id: number) => {
    const c = getPublicClient(config, { chainId: id });
    if (!c) throw new Error(`no RPC for chain ${id}`);
    return c;
  };

  async function ensureChain(id: number) {
    if (chainId !== id) await switchChain.mutateAsync({ chainId: id });
  }

  async function send<const abi extends Abi, fn extends ContractFunctionName<abi, "nonpayable" | "payable">>(req: {
    chainId: number;
    address: Address;
    abi: abi;
    functionName: fn;
    args: ContractFunctionArgs<abi, "nonpayable" | "payable", fn>;
  }): Promise<TransactionReceipt> {
    await ensureChain(req.chainId);
    const hash = await write.mutateAsync(req as never);
    const receipt = await client(req.chainId).waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`transaction reverted: ${hash}`);
    return receipt;
  }

  async function approveIfNeeded(chain: number, token: Address, spender: Address, amount: bigint) {
    if (!address) throw new Error("connect a wallet first");
    const allowance = await client(chain).readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [address, spender] });
    if (allowance >= amount) return false;
    // USDT-style tokens refuse to change one non-zero allowance to another, so reset to 0 first.
    if (allowance > 0n) await send({ chainId: chain, address: token, abi: erc20Abi, functionName: "approve", args: [spender, 0n] });
    await send({ chainId: chain, address: token, abi: erc20Abi, functionName: "approve", args: [spender, amount] });
    return true;
  }

  return { address, chainId, client, ensureChain, send, approveIfNeeded };
}

/** Wallet errors are long; show the first useful line. */
export const errorText = (e: unknown) =>
  (e instanceof Error ? ((e as { shortMessage?: string }).shortMessage ?? e.message) : String(e)).split("\n")[0];
