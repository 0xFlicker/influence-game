/**
 * Influence Game — HTTP API Server
 *
 * Bun + Hono server. This is the entry point for the game API.
 */

import { Hono } from "hono";

const app = new Hono();

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

app.get("/health", (c) => {
  return c.json({
    status: "ok",
    service: "influence-api",
    version: "0.6.0",
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

app.get("/", (c) => {
  return c.json({
    name: "Influence Game API",
    version: "0.6.0",
    endpoints: {
      health: "/health",
    },
  });
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

const port = parseInt(process.env.PORT ?? "3000", 10);

console.log(`Influence API listening on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
