import { createDB, closeDB } from "../db/index.js";
import { prepareVoiceSamples } from "../services/voice-samples.js";
if (!Bun.argv.includes("--apply"))
  throw new Error(
    "Pass --apply to generate the versioned stock voice samples using xAI.",
  );
try {
  await prepareVoiceSamples(createDB());
} finally {
  await closeDB();
}
