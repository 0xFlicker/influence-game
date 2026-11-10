import type { DrizzleDB } from "../db/index.js";
import { processCharacterReference } from "../services/character-reference-jobs.js";

/** Mock only the provider transport; exercise the real worker, journal and storage. */
export async function processMockCharacterReference(
  db: DrizzleDB,
  image: Uint8Array,
  fallback = false,
) {
  const fetchBefore = globalThis.fetch;
  const keys = ["OPENAI_API_KEY", "XAI_API_KEY"] as const;
  const previous = keys.map((key) => process.env[key]);
  process.env.OPENAI_API_KEY = "provider-free-openai";
  process.env.XAI_API_KEY = "provider-free-xai";
  let images = 0;
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/images/")) {
        images++;
        if (fallback && url.includes("openai.com"))
          return new Response("Unavailable", { status: 503 });
        return Response.json({
          data: [{ b64_json: Buffer.from(image).toString("base64") }],
          usage: { images: 1 },
        });
      }
      // Localization fails explicitly so the user confirms the crop in the real UI.
      if (url.includes("openai.com"))
        return Response.json(
          { error: "Manual portrait fixture" },
          { status: 503 },
        );
      throw new Error(`Unexpected provider request: ${url}`);
    },
    { preconnect: fetchBefore.preconnect },
  );
  try {
    await processCharacterReference(db);
    return images;
  } finally {
    globalThis.fetch = fetchBefore;
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
  }
}
export function characterGenerationInput(requestId: string, name: string) {
  return {
    requestId,
    operation: "create",
    name,
    personaKey: "strategic",
    avatarUrl: null,
    fullBodyReferenceUrl: null,
    visualDesign: "A patient investigator in a bronze coat",
    performanceInstructions: "",
  };
}
