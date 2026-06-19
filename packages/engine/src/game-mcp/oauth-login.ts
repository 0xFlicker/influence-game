#!/usr/bin/env bun
import {
  MCP_OAUTH_CALLBACK_PATH,
  MCP_OAUTH_CLIENT_ID,
  buildAuthorizeUrl,
  exchangeAuthorizationCode,
  generateOAuthSecret,
  parseOAuthCallbackUrl,
  pkceS256,
  requireSafeHttpBaseUrl,
} from "./oauth";
import {
  getMcpTokenFilePath,
  saveMcpOAuthToken,
} from "./oauth-token-store";

const DEFAULT_WEB_BASE_URL = "http://localhost:3001";
const DEFAULT_API_BASE_URL = "http://127.0.0.1:3000";
const DEFAULT_CALLBACK_HOST = "127.0.0.1";
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

async function main(): Promise<void> {
  const webBaseUrl = requireSafeHttpBaseUrl(
    process.env.INFLUENCE_MCP_WEB_BASE_URL ?? DEFAULT_WEB_BASE_URL,
    "INFLUENCE_MCP_WEB_BASE_URL",
  );
  const apiBaseUrl = requireSafeHttpBaseUrl(
    process.env.INFLUENCE_MCP_API_BASE_URL ?? DEFAULT_API_BASE_URL,
    "INFLUENCE_MCP_API_BASE_URL",
  );
  const callbackHost = process.env.INFLUENCE_MCP_CALLBACK_HOST ?? DEFAULT_CALLBACK_HOST;
  if (callbackHost !== "127.0.0.1" && callbackHost !== "localhost") {
    throw new Error("INFLUENCE_MCP_CALLBACK_HOST must be 127.0.0.1 or localhost");
  }
  const callbackPort = Number(process.env.INFLUENCE_MCP_CALLBACK_PORT ?? 0);
  if (!Number.isInteger(callbackPort) || callbackPort < 0 || callbackPort > 65535) {
    throw new Error("INFLUENCE_MCP_CALLBACK_PORT must be an integer between 0 and 65535");
  }

  const state = generateOAuthSecret();
  const codeVerifier = generateOAuthSecret();
  const codeChallenge = pkceS256(codeVerifier);

  let resolveCallback: (value: { code: string } | { error: Error }) => void;
  const callback = new Promise<{ code: string } | { error: Error }>((resolve) => {
    resolveCallback = resolve;
  });

  const server = Bun.serve({
    hostname: callbackHost,
    port: callbackPort,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname !== MCP_OAUTH_CALLBACK_PATH) {
        return new Response("Not found", { status: 404 });
      }

      const parsed = parseOAuthCallbackUrl(url, state);
      if (parsed.code) {
        resolveCallback({ code: parsed.code });
        return htmlResponse("Game MCP authorization complete. Return to your terminal.");
      }

      const message = parsed.errorDescription ?? parsed.error ?? "OAuth authorization failed";
      resolveCallback({ error: new Error(message) });
      return htmlResponse("Game MCP authorization did not complete. Return to your terminal.");
    },
  });

  const redirectUri = `http://${callbackHost}:${server.port}${MCP_OAUTH_CALLBACK_PATH}`;
  const authorizeUrl = buildAuthorizeUrl({
    webBaseUrl,
    clientId: MCP_OAUTH_CLIENT_ID,
    redirectUri,
    state,
    codeChallenge,
  });

  console.log("Open this URL to authorize Game MCP access:");
  console.log(authorizeUrl.toString());
  console.log("");

  if (process.env.INFLUENCE_MCP_OPEN_BROWSER === "1") {
    Bun.spawn(["open", authorizeUrl.toString()], {
      stdout: "ignore",
      stderr: "ignore",
    });
  }

  try {
    const result = await waitForCallback(callback);
    if ("error" in result) {
      throw result.error;
    }

    const token = await exchangeAuthorizationCode({
      apiBaseUrl,
      clientId: MCP_OAUTH_CLIENT_ID,
      code: result.code,
      redirectUri,
      codeVerifier,
    });
    const stored = saveMcpOAuthToken(token);

    console.log(`OAuth token issued and saved to ${getMcpTokenFilePath()}`);
    console.log(`Token expires at ${stored.expiresAt}`);
    console.log("Restart the MCP bridge; it will read the saved token automatically.");
    console.log(`export INFLUENCE_MCP_TOKEN_EXPIRES_IN='${token.expires_in}'`);
    if (process.env.INFLUENCE_MCP_PRINT_TOKEN === "1") {
      console.log(`export INFLUENCE_MCP_TOKEN='${escapeShellSingleQuoted(token.access_token)}'`);
    }
  } finally {
    server.stop(true);
  }
}

async function waitForCallback(
  callback: Promise<{ code: string } | { error: Error }>,
): Promise<{ code: string } | { error: Error }> {
  let timeout: Timer | undefined;
  const timeoutPromise = new Promise<{ error: Error }>((resolve) => {
    timeout = setTimeout(() => {
      resolve({ error: new Error("Timed out waiting for OAuth callback") });
    }, CALLBACK_TIMEOUT_MS);
  });

  try {
    return await Promise.race([callback, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function htmlResponse(message: string): Response {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>Influence Game MCP</title></head><body><main><h1>${message}</h1></main></body></html>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
    },
  );
}

function escapeShellSingleQuoted(value: string): string {
  return value.replace(/'/g, "'\\''");
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
