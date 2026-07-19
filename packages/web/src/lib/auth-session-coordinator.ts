export type AuthSessionEvent =
  | "auth:session-ready"
  | "auth:session-cleared"
  | "auth:expired";

export type AuthSessionTransition =
  | "attempt"
  | "logout"
  | "expired";

export interface AuthSessionSnapshot<Account> {
  ready: boolean;
  authenticated: boolean;
  account: Account | null;
  hydrationError: boolean;
}

export interface AuthSessionPersistence {
  getToken(): string | null;
  setToken(token: string): void;
  clearToken(): void;
  getGeneration(): string;
  setGeneration(generation: string): void;
}

export interface AuthSessionRemoteMessage {
  generation: string;
  sourceId: string;
  transition: AuthSessionTransition;
}

export interface AuthSessionTransport {
  publish(message: AuthSessionRemoteMessage): void;
  subscribe(listener: (message: AuthSessionRemoteMessage) => void): () => void;
}

export interface ProviderAuthenticationResult<Account> {
  token: string;
  account: Account;
}

export interface ProviderAuthenticationAttempt {
  generation: string;
}

/**
 * Owns the optional completion callback for one provider UI attempt. Starting a
 * replacement settles the prior attempt as cancelled, and settling is
 * destructive so an old provider callback cannot leak into a later attempt.
 */
export class ProviderAuthenticationSettlement {
  private pending: ((completed: boolean) => void) | null = null;

  begin(onSettled?: (completed: boolean) => void): void {
    this.settle(false);
    this.pending = onSettled ?? null;
  }

  settle(completed: boolean): void {
    const onSettled = this.pending;
    this.pending = null;
    onSettled?.(completed);
  }
}

interface InfluenceSessionCoordinatorOptions<Account> {
  persistence: AuthSessionPersistence;
  transport: AuthSessionTransport;
  hydrate: () => Promise<Account>;
  providerLogouts: Array<() => Promise<void>>;
  emit: (event: AuthSessionEvent) => void;
  createGeneration: () => string;
  providerLogoutTimeoutMs?: number;
  sourceId?: string;
}

const DEFAULT_PROVIDER_LOGOUT_TIMEOUT_MS = 3_000;

function isUnauthorized(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "status" in error
    && error.status === 401,
  );
}

/**
 * Owns Influence browser-session state without depending on either provider's
 * authenticated flag. Provider assertions enter only through explicit,
 * generation-bound attempts.
 */
export class InfluenceSessionCoordinator<Account> {
  private readonly persistence: AuthSessionPersistence;
  private readonly transport: AuthSessionTransport;
  private readonly hydrateAccount: () => Promise<Account>;
  private readonly providerLogouts: Array<() => Promise<void>>;
  private readonly emit: (event: AuthSessionEvent) => void;
  private readonly createGeneration: () => string;
  private readonly providerLogoutTimeoutMs: number;
  private readonly sourceId: string;
  private readonly listeners = new Set<() => void>();
  private unsubscribeTransport: (() => void) | null = null;
  private exitPromise: Promise<void> | null = null;
  private snapshot: AuthSessionSnapshot<Account> = {
    ready: false,
    authenticated: false,
    account: null,
    hydrationError: false,
  };

  constructor(options: InfluenceSessionCoordinatorOptions<Account>) {
    this.persistence = options.persistence;
    this.transport = options.transport;
    this.hydrateAccount = options.hydrate;
    this.providerLogouts = options.providerLogouts;
    this.emit = options.emit;
    this.createGeneration = options.createGeneration;
    this.providerLogoutTimeoutMs =
      options.providerLogoutTimeoutMs ?? DEFAULT_PROVIDER_LOGOUT_TIMEOUT_MS;
    this.sourceId = options.sourceId ?? this.createGeneration();
  }

  getSnapshot = (): AuthSessionSnapshot<Account> => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  start(): void {
    if (this.unsubscribeTransport) return;
    this.unsubscribeTransport = this.transport.subscribe((message) => {
      this.handleRemoteTransition(message);
    });
  }

