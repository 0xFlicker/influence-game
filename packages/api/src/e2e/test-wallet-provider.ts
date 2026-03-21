/**
 * EIP-1193 Test Wallet Provider
 *
 * Puppeteer-side helper that injects a real EIP-1193 provider into the browser
 * page before the app boots. Uses `page.exposeFunction` to bridge wallet
 * requests (eth_requestAccounts, personal_sign, etc.) into Node where viem
 * produces real cryptographic signatures.
 *
 * Usage:
 *   const wallet = generateTestWallet();
 *   await injectWalletProvider(page, wallet.privateKey);
 *   await page.goto(webUrl); // app detects window.__E2E_PROVIDER__
 */

import type { Page } from "puppeteer";
import {
  createWalletClient,
  createPublicClient,
  http,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";

const DEFAULT_CHAIN_ID = "0x1"; // mainnet

/**
 * Inject an EIP-1193 wallet provider into the page before the app boots.
 *
 * This sets `window.__E2E_PROVIDER__` and `window.ethereum` to an object
 * that bridges EIP-1193 JSON-RPC calls to a real viem wallet client running
 * in Node. Signatures are cryptographically valid.
 */
export async function injectWalletProvider(
  page: Page,
  privateKey: `0x${string}`,
  opts?: { chainId?: string; rpcUrl?: string },
): Promise<{ address: `0x${string}`; walletClient: WalletClient }> {
  const chainId = opts?.chainId ?? DEFAULT_CHAIN_ID;
  const account = privateKeyToAccount(privateKey);
  const address = account.address;

  const walletClient = createWalletClient({
    account,
    chain: mainnet,
    transport: http(opts?.rpcUrl),
  });

  const publicClient = createPublicClient({
    chain: mainnet,
    transport: http(opts?.rpcUrl),
  });

  // Expose a Node-side function that handles EIP-1193 requests
  await page.exposeFunction(
    "__e2eWalletRequest",
    async (method: string, params: unknown[]): Promise<unknown> => {
      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts":
          return [address];

        case "eth_chainId":
          return chainId;

        case "wallet_switchEthereumChain": {
          const requested = (params[0] as { chainId: string })?.chainId;
          if (requested && requested !== chainId) {
            throw new Error(
              `Chain ${requested} not supported in e2e (only ${chainId})`,
            );
          }
          return null;
        }

        case "personal_sign": {
          // personal_sign params: [message, address]
          const message = params[0] as string;
          const signature = await walletClient.signMessage({
            message: { raw: message as `0x${string}` },
          });
          return signature;
        }

        case "eth_signTypedData_v4": {
          // Typed data signing — parse the JSON data param
          const typedData = JSON.parse(params[1] as string);
          const signature = await walletClient.signTypedData(typedData);
          return signature;
        }

        case "eth_sendTransaction": {
          // Relay transaction to viem wallet client
          const txParams = params[0] as {
            to?: string;
            value?: string;
            data?: string;
            gas?: string;
          };
          const hash = await walletClient.sendTransaction({
            to: txParams.to as `0x${string}`,
            value: txParams.value ? BigInt(txParams.value) : undefined,
            data: txParams.data as `0x${string}` | undefined,
            gas: txParams.gas ? BigInt(txParams.gas) : undefined,
          });
          return hash;
        }

        default: {
          // Passthrough for standard JSON-RPC reads (eth_blockNumber, etc.)
          try {
            return await publicClient.request({
              method: method as never,
              params: params as never,
            });
          } catch {
            throw new Error(`Unsupported e2e wallet method: ${method}`);
          }
        }
      }
    },
  );

  // Inject the provider object into the page before any scripts run
  await page.evaluateOnNewDocument(
    (injected: { address: string; chainId: string }) => {
      const provider = {
        isConnected: () => true,
        async request({
          method,
          params,
        }: {
          method: string;
          params?: unknown[];
        }): Promise<unknown> {
          return (
            globalThis as unknown as {
              __e2eWalletRequest: (
                method: string,
                params: unknown[],
              ) => Promise<unknown>;
            }
          ).__e2eWalletRequest(method, params ?? []);
        },
        on() {},
        removeListener() {},
        removeAllListeners() {},
      };

      (globalThis as unknown as Record<string, unknown>).__E2E_PROVIDER__ =
        provider;
      (globalThis as unknown as Record<string, unknown>).__E2E_ACCOUNTS__ = [
        injected.address,
      ];
      (globalThis as unknown as Record<string, unknown>).ethereum = provider;

      // Signal to wagmi/ethers that ethereum is available
      (globalThis as unknown as { dispatchEvent: (e: Event) => void }).dispatchEvent(
        new Event("ethereum#initialized"),
      );
    },
    { address, chainId },
  );

  return { address, walletClient };
}
