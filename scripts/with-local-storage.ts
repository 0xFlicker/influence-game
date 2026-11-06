import { loadLocalStorageConfig, storageEnvironment } from "../packages/api/src/lib/local-development-storage";

const args = Bun.argv.slice(2);
if (!args.length) throw new Error("Supply the local development command");
if (process.env.NODE_ENV === "production" || process.env.DOPPLER_CONFIG && process.env.DOPPLER_CONFIG !== "dev") {
  throw new Error("Shared local storage wrapper is for local development only");
}
const config = await loadLocalStorageConfig();
if (!config && process.env.HOUSE_LOCAL_STORAGE_CONFIG) throw new Error("Explicit shared storage config is missing");
const child = Bun.spawn(args, { env: { ...process.env, ...(config ? storageEnvironment(config) : {}) }, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
process.exit(await child.exited);
