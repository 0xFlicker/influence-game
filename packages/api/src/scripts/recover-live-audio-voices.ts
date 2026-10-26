import { closeDB, createDB } from "../db/index.js";
import { prepareLiveVoiceRecovery, previewLiveVoiceRecovery } from "../services/audio-voice-recovery.js";

const [mode,path,...extra]=process.argv.slice(2);
if (!path || extra.length || mode!=="preview" && mode!=="prepare") throw new Error("Usage: bun src/scripts/recover-live-audio-voices.ts preview|prepare request.json");
const raw:unknown=await Bun.file(path).json();
if (!raw || typeof raw!=="object" || Array.isArray(raw)) throw new Error("Expected a recovery request object");
const input=raw as Record<string,unknown>;
if (Object.keys(input).some(key=>!["gameId","selections","previewHash"].includes(key))
  || typeof input.gameId!=="string" || !input.gameId.trim()
  || !input.selections || typeof input.selections!=="object" || Array.isArray(input.selections)
  || Object.values(input.selections).some(value=>typeof value!=="string")
  || input.previewHash!==undefined && typeof input.previewHash!=="string") throw new Error("Invalid recovery request");
const selections=input.selections as Record<string,string>;
if (mode==="prepare" && !input.previewHash) throw new Error("prepare requires the reviewed previewHash");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const db=createDB(process.env.DATABASE_URL);
try {
  const result=mode==="preview" ? await previewLiveVoiceRecovery(db,input.gameId,selections)
    : await prepareLiveVoiceRecovery(db,input.gameId,selections,input.previewHash as string);
  console.log(JSON.stringify(result,null,2));
} finally { await closeDB(process.env.DATABASE_URL); }