  async bootstrap(): Promise<void> {
    const token = this.persistence.getToken();
    if (!token) {
      this.updateSnapshot({
        ready: true,
        authenticated: false,
        account: null,
        hydrationError: false,
      });
      return;
    }

    const generation = this.persistence.getGeneration();
    try {
      const account = await this.hydrateAccount();
      if (
        this.persistence.getGeneration() !== generation
        || this.persistence.getToken() !== token
      ) {
        return;
      }
      this.updateSnapshot({
        ready: true,
        authenticated: true,
        account,
        hydrationError: false,
      });
    } catch (error) {
      if (
        this.persistence.getGeneration() !== generation
        || this.persistence.getToken() !== token
      ) {
        return;
      }
      if (isUnauthorized(error)) {
        await this.expire();
        return;
      }
      this.updateSnapshot({
        ready: true,
        authenticated: true,
        account: null,
        hydrationError: true,
      });
    }
  }

  beginProviderAttempt(): ProviderAuthenticationAttempt {
    const generation = this.publishTransition("attempt");
    return { generation };
  }

  async completeProviderAttempt(
    attempt: ProviderAuthenticationAttempt,
    exchange: () => Promise<ProviderAuthenticationResult<Account>>,
  ): Promise<boolean> {
    if (!this.isCurrentAttempt(attempt)) return false;
    const result = await exchange();
    if (!this.isCurrentAttempt(attempt)) return false;

    this.persistence.setToken(result.token);
    this.updateSnapshot({
      ready: true,
      authenticated: true,
      account: result.account,
      hydrationError: false,
    });
    this.emit("auth:session-ready");
    return true;
  }

  logout(): Promise<void> {
    return this.exit("logout");
  }

  expire(): Promise<void> {
    return this.exit("expired");
  }

  destroy(): void {
    this.unsubscribeTransport?.();
    this.unsubscribeTransport = null;
    this.listeners.clear();
  }

  cancelProviderAttempt(): void {
    this.publishTransition("attempt");
  }

  private isCurrentAttempt(attempt: ProviderAuthenticationAttempt): boolean {
    return this.persistence.getGeneration() === attempt.generation;
  }

  private exit(transition: "logout" | "expired"): Promise<void> {
    if (this.exitPromise) return this.exitPromise;

    this.exitPromise = (async () => {
      this.publishTransition(transition);
      this.clearLocalSession(transition);
      await Promise.allSettled(
        this.providerLogouts.map((logout) => this.runBoundedLogout(logout)),
      );
    })().finally(() => {
      this.exitPromise = null;
    });
    return this.exitPromise;
  }

  private async runBoundedLogout(logout: () => Promise<void>): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve().then(logout),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("Authentication provider logout timed out")),
            this.providerLogoutTimeoutMs,
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private publishTransition(transition: AuthSessionTransition): string {
    const generation = this.createGeneration();
    this.persistence.setGeneration(generation);
    this.transport.publish({
      generation,
      sourceId: this.sourceId,
      transition,
    });
    return generation;
  }

  private handleRemoteTransition(message: AuthSessionRemoteMessage): void {
    if (message.sourceId === this.sourceId) return;
    this.persistence.setGeneration(message.generation);
    if (message.transition === "logout" || message.transition === "expired") {
      this.clearLocalSession(message.transition);
    }
  }

  private clearLocalSession(transition: "logout" | "expired"): void {
    const hadSession =
      this.persistence.getToken() !== null || this.snapshot.authenticated;
    this.persistence.clearToken();
    this.updateSnapshot({
      ready: true,
      authenticated: false,
      account: null,
      hydrationError: false,
    });
    if (!hadSession) return;
    this.emit("auth:session-cleared");
    if (transition === "expired") this.emit("auth:expired");
  }

  private updateSnapshot(snapshot: AuthSessionSnapshot<Account>): void {
    if (
      this.snapshot.ready === snapshot.ready
      && this.snapshot.authenticated === snapshot.authenticated
      && this.snapshot.account === snapshot.account
      && this.snapshot.hydrationError === snapshot.hydrationError
    ) {
      return;
    }
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
}
