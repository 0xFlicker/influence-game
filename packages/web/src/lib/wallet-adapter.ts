/**
 * Wallet Adapter — Abstraction over Privy / E2E test provider
 *
 * In production, the PrivyWalletAdapter delegates to Privy React hooks.
 * In E2E tests, the E2EWalletAdapter delegates to window.__E2E_PROVIDER__,
 * which is injected by the Puppeteer test harness before the app boots.
 *
 * Detection is automatic: if window.__E2E_PROVIDER__ exists, the E2E adapter
 * is used. Otherwise, the Privy adapter is used.
 */

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface WalletAdapter {
  connect(): Promise<void>;
  getAddress(): string | null;
  signMessage(message: string): Promise<string>;
  logout(): Promise<void>;
  isConnected: boolean;
}

// ---------------------------------------------------------------------------
// E2E detection
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    __E2E_PROVIDER__?: {
      isConnected: () => boolean;
      request: (args: {
        method: string;
        params?: unknown[];
      }) => Promise<unknown>;
      on: (...args: unknown[]) => void;
      removeListener: (...args: unknown[]) => void;
    };
    __E2E_ACCOUNTS__?: readonly [`0x${string}`, ...`0x${string}`[]];
  }
}

export function isE2EMode(): boolean {
  return typeof window !== "undefined" && !!window.__E2E_PROVIDER__;
}

// ---------------------------------------------------------------------------
// E2E Wallet Adapter
// ---------------------------------------------------------------------------

export class E2EWalletAdapter implements WalletAdapter {
  private address: string | null = null;
  private connected = false;

  async connect(): Promise<void> {
    const provider = window.__E2E_PROVIDER__;
    if (!provider) throw new Error("E2E provider not injected");

    const accounts = (await provider.request({
      method: "eth_requestAccounts",
    })) as string[];

    this.address = accounts[0] ?? null;
    this.connected = true;
  }

  getAddress(): string | null {
    // Check injected accounts first (set before connect)
    if (!this.address && window.__E2E_ACCOUNTS__?.[0]) {
      this.address = window.__E2E_ACCOUNTS__[0];
    }
    return this.address;
  }

  async signMessage(message: string): Promise<string> {
    const provider = window.__E2E_PROVIDER__;
    if (!provider) throw new Error("E2E provider not injected");

    const result = await provider.request({
      method: "personal_sign",
      params: [message, this.address],
    });
    return result as string;
  }

  async logout(): Promise<void> {
    this.address = null;
    this.connected = false;
  }

  get isConnected(): boolean {
    return this.connected || !!this.address;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

let _e2eAdapter: E2EWalletAdapter | null = null;

export function getE2EAdapter(): E2EWalletAdapter {
  if (!_e2eAdapter) {
    _e2eAdapter = new E2EWalletAdapter();
  }
  return _e2eAdapter;
}
