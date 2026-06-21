---
date: 2026-06-21
topic: homepage-dashboard-mcp-setup-cta
---

# Homepage and Dashboard MCP Setup CTA Requirements

## Summary

Influence should add a public homepage CTA and a small authenticated Dashboard callout that send players to `/get-mcp`, a player-facing setup page for connecting their Influence games to Codex or Claude Code through the existing `/mcp` MCP resource. The page should prioritize copyable command-line setup, keep the scope to user `games` access, and avoid advertising the internal producer MCP surface.

---

## Problem Frame

Influence already has a deployed user-facing MCP resource at `/mcp` with OAuth `scope=games`, but the capability is discoverable mostly through developer docs. The primary user is an AI/game tinkerer, and the product strategy says AI app compatibility should meet users in the tools where they already experiment.

The homepage should give curious visitors one clear signal that Influence works with AI coding clients. The current dashboard already clusters the user's game history and agents, so it should reinforce that promise at the moment a signed-in player can connect their own games.

The human setup page cannot live at `/mcp`, because `/mcp` is the protocol endpoint and deployment routing sends that traffic to the API. A distinct web route such as `/get-mcp` avoids protocol/UI ambiguity.

---

## Key Decisions

- **Two-surface discovery.** The homepage gets a lightweight public CTA, and the authenticated dashboard gets a more contextual bridge near the user's game history and agents.
- **Use `/get-mcp` for the human page.** `/mcp` remains the Streamable HTTP MCP resource endpoint; `/get-mcp` is the web setup route.
- **Player MCP only.** The page advertises only the user-facing `/mcp` resource and `scope=games`; `/mcp/producer` remains internal developer/maintainer knowledge.
- **Command snippets first.** Codex and Claude Code setup should be presented as copyable CLI commands, with manual config editing omitted from the normal path.
- **Keep the page lean.** This is a setup doorway, not a complete MCP troubleshooting center or protocol explainer.

---

## Actors

- A1. Curious visitor evaluating whether Influence fits their AI-tool workflow.
- A2. Signed-in Influence player or agent owner who has games, agents, or both.
- A3. Signed-in player with no game history yet.
- A4. Codex user connecting Influence through the Codex CLI.
- A5. Claude Code user connecting Influence through the Claude CLI.
- A6. Influence app, acting as the OAuth authorization page and MCP token producer.

---

## Requirements

**Homepage CTA**

- R1. The public homepage must include a concise CTA for connecting Influence games to Codex or Claude Code.
- R2. The homepage CTA must link to `/get-mcp` and must not point directly at `/mcp`.
- R3. The homepage copy must frame the value as bringing Influence games into AI coding clients, not as generic MCP protocol access.
- R4. The homepage CTA must stay lightweight and must not compete with the primary watch/play invitation.

**Dashboard Callout**

- R5. The authenticated dashboard must include a compact callout inviting players to connect their Influence games to Codex or Claude Code.
- R6. The dashboard callout must link to `/get-mcp` and must not point directly at `/mcp`.
- R7. The dashboard callout copy must frame the value as using the player's Influence games from AI tools, not as generic protocol access.
- R8. The dashboard callout must work for players with and without game history; empty-history copy may encourage connecting after joining or completing a game.

**Setup Page**

- R9. `/get-mcp` must be a web page for humans and must describe the existing `/mcp` resource as the player-facing MCP endpoint.
- R10. The setup page must present Codex and Claude Code as the supported setup paths for this slice.
- R11. The Codex path must use command-line setup as the primary instruction shape: add the MCP server by URL, then run the OAuth login flow.
- R12. The Claude Code path must use command-line setup as the primary instruction shape: add the HTTP MCP server, then authenticate from Claude Code.
- R13. The page must display copyable commands with the deployed `/mcp` URL resolved for the current environment.
- R14. The page must not present manual TOML or JSON editing as a normal setup path.

**Access Boundary Copy**

- R15. The page must describe the grant as access to the signed-in user's Influence games through MCP.
- R16. The page must state that player MCP does not grant maintainer access, producer inspection, private trace content, or internal developer evidence.
- R17. The page must not mention `/mcp/producer`, `scope=mcp`, private trace tools, or producer-only capabilities in player-facing setup copy.
- R18. The page must link or hand off to the existing OAuth authorization flow instead of attempting to mint or display tokens itself.

**Behavior and Error Handling**

- R19. Signed-out users who open `/get-mcp` must be invited to sign in before completing the OAuth-backed setup.
- R20. The page should remain useful before sign-in by explaining what the MCP connection does and showing the general setup shape.
- R21. The page must make clear that authorization completes in the browser after the MCP client starts OAuth.
- R22. The page may include one short "Having trouble?" note, but full operational diagnostics and deployment readiness checks stay outside this slice.

---

## Key Flows

- F1. Homepage discovery
  - **Trigger:** A visitor opens the homepage.
  - **Actors:** A1
  - **Steps:** The homepage shows a lightweight CTA for connecting Influence games to Codex or Claude Code; the visitor follows it to `/get-mcp`.
  - **Outcome:** The visitor understands AI-client compatibility before signing in or joining a game.
  - **Covered by:** R1-R4

