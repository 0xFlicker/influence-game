import type { PublicRuntimeConfig } from "@/lib/runtime-config";

export function getPublicRuntimeConfig(): PublicRuntimeConfig {
  return {
    PRIVY_APP_ID:
      process.env.PRIVY_APP_ID ??
      process.env.NEXT_PUBLIC_PRIVY_APP_ID ??
      "",
    API_URL:
      process.env.API_URL ??
      process.env.NEXT_PUBLIC_API_URL ??
      "http://127.0.0.1:3000",
    WS_URL:
      process.env.WS_URL ??
      process.env.NEXT_PUBLIC_WS_URL ??
      "ws://127.0.0.1:3000",
    ADMIN_ADDRESS:
      process.env.ADMIN_ADDRESS ??
      process.env.NEXT_PUBLIC_ADMIN_ADDRESS ??
      "",
    EPHEMERAL: process.env.EPHEMERAL === "true",
    EPHEMERAL_PR: process.env.EPHEMERAL_PR ?? "",
    SOURCE_ENV_URL: process.env.SOURCE_ENV_URL ?? "",
  };
}
