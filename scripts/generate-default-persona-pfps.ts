import { mkdir, unlink, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const KATANA_BASE_URL = "https://kat.imgnai.com";
const MODEL = "synth";
const OUT_DIR = path.resolve("packages/web/public/avatars/personas");
const TIMEOUT_MS = 10 * 60 * 1000;

interface PersonaPrompt {
  key: string;
  name: string;
  role: string;
  tags: string;
  presentation: "masculine" | "feminine" | "androgynous";
  crop?: {
    height: number;
    width: number;
    offsetY: number;
    offsetX: number;
  };
}

interface KatanaEnvelope {
  request_id?: string;
  status?: string;
  poll_after_seconds?: number;
  responses?: Array<{
    error?: { code?: string; message?: string; retryable?: boolean };
    output_assets?: Array<{
      original_data_url?: string;
      url?: string;
    }>;
  }>;
}

const personas: PersonaPrompt[] = [
  {
    key: "strategic",
    name: "Atlas",
    role: "long-game strategist, calm alliance architect",
    tags: "chessmaster, calculating gaze, composed leader, tactical hologram glow, masculine face, short hair, sharp jawline",
    presentation: "masculine",
  },
  {
    key: "deceptive",
    name: "Vera",
    role: "master manipulator, elegant misdirection specialist",
    tags: "masked smile, theatrical shadow, secretive eyes, velvet cyberpunk style",
    presentation: "feminine",
    crop: { height: 430, width: 430, offsetY: 70, offsetX: 41 },
  },
  {
    key: "honest",
    name: "Finn",
    role: "transparent coalition builder, principled competitor",
    tags: "warm expression, sincere eyes, trustworthy posture, clean neon rim light, masculine face, short hair, friendly young man",
    presentation: "masculine",
  },
  {
    key: "paranoid",
    name: "Lyra",
    role: "hyper-vigilant analyst, distrustful survivor",
    tags: "watchful eyes, tense shoulders, security camera reflections, anxious intensity",
    presentation: "feminine",
    crop: { height: 360, width: 360, offsetY: 110, offsetX: 0 },
  },
  {
    key: "social",
    name: "Mira",
    role: "charismatic social reader, effortless room navigator",
    tags: "magnetic smile, social butterfly, confident charm, nightclub neon glow",
    presentation: "feminine",
  },
  {
    key: "aggressive",
    name: "Rex",
    role: "bold pressure player, fast-action provocateur",
    tags: "electric intensity, forward lean, battle-ready jacket, sharp neon contrast, masculine face, short spiked hair, athletic young man",
    presentation: "masculine",
    crop: { height: 430, width: 430, offsetY: 70, offsetX: 41 },
  },
  {
    key: "loyalist",
    name: "Kael",
    role: "steadfast protector, unwavering alliance shield",
    tags: "protective stance, loyal gaze, armored collar, blue shield light, masculine face, strong jaw, calm young man",
    presentation: "masculine",
  },
  {
    key: "observer",
    name: "Echo",
    role: "quiet intel gatherer, patient timing expert",
    tags: "observant eyes, quiet silhouette, data reflections, stealthy cyberpunk mood",
    presentation: "androgynous",
  },
  {
    key: "diplomat",
    name: "Sage",
    role: "neutral mediator, consensus builder",
    tags: "balanced expression, mediator presence, elegant symmetry, gold and teal accents",
    presentation: "androgynous",
  },
  {
    key: "wildcard",
    name: "Jace",
    role: "chaotic unpredictable strategist, risk lover",
    tags: "mischievous grin, neon dice motif, asymmetrical style, playful chaos, masculine face, tousled short hair, roguish young man",
    presentation: "masculine",
  },
  {
    key: "contrarian",
    name: "Nyx",
    role: "consensus breaker, skeptical pressure tester",
    tags: "defiant stare, crossed arms, glitch accents, rebellious cyberpunk fashion",
    presentation: "feminine",
  },
  {
    key: "provocateur",
    name: "Rune",
    role: "information weaponizer, timed reveal specialist",
    tags: "dangerous smirk, occult-tech glow, sharp eyes, dramatic reveal lighting, masculine face, sleek short hair, charismatic young man",
    presentation: "masculine",
  },
  {
    key: "martyr",
    name: "Wren",
    role: "self-sacrificing ally protector, jury-sympathy player",
    tags: "gentle resolve, luminous feathers motif, protective warmth, melancholy neon halo",
    presentation: "feminine",
  },
];

const negativePrompt = [
  "text",
  "letters",
  "words",
  "caption",
  "logo",
  "watermark",
  "signage",
  "poster",
  "typography",
  "username",
  "signature",
  "blurry",
  "low quality",
  "distorted face",
  "extra limbs",
  "full body",
  "wide shot",
  "celebrity likeness",
].join(", ");

function credentials(): { key: string; secret: string } {
  const key = process.env.API_KAT_IMGNAI_KEY?.trim();
  const secret = process.env.API_KAT_IMGNAI_SECRET?.trim();
  if (!key || !secret) {
    throw new Error("API_KAT_IMGNAI_KEY and API_KAT_IMGNAI_SECRET are required.");
  }
  return { key, secret };
}

function promptFor(persona: PersonaPrompt): string {
  const subject = persona.presentation === "masculine"
    ? "1boy, male, young adult man, masculine facial structure"
    : persona.presentation === "feminine"
      ? "1girl, female, young adult woman"
      : "solo, androgynous young adult";
  return [
    `${subject}, solo, head and shoulders portrait, square avatar, cyberpunk, synthwave, neon lighting, polished game character portrait, expressive face, strong silhouette, readable small profile picture, high detail`,
    `${persona.name}, ${persona.role}`,
    persona.tags,
    "Influence social strategy game contestant, dramatic reality show cast portrait, clean background, no text, no letters, no logo, no signage",
  ].join(", ");
}

async function katanaFetch(
  config: { key: string; secret: string },
  endpoint: string,
  init: RequestInit = {},
): Promise<KatanaEnvelope> {
  const response = await fetch(`${KATANA_BASE_URL}${endpoint}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": config.key,
      "X-API-Secret": config.secret,
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) as KatanaEnvelope : {};
  if (!response.ok) {
    throw new Error(`Katana HTTP ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function submit(config: { key: string; secret: string }, persona: PersonaPrompt): Promise<string> {
  const body = {
    requests: [{
      type: "image",
      model: MODEL,
      prompt: promptFor(persona),
      negative_prompt: negativePrompt,
      aspect_ratio: "1:1",
      output_format: "png",
      is_uhd: false,
      use_assistant: false,
      metadata: {
        source: "influence-default-persona-pfps",
        personaKey: persona.key,
        personaName: persona.name,
      },
    }],
  };
  const envelope = await katanaFetch(config, "/v1/generation-requests?wait=false", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (envelope.status === "failed" || envelope.status === "rejected") {
    const error = envelope.responses?.[0]?.error;
    throw new Error(`${persona.key} rejected: ${error?.code ?? "unknown"} ${error?.message ?? ""}`);
  }
  if (!envelope.request_id) {
    throw new Error(`${persona.key} did not return request_id.`);
  }
  return envelope.request_id;
}

async function poll(config: { key: string; secret: string }, requestId: string): Promise<string> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < TIMEOUT_MS) {
    const envelope = await katanaFetch(config, `/v1/generation-requests/${encodeURIComponent(requestId)}`);
    if (envelope.status === "completed" || envelope.status === "partial_failure") {
      const asset = envelope.responses
        ?.flatMap((response) => response.output_assets ?? [])
        .find((candidate) => candidate.original_data_url || candidate.url);
      const url = asset?.original_data_url ?? asset?.url;
      if (!url) throw new Error(`${requestId} completed without an output asset.`);
      return url;
    }
    if (envelope.status === "failed" || envelope.status === "rejected") {
      const error = envelope.responses?.[0]?.error;
      throw new Error(`${requestId} failed: ${error?.code ?? "unknown"} ${error?.message ?? ""}`);
    }
    const delayMs = Math.max(1, envelope.poll_after_seconds ?? 2) * 1000;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  const final = await katanaFetch(config, `/v1/generation-requests/${encodeURIComponent(requestId)}`);
  throw new Error(`${requestId} timed out locally with status ${final.status ?? "unknown"}.`);
}

async function download(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}: ${url}`);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) throw new Error(`Download was not an image: ${contentType}`);
  return response.arrayBuffer();
}

function runSips(args: string[], outPath: string): void {
  const result = spawnSync("sips", args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`sips failed for ${outPath}: ${result.stderr || result.stdout}`);
  }
}

async function writeNormalizedPng(outPath: string, image: ArrayBuffer, crop?: PersonaPrompt["crop"]): Promise<void> {
  const tmpPath = `${outPath}.download`;
  await writeFile(tmpPath, Buffer.from(image));
  try {
    runSips(["-s", "format", "png", "-Z", "512", tmpPath, "--out", outPath], outPath);
    if (crop) {
      runSips([
        "-c",
        String(crop.height),
        String(crop.width),
        "--cropOffset",
        String(crop.offsetY),
        String(crop.offsetX),
        outPath,
        "--out",
        outPath,
      ], outPath);
      runSips(["-z", "512", "512", outPath, "--out", outPath], outPath);
    }
  } finally {
    await unlink(tmpPath).catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const config = credentials();
  await mkdir(OUT_DIR, { recursive: true });
  const selectedKeys = new Set(process.argv.slice(2));
  const selectedPersonas = selectedKeys.size > 0
    ? personas.filter((persona) => selectedKeys.has(persona.key))
    : personas;
  if (selectedPersonas.length === 0) {
    throw new Error(`No personas matched: ${[...selectedKeys].join(", ")}`);
  }

  for (const persona of selectedPersonas) {
    const outPath = path.join(OUT_DIR, `${persona.key}.png`);
    console.log(`[${persona.key}] submitting ${persona.name}`);
    const requestId = await submit(config, persona);
    console.log(`[${persona.key}] polling ${requestId}`);
    const assetUrl = await poll(config, requestId);
    const image = await download(assetUrl);
    await writeNormalizedPng(outPath, image, persona.crop);
    console.log(`[${persona.key}] wrote ${outPath}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