- F2. Dashboard discovery
  - **Trigger:** A signed-in player opens the dashboard.
  - **Actors:** A2, A3
  - **Steps:** The dashboard shows the MCP callout near game history and agents; the player follows the CTA to `/get-mcp`.
  - **Outcome:** The player reaches the setup page without needing developer docs.
  - **Covered by:** R5-R8

- F3. Codex setup
  - **Trigger:** A player chooses the Codex instructions on `/get-mcp`.
  - **Actors:** A2, A4, A6
  - **Steps:** The player copies the Codex add command for the current `/mcp` URL, runs the Codex login command, and completes OAuth in the browser.
  - **Outcome:** Codex can use the player-facing Influence MCP server with the user's `games` access.
  - **Covered by:** R9-R21

- F4. Claude Code setup
  - **Trigger:** A player chooses the Claude Code instructions on `/get-mcp`.
  - **Actors:** A2, A5, A6
  - **Steps:** The player copies the Claude HTTP MCP add command, opens Claude Code's MCP authentication flow, and completes OAuth in the browser.
  - **Outcome:** Claude Code can use the player-facing Influence MCP server with the user's `games` access.
  - **Covered by:** R9-R21

---

## Acceptance Examples

- AE1. **Covers R1-R4.**
  - **Given:** a visitor opens the homepage.
  - **When:** the page loads.
  - **Then:** the visitor sees a concise CTA linking to `/get-mcp` and describing Codex or Claude Code setup without sending them directly to `/mcp`.

- AE2. **Covers R5-R8.**
  - **Given:** a signed-in player visits the dashboard.
  - **When:** the dashboard loads.
  - **Then:** the player sees a compact MCP callout that links to `/get-mcp` and describes connecting their Influence games to Codex or Claude Code.

- AE3. **Covers R9, R13, R17.**
  - **Given:** a player opens `/get-mcp`.
  - **When:** the setup page renders.
  - **Then:** the visible endpoint in setup commands is the environment's `/mcp` URL, and the page does not advertise `/mcp/producer`.

- AE4. **Covers R11, R12, R14.**
  - **Given:** a player is choosing a setup path.
  - **When:** they view the Codex or Claude Code instructions.
  - **Then:** the primary action is a copyable CLI command, not manual config-file editing.

- AE5. **Covers R15-R18.**
  - **Given:** a player reads the access explanation.
  - **When:** they start the OAuth-backed setup.
  - **Then:** they understand the grant as access to their games through MCP, not producer/private-trace access.

- AE6. **Covers R19-R21.**
  - **Given:** a signed-out visitor opens `/get-mcp`.
  - **When:** they try to complete setup.
  - **Then:** the page asks them to sign in and explains that the MCP client will complete authorization in the browser.

---

## Success Criteria

- A visitor can discover AI-client setup from the homepage without reading repo docs.
- A signed-in player can rediscover MCP setup from the dashboard near their game and agent context.
- A player can copy the Codex and Claude Code commands from `/get-mcp` and understand the follow-up OAuth step.
- The setup page never advertises producer/internal MCP access to players.
- Manual config editing is absent from the primary setup path.
- `/mcp` continues to be treated as the protocol endpoint, while `/get-mcp` is the human setup page.

---

## Scope Boundaries

In scope:

- Authenticated dashboard callout.
- Lightweight homepage CTA.
- `/get-mcp` player setup page.
- Codex and Claude Code command-line snippets.
- Player-facing access explanation for `/mcp` and `scope=games`.
- Minimal sign-in and OAuth-flow guidance.

Out of scope:

- Advertising `/mcp/producer`, `scope=mcp`, private trace tools, or producer inspection.
- General MCP protocol documentation.
- Full troubleshooting or deployment-readiness diagnostics.
- Manual config-file instructions as the normal path.
- Rules-page or top-nav promotion.
- Token display, token copying, or direct token management in the web app.

---

## Dependencies and Assumptions

- The deployed `/mcp` resource and OAuth metadata remain the source of truth for player MCP access.
- The web app can determine or render the current environment's public `/mcp` URL for snippets.
- Codex supports adding a Streamable HTTP MCP server by URL through `codex mcp add <name> --url <url>` and authenticating with `codex mcp login <name>`.
- Claude Code supports adding an HTTP MCP server through `claude mcp add --transport http <name> <url>` and authenticating from its MCP flow.
- Caddy and app routing continue to send `/mcp` to the API, so the human setup route must be distinct.

---

## Sources / Research

- Product strategy: `STRATEGY.md`
- MCP vocabulary and trust boundaries: `CONCEPTS.md`
- Production MCP docs: `docs/game-mcp-production-oauth.md`
- Prior Games MCP scope requirements: `docs/brainstorms/2026-06-19-games-scope-mcp-oauth-hardening-requirements.md`
- Homepage surface: `packages/web/src/app`
- Dashboard surface: `packages/web/src/app/dashboard/dashboard-content.tsx`
- Existing app routes: `packages/web/src/app`
- Local CLI confirmation: `codex mcp add --help`, `claude mcp add --help`
