/** Nonsecret runtime configuration. Never rewrite persisted source documents. */
export interface PublicMediaDelivery {
  version: 1;
  publicBaseUrl: string;
  legacyBases: string[];
}

function base(value: string, originOnly = false): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || (originOnly && url.origin !== value.replace(/\/$/, ""))) {
    throw new Error("Public media delivery requires exact HTTPS bases");
  }
  return url;
}

export function configuredPublicMediaDelivery(): PublicMediaDelivery | undefined {
  // One immutable image is promoted between environments. Read deployed values,
  // never NEXT_PUBLIC build substitutions. Browser callers use the React context.
  const environment = process.env;
  const provider = environment.HOUSE_OBJECT_STORAGE_PROVIDER;
  if (!provider || provider === "linode") return undefined;
  if (provider !== "aws") throw new Error("Invalid public media delivery provider");
  const publicBaseUrl = environment.HOUSE_PUBLIC_BASE_URL ?? "";
  const legacyBases = (environment.HOUSE_LEGACY_PUBLIC_BASE_URLS ?? "").split(",").filter(Boolean);
  base(publicBaseUrl, true);
  if (!legacyBases.length) throw new Error("Explicit legacy public media bases are required");
  legacyBases.forEach(value => base(value));
  return { version: 1, publicBaseUrl, legacyBases };
}

export function resolvePublicMediaUrl(value: string, config: PublicMediaDelivery | null | undefined = configuredPublicMediaDelivery()): string {
  if (!config) return value;
  if (config.version !== 1) throw new Error("Unsupported public media delivery version");
  const target = base(config.publicBaseUrl, true);
  const sources = config.legacyBases.map(value => base(value));
  let url: URL;
  try { url = new URL(value); } catch { return value; }
  if (url.protocol !== "https:" || url.username || url.password) return value;
  for (const source of sources) {
    const prefix = source.pathname.replace(/\/$/, "") + "/";
    if (url.origin !== source.origin || !url.pathname.startsWith(prefix)) continue;
    if ([...url.searchParams.keys()].some(key => ["versionid", "partnumber"].includes(key.toLowerCase()))) {
      throw new Error("Versioned public media requires an explicit retained-version mapping");
    }
    let key: string;
    try { key = decodeURIComponent(url.pathname.slice(prefix.length)); } catch { return value; }
    if (!key || key.includes("\\") || key.includes("\0") || key.split("/").some(part => !part || part === "." || part === "..")) return value;
    const delivered = new URL(`${target.origin}/${key.split("/").map(encodeURIComponent).join("/")}`);
    for (const [name, value] of url.searchParams) {
      if (!name.toLowerCase().startsWith("x-amz-") && !["signature", "expires", "awsaccesskeyid", "securitytoken", "access_token", "token"].includes(name.toLowerCase())) delivered.searchParams.append(name, value);
    }
    delivered.hash = url.hash;
    return delivered.toString();
  }
  return value;
}

/** Clone presentation props only. Map keys, text, hashes and canonical inputs stay intact. */
export function publicMediaDeliveryView<T>(value: T, config: PublicMediaDelivery | null | undefined = configuredPublicMediaDelivery()): T {
  if (!config) return value;
  const walk = (item: unknown, key = "", parent = ""): unknown => {
    if (typeof item === "string" && (/url$|^src$/i.test(key) || /^(portraits|fullBodies|fullBodyReferences|wolfForms)$/.test(parent))) {
      return resolvePublicMediaUrl(item, config);
    }
    if (Array.isArray(item)) return item.map(child => walk(child, key, parent));
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).map(([name, child]) => [name, walk(child, name, key)]));
    return item;
  };
  return walk(value) as T;
}
