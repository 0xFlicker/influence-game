import type {
  ManagedAuthMode,
  PublicRuntimeConfig,
} from "@/lib/runtime-config";

const MANAGED_AUTH_MODES = new Set<ManagedAuthMode>([
  "disabled",
  "existing-only",
  "full",
]);

function getManagedAuthMode(): ManagedAuthMode {
  const configured = (process.env.MANAGED_AUTH_MODE ?? "disabled").trim();
  if (!MANAGED_AUTH_MODES.has(configured as ManagedAuthMode)) {
    throw new Error(
      'MANAGED_AUTH_MODE must be one of "disabled", "existing-only", or "full"',
    );
  }
  return configured as ManagedAuthMode;
}

export function getPublicRuntimeConfig(): PublicRuntimeConfig {
  const managedAuthMode = getManagedAuthMode();
  const clerkPublishableKey = (
    process.env.CLERK_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??
    ""
  ).trim();

  if (managedAuthMode !== "disabled" && !clerkPublishableKey) {
    throw new Error(
      `CLERK_PUBLISHABLE_KEY is required when MANAGED_AUTH_MODE is ${managedAuthMode}`,
    );
  }

  return {
    PRIVY_APP_ID:
      process.env.PRIVY_APP_ID ??
      process.env.NEXT_PUBLIC_PRIVY_APP_ID ??
      "",
    CLERK_PUBLISHABLE_KEY:
      managedAuthMode === "disabled" ? "" : clerkPublishableKey,
    MANAGED_AUTH_MODE: managedAuthMode,
    API_URL:
      process.env.API_URL ??
      process.env.NEXT_PUBLIC_API_URL ??
      "",
    WS_URL:
      process.env.WS_URL ??
      process.env.NEXT_PUBLIC_WS_URL ??
      "",
    MCP_OAUTH_RESOURCE_URI: process.env.MCP_OAUTH_RESOURCE_URI ?? "",
    ADMIN_ADDRESS:
      process.env.ADMIN_ADDRESS ??
      process.env.NEXT_PUBLIC_ADMIN_ADDRESS ??
      "",
    EPHEMERAL: process.env.EPHEMERAL === "true",
    EPHEMERAL_PR: process.env.EPHEMERAL_PR ?? "",
    SOURCE_ENV_URL: process.env.SOURCE_ENV_URL ?? "",
  };
}
