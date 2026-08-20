import {
  createIsolatedTestDb,
  destroyIsolatedTestDb,
} from "./test-db.js";
import {
  startTestServers,
  stopTestServers,
  type TestServerHandles,
} from "./test-server.js";
import { seedFormatAwareGameViewerFixtures } from "./format-aware-game-viewer-fixture.js";
import { observeHarnessSignals } from "./harness-signals.js";
import { cleanupE2eResources } from "./cleanup.js";

let servers: TestServerHandles | null = null;
let isolatedDatabaseUrl: string | null = null;
let stopping = false;

async function main(): Promise<void> {
  const signals = observeHarnessSignals();
  let requestedShutdown: Promise<void> | null = null;
  try {
    const { db, databaseUrl } = await createIsolatedTestDb({ signal: signals.signal });
    isolatedDatabaseUrl = databaseUrl;
    signals.onRequest(() => { requestedShutdown ??= shutdown(); });
    if (signals.requested()) return;
    await seedFormatAwareGameViewerFixtures(db);
    if (signals.requested()) return;
    servers = await startTestServers({ databaseUrl, signal: signals.signal });
    if (signals.requested()) return;
    if (!servers.webUrl) throw new Error("Format viewer harness requires the web server");

    console.log(`E2E_FORMAT_VIEWER_READY ${JSON.stringify({
      webUrl: servers.webUrl,
    })}`);

    await signals.received;
  } finally {
    signals.dispose();
    await (requestedShutdown ?? shutdown());
  }
}

async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  await cleanupE2eResources([
    ["servers", async () => { if (servers) await stopTestServers(servers); }],
    ["database", async () => {
      if (!isolatedDatabaseUrl) return;
      await destroyIsolatedTestDb(isolatedDatabaseUrl);
      isolatedDatabaseUrl = null;
    }],
  ]);
}

await main().catch(async (error) => {
  console.error(error);
  await shutdown();
  process.exitCode = 1;
});
