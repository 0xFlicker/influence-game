/**
 * Generates human-readable game slugs in the style of "punk-green-apple".
 * Format: adjective-color-noun
 */

const ADJECTIVES = [
  "bold", "calm", "dark", "epic", "fast", "grim", "hard", "iron", "jade", "keen",
  "lazy", "mad", "neat", "odd", "pale", "punk", "quick", "raw", "sharp", "tame",
  "ultra", "vast", "wild", "young", "zen", "acid", "bare", "cold", "dead", "edge",
  "free", "gold", "hazy", "idle", "just", "kind", "lean", "mild", "neon", "open",
  "pure", "real", "slim", "true", "used", "void", "warm", "xtra", "zero", "soft",
];

const COLORS = [
  "amber", "azure", "beige", "black", "blue", "brown", "coral", "cream", "cyan",
  "fawn", "gold", "green", "grey", "indigo", "ivory", "jade", "khaki", "lemon",
  "lilac", "lime", "mauve", "mint", "navy", "ochre", "olive", "peach", "pink",
  "plum", "rose", "ruby", "sage", "sand", "scarlet", "slate", "smoke", "tan",
  "teal", "violet", "white", "wine",
];

const NOUNS = [
  "apple", "arc", "ash", "bay", "blade", "bolt", "bone", "brook", "cave", "cliff",
  "cloud", "coal", "code", "coin", "core", "cove", "crane", "crown", "cube", "dawn",
  "dusk", "dust", "echo", "edge", "fang", "fire", "flame", "flare", "fog", "forge",
  "frost", "gate", "gem", "ghost", "glade", "glow", "grove", "hawk", "hive", "horn",
  "ice", "isle", "jade", "key", "lake", "lance", "leaf", "light", "lore", "mist",
  "moon", "moss", "nest", "node", "north", "oak", "orb", "path", "peak", "pine",
  "prism", "quartz", "reef", "ridge", "ring", "rock", "root", "rune", "rust", "salt",
  "sand", "seed", "shade", "shard", "shore", "silver", "sky", "slate", "smoke", "snow",
  "song", "soul", "spark", "spire", "star", "steel", "stone", "storm", "sun", "surge",
  "tide", "tower", "track", "trail", "tree", "vale", "vault", "vine", "void", "wave",
  "wind", "wire", "wolf", "wood", "world", "wyrm",
];

function pick(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

export function generateSlug(): string {
  return `${pick(ADJECTIVES)}-${pick(COLORS)}-${pick(NOUNS)}`;
}

/**
 * Generates a unique slug, retrying if the candidate is already taken.
 * `exists` should return true if the slug is already in use.
 */
export async function generateUniqueSlug(exists: (slug: string) => boolean | Promise<boolean>, maxAttempts = 20): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const slug = generateSlug();
    if (!(await exists(slug))) return slug;
  }
  // Extremely unlikely to reach here, but fall back with a numeric suffix
  return `${generateSlug()}-${Date.now().toString(36)}`;
}
