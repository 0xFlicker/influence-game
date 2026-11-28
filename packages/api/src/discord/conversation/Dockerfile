FROM oven/bun:1.3.14 AS bun
FROM node:24-bookworm-slim AS build
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /opt/codex
# Match Overclaw's verified Terra runtime version.
RUN bun add --exact @openai/codex@0.164.0
WORKDIR /opt/preview
RUN bun add --exact sharp@0.34.5 --registry https://registry.npmjs.org
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends socat bubblewrap ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY --from=build /opt/codex /opt/codex
COPY --from=build /opt/preview /opt/preview
COPY mcp-stdio.ts /opt/preview/
COPY codex.toml codex-entry.sh AGENTS.md SOUL.md CONSENT.md /opt/house/
USER 10004:10004
ENV PATH=/opt/codex/node_modules/.bin:$PATH
ENTRYPOINT ["/bin/sh", "/opt/house/codex-entry.sh"]
