FROM oven/bun:1.3.14 AS bun
FROM node:24-bookworm-slim AS build
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /opt/codex
# Match Overclaw's verified Terra runtime version.
RUN bun add --exact @openai/codex@0.164.0
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends socat bubblewrap ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY --from=build /opt/codex /opt/codex
COPY codex.toml mcp-stdio.ts codex-entry.sh AGENTS.md SOUL.md CONSENT.md /opt/house/
USER 10004:10004
ENV PATH=/opt/codex/node_modules/.bin:$PATH
ENTRYPOINT ["/bin/sh", "/opt/house/codex-entry.sh"]
