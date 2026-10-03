export const INFLUENCE_MCP_APP_RESOURCE_URI = "ui://influence/app";
export const INFLUENCE_MCP_APP_MIME_TYPE = "text/html";

const APP_TITLE = "The House";

export function createInfluenceMcpAppResource() {
  return {
    uri: INFLUENCE_MCP_APP_RESOURCE_URI,
    name: "House MCP App",
    mimeType: INFLUENCE_MCP_APP_MIME_TYPE,
    description: "Minimal app surface for proving authenticated House game reads.",
  };
}

export function createInfluenceMcpAppResourceContent(): {
  uri: string;
  mimeType: string;
  text: string;
  _meta: Record<string, unknown>;
} {
  return {
    uri: INFLUENCE_MCP_APP_RESOURCE_URI,
    mimeType: INFLUENCE_MCP_APP_MIME_TYPE,
    text: createInfluenceMcpAppHtml(),
    _meta: {
      "openai/widgetDescription": "Shows whether The House is connected and can discover Public games.",
      "openai/widgetPrefersBorder": true,
      "openai/widgetCSP": {
        connect_domains: [],
        resource_domains: [],
      },
    },
  };
}

export function createInfluenceMcpAppToolMeta(): Record<string, unknown> {
  return {
    "openai/outputTemplate": INFLUENCE_MCP_APP_RESOURCE_URI,
    "openai/widgetAccessible": true,
    "openai/toolInvocation/invoking": "Reading House games",
    "openai/toolInvocation/invoked": "House games ready",
  };
}

function createInfluenceMcpAppHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${APP_TITLE}</title>
  <style>
    :root {
      color-scheme: dark;
      background: #101214;
      color: #f4efe6;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    body {
      margin: 0;
      min-width: 0;
      background: #101214;
    }
    main {
      box-sizing: border-box;
      min-height: 100vh;
      padding: 20px;
      display: grid;
      align-content: start;
      gap: 14px;
    }
    h1 {
      margin: 0;
      font-size: 20px;
      line-height: 1.2;
      font-weight: 680;
    }
    p {
      margin: 0;
      color: #cfc6b8;
      font-size: 14px;
      line-height: 1.45;
    }
    .status {
      width: fit-content;
      border: 1px solid #4d5661;
      border-radius: 999px;
      padding: 5px 9px;
      color: #f4efe6;
      font-size: 12px;
      font-weight: 650;
    }
    .list {
      display: grid;
      gap: 8px;
      padding: 0;
      margin: 0;
      list-style: none;
    }
    .game {
      border: 1px solid #303841;
      border-radius: 8px;
      padding: 10px;
      background: #171a1e;
    }
    .game strong {
      display: block;
      overflow-wrap: anywhere;
      font-size: 14px;
    }
    .game span {
      display: block;
      margin-top: 3px;
      color: #aeb6bd;
      font-size: 12px;
    }
    .error {
      color: #ffd8a8;
    }
  </style>
</head>
<body>
  <main>
    <div class="status" id="status">Connecting</div>
    <h1>House games</h1>
    <p id="summary">Checking whether this host exposes the MCP app bridge.</p>
    <ul class="list" id="games" aria-live="polite"></ul>
  </main>
  <script>
    const statusEl = document.getElementById("status");
    const summaryEl = document.getElementById("summary");
    const gamesEl = document.getElementById("games");

    function setStatus(text, className) {
      statusEl.textContent = text;
      statusEl.className = className ? "status " + className : "status";
    }

    function renderGames(value) {
      const payload = value?.structuredContent;
      if (!payload || payload.schemaVersion !== 2 || !Array.isArray(payload.games)) throw new Error("Unsupported House catalog response");
      const games = payload.games;
      gamesEl.textContent = "";
      if (games.length === 0) {
        summaryEl.textContent = "Connected. No Public House games were returned.";
        return;
      }
      summaryEl.textContent = "Connected. " + games.length + " game" + (games.length === 1 ? "" : "s") + " available.";
      for (const game of games.slice(0, 5)) {
        const item = document.createElement("li");
        item.className = "game";
        const title = document.createElement("strong");
        title.textContent = String(game.slug || game.id || "House game");
        const meta = document.createElement("span");
        meta.textContent = [game.status, game.gameKind, game.createdAt].filter(Boolean).join(" · ");
        item.append(title, meta);
        gamesEl.append(item);
      }
    }

    function timeoutAfter(ms) {
      return new Promise((_, reject) => {
        window.setTimeout(() => reject(new Error("Timed out while reading House games.")), ms);
      });
    }

    async function callListGames() {
      const bridge = window.openai;
      if (!bridge || typeof bridge.callTool !== "function") {
        setStatus("Bridge unavailable", "error");
        summaryEl.textContent = "The host rendered the app resource, but did not expose a tool bridge.";
        return;
      }

      try {
        setStatus("Reading games");
        const result = await Promise.race([
          bridge.callTool("list_games", { limit: 5 }),
          timeoutAfter(15000),
        ]);
        setStatus("Connected");
        renderGames(result);
      } catch (error) {
        setStatus("Read failed", "error");
        summaryEl.textContent = error instanceof Error ? error.message : String(error);
      }
    }

    callListGames();
  </script>
</body>
</html>`;
}
