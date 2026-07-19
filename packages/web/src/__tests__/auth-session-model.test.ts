import { afterEach, describe, expect, it } from "bun:test";
import {
  InfluenceSessionCoordinator,
  ProviderAuthenticationSettlement,
  type AuthSessionPersistence,
  type AuthSessionRemoteMessage,
  type AuthSessionTransport,
} from "../lib/auth-session-coordinator";
import { providerAuthFetch } from "../lib/api";

interface TestAccount {
  id: string;
  email: string | null;
}

interface SharedState {
  token: string | null;
  generation: string;
  listeners: Set<(message: AuthSessionRemoteMessage) => void>;
}

function createSharedState(token: string | null = null): SharedState {
  return {
    token,
    generation: "initial",
    listeners: new Set(),
  };
}

function createPersistence(shared: SharedState): AuthSessionPersistence {
  return {
    getToken: () => shared.token,
    setToken: (token) => {
      shared.token = token;
    },
    clearToken: () => {
      shared.token = null;
    },
    getGeneration: () => shared.generation,
    setGeneration: (generation) => {
      shared.generation = generation;
    },
  };
}

function createTransport(shared: SharedState): AuthSessionTransport {
  return {
    publish(message) {
      for (const listener of shared.listeners) listener(message);
    },
    subscribe(listener) {
      shared.listeners.add(listener);
      return () => shared.listeners.delete(listener);
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createCoordinator(options: {
  shared?: SharedState;
  hydrate?: () => Promise<TestAccount>;
  providerLogouts?: Array<() => Promise<void>>;
  events?: string[];
  generations?: string[];
}) {
  const shared = options.shared ?? createSharedState();
  const generations = options.generations ?? ["generation-1", "generation-2"];
  let generationIndex = 0;
  const coordinator = new InfluenceSessionCoordinator<TestAccount>({
    persistence: createPersistence(shared),
    transport: createTransport(shared),
    hydrate: options.hydrate ?? (async () => ({ id: "user-1", email: null })),
    providerLogouts: options.providerLogouts ?? [],
    emit: (event) => options.events?.push(event),
    createGeneration: () =>
      generations[generationIndex++] ?? `generation-${generationIndex}`,
    providerLogoutTimeoutMs: 25,
  });
  coordinator.start();
  return { coordinator, shared };
}

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;

afterEach(() => {
  globalThis.fetch = originalFetch;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: originalWindow,
  });
});

describe("Influence session coordinator", () => {
  it("keeps a managed-only Influence JWT authenticated without provider state", async () => {
    const shared = createSharedState("managed-jwt");
    const { coordinator } = createCoordinator({
      shared,
      hydrate: async () => ({ id: "managed-user", email: "owner@example.test" }),
    });

    await coordinator.bootstrap();

    expect(coordinator.getSnapshot()).toEqual({
      ready: true,
      authenticated: true,
      account: { id: "managed-user", email: "owner@example.test" },
      hydrationError: false,
    });
  });

  it("hydrates a stored JWT after reload without a provider exchange", async () => {
    const shared = createSharedState("existing-jwt");
    let hydrations = 0;
    const exchanges = 0;
    const { coordinator } = createCoordinator({
      shared,
      hydrate: async () => {
        hydrations += 1;
        return { id: "user-1", email: null };
      },
    });

    await coordinator.bootstrap();

    expect(hydrations).toBe(1);
    expect(exchanges).toBe(0);
    expect(coordinator.getSnapshot().authenticated).toBe(true);
  });

  it("does not clear a valid Influence JWT when a provider signs out", async () => {
    const shared = createSharedState("existing-jwt");
    const { coordinator } = createCoordinator({ shared });
    await coordinator.bootstrap();

    // Provider SDK state is deliberately not an input to the coordinator.
    expect(shared.token).toBe("existing-jwt");
    expect(coordinator.getSnapshot().authenticated).toBe(true);
  });

  it("single-flights logout and concurrent protected 401 expiry", async () => {
    const shared = createSharedState("existing-jwt");
    const events: string[] = [];
    let privyLogouts = 0;
    let clerkLogouts = 0;
    const { coordinator } = createCoordinator({
      shared,
      events,
      providerLogouts: [
        async () => {
          privyLogouts += 1;
        },
        async () => {
          clerkLogouts += 1;
        },
      ],
    });
    await coordinator.bootstrap();

    await Promise.all([
      coordinator.logout(),
      coordinator.expire(),
      coordinator.expire(),
    ]);

    expect(shared.token).toBeNull();
    expect(coordinator.getSnapshot().authenticated).toBe(false);
    expect(events.filter((event) => event === "auth:session-cleared")).toHaveLength(1);
    expect(privyLogouts).toBe(1);
    expect(clerkLogouts).toBe(1);
  });

  it("clears locally and attempts every provider logout when one fails", async () => {
    const shared = createSharedState("existing-jwt");
    let secondLogout = false;
    const { coordinator } = createCoordinator({
      shared,
      providerLogouts: [
        async () => {
          throw new Error("Privy unavailable");
        },
        async () => {
          secondLogout = true;
        },
      ],
    });
    await coordinator.bootstrap();

    await coordinator.logout();

    expect(shared.token).toBeNull();
    expect(coordinator.getSnapshot().authenticated).toBe(false);
    expect(secondLogout).toBe(true);
  });

  it("does not let a hung provider logout block the independent adapter", async () => {
    const shared = createSharedState("existing-jwt");
    let secondLogout = false;
    const { coordinator } = createCoordinator({
      shared,
      providerLogouts: [
        () => new Promise<void>(() => {}),
        async () => {
          secondLogout = true;
        },
      ],
    });
    await coordinator.bootstrap();

    await coordinator.logout();

    expect(shared.token).toBeNull();
    expect(secondLogout).toBe(true);
  });

  it("suppresses an exchange that completes after logout", async () => {
    const shared = createSharedState();
    const exchange = deferred<{ token: string; account: TestAccount }>();
    const { coordinator } = createCoordinator({ shared });
    await coordinator.bootstrap();
    const attempt = coordinator.beginProviderAttempt();
    const completion = coordinator.completeProviderAttempt(attempt, () => exchange.promise);

    await coordinator.logout();
    exchange.resolve({
      token: "too-late",
      account: { id: "user-1", email: null },
    });

    expect(await completion).toBe(false);
    expect(shared.token).toBeNull();
    expect(coordinator.getSnapshot().authenticated).toBe(false);
  });

  it("suppresses an exchange that completes after expiry", async () => {
    const shared = createSharedState("expired-jwt");
    const exchange = deferred<{ token: string; account: TestAccount }>();
    const { coordinator } = createCoordinator({ shared });
    await coordinator.bootstrap();
    const attempt = coordinator.beginProviderAttempt();
    const completion = coordinator.completeProviderAttempt(attempt, () => exchange.promise);

    await coordinator.expire();
    exchange.resolve({
      token: "too-late",
      account: { id: "user-1", email: null },
    });

    expect(await completion).toBe(false);
    expect(shared.token).toBeNull();
  });

  it("prevents another tab's in-flight exchange from restoring after logout", async () => {
    const shared = createSharedState();
    const exchange = deferred<{ token: string; account: TestAccount }>();
    const tabA = createCoordinator({
      shared,
      generations: ["tab-a-attempt", "tab-a-logout"],
    }).coordinator;
    const tabB = createCoordinator({
      shared,
      generations: ["tab-b-logout"],
    }).coordinator;
    await Promise.all([tabA.bootstrap(), tabB.bootstrap()]);

    const attempt = tabA.beginProviderAttempt();
    const completion = tabA.completeProviderAttempt(attempt, () => exchange.promise);
    await tabB.logout();
    exchange.resolve({
      token: "cross-tab-too-late",
      account: { id: "user-1", email: null },
    });

    expect(await completion).toBe(false);
    expect(shared.token).toBeNull();
    expect(tabA.getSnapshot().authenticated).toBe(false);
  });

  it("completes the existing explicit Privy path through the same coordinator", async () => {
    const shared = createSharedState();
    const events: string[] = [];
    const { coordinator } = createCoordinator({ shared, events });
    await coordinator.bootstrap();

    const attempt = coordinator.beginProviderAttempt();
    const completed = await coordinator.completeProviderAttempt(attempt, async () => ({
      token: "privy-influence-jwt",
      account: { id: "privy-user", email: "privy@example.test" },
    }));

    expect(completed).toBe(true);
    expect(shared.token).toBe("privy-influence-jwt");
    expect(coordinator.getSnapshot().account?.id).toBe("privy-user");
    expect(events).toContain("auth:session-ready");
  });
});

describe("provider authentication settlement", () => {
  it("settles successful provider completion exactly once", () => {
    const outcomes: boolean[] = [];
    const settlement = new ProviderAuthenticationSettlement<boolean>(false);

    settlement.begin((completed) => outcomes.push(completed));
    settlement.settle(true);
    settlement.settle(false);

    expect(outcomes).toEqual([true]);
  });

  it("reports cancellation, provider error, and logout as unsuccessful settlement", () => {
    const outcomes: boolean[] = [];

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const settlement = new ProviderAuthenticationSettlement<boolean>(false);
      settlement.begin((completed) => outcomes.push(completed));
      settlement.settle(false);
    }

    expect(outcomes).toEqual([false, false, false]);
  });

  it("cancels a replaced callback without leaking it into the next attempt", () => {
    const first: boolean[] = [];
    const second: boolean[] = [];
    const settlement = new ProviderAuthenticationSettlement<boolean>(false);

    settlement.begin((completed) => first.push(completed));
    settlement.begin((completed) => second.push(completed));
    settlement.settle(true);

    expect(first).toEqual([false]);
    expect(second).toEqual([true]);
  });
});

describe("provider authentication fetch", () => {
  it("does not dispatch Influence expiry for a provider-auth 401", async () => {
    const events: string[] = [];
    const windowValue = {
      dispatchEvent(event: Event) {
        events.push(event.type);
        return true;
      },
    };
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: windowValue,
    });
    globalThis.fetch = ((async () =>
      new Response(JSON.stringify({ error: "Provider token expired" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      })) as unknown) as typeof fetch;

    await expect(
      providerAuthFetch("/api/auth/managed/exchange", {
        method: "POST",
        body: JSON.stringify({ token: "expired-provider-token" }),
      }),
    ).rejects.toMatchObject({ status: 401 });

    expect(events).not.toContain("auth:expired");
  });
});
