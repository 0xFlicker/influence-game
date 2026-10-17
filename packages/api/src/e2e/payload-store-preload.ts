// Loaded explicitly by the browser harness; production never imports this module.
import { installE2ePayloadStore } from "./payload-store.js";
if (!process.env.DATABASE_URL) throw new Error("Missing isolated test database");
await installE2ePayloadStore(process.env.DATABASE_URL);
