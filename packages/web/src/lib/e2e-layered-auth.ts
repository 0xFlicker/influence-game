export function isLayeredAuthE2EAdapterEnabled(): boolean {
  return process.env.NODE_ENV !== "production"
    && process.env.NEXT_PUBLIC_E2E_LAYERED_AUTH === "true";
}
