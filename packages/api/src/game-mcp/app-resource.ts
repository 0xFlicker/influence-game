export const INFLUENCE_MCP_APP_RESOURCE_URI = "ui://influence/app";
export const INFLUENCE_MCP_APP_MIME_TYPE = "text/html";

const APP_TITLE = "Influence";

export function createInfluenceMcpAppResource() {
  return {
    uri: INFLUENCE_MCP_APP_RESOURCE_URI,
    name: "Influence MCP App",
    mimeType: INFLUENCE_MCP_APP_MIME_TYPE,
    description: "Minimal app surface for proving authenticated Influence game reads.",
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
      "openai/widgetDescription": "Shows whether Influence is connected and can read the user's games.",
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
    "openai/toolInvocation/invoking": "Reading Influence games",
    "openai/toolInvocation/invoked": "Influence games ready",
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
    <h1>Influence games</h1>
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

    function extractPayload(value) {
      if (value && Array.isArray(value.content)) {
        const text = value.content.find((item) => item && item.type === "text" && typeof item.text === "string");
        if (text) {
          return JSON.parse(text.text);
        }
      }
      return value || {};
    }

    function renderGames(value) {
      const payload = extractPayload(value);
      const games = Array.isArray(payload && payload.canonicalGameFacts && payload.canonicalGameFacts.games)
        ? payload.canonicalGameFacts.games
        : Array.isArray(payload && payload.games)
          ? payload.games
          : [];
      gamesEl.textContent = "";
      if (games.length === 0) {
        summaryEl.textContent = "Connected. No Influence games were returned for this account yet.";
        return;
      }
      summaryEl.textContent = "Connected. " + games.length + " game" + (games.length === 1 ? "" : "s") + " available.";
      for (const game of games.slice(0, 5)) {
        const item = document.createElement("li");
        item.className = "game";
        const title = document.createElement("strong");
        title.textContent = String(game.slug || game.id || "Influence game");
        const meta = document.createElement("span");
        meta.textContent = [game.status, game.trackType, game.createdAt].filter(Boolean).join(" · ");
        item.append(title, meta);
        gamesEl.append(item);
      }
    }

    function timeoutAfter(ms) {
      return new Promise((_, reject) => {
        window.setTimeout(() => reject(new Error("Timed out while reading Influence games.")), ms);
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
