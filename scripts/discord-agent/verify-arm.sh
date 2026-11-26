#!/usr/bin/env bash
# Provider-free verification. The fixture and Codex share only a test volume.
set -euo pipefail
cd "$(dirname "$0")/../.."
probe="house-discord-proof-$$"
volume="$probe-volume"
image="$probe:local"
fixture_dir="$(mktemp -d)"
cleanup() {
  if (( $? != 0 )); then docker logs "$probe" 2>&1 || true; fi
  docker rm -f "$probe" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
  docker image rm "$image" >/dev/null 2>&1 || true
  rm -r "$fixture_dir"
}
trap cleanup EXIT
docker build --platform linux/arm64 -t "$image" packages/api/src/discord/conversation
docker volume create "$volume" >/dev/null
cp scripts/discord-agent/arm-fixture.ts packages/api/src/discord/conversation/{policy,sandbox}.ts "$fixture_dir/"
docker run -d --name "$probe" --platform linux/arm64 --network none \
  --mount "source=$volume,target=/bridge" --mount "type=bind,src=$fixture_dir,dst=/fixture,readonly" \
  oven/bun:1.3.14 bun /fixture/arm-fixture.ts >/dev/null
for _ in {1..30}; do
  if docker logs "$probe" 2>&1 | grep -Fxq READY; then break; fi
  sleep 1
done
docker logs "$probe" 2>&1 | grep -Fxq READY
for mode in reply consent; do
  model=gpt-6.1-terra
  if [[ "$mode" == consent ]]; then model=gpt-6-luna; fi
  printf 'synthetic %s\n' "$mode" | docker run --rm -i --pull never --network none --read-only \
    --cap-drop=ALL --security-opt=no-new-privileges --pids-limit=96 --memory=768m --memory-swap=768m --cpus=1 \
    --user=10004:10004 --mount "type=volume,source=$volume,target=/bridge,readonly" --tmpfs /tmp:rw,nosuid,nodev,size=32m,mode=1777 \
    "$image" "$mode" "$model"
done
docker logs "$probe" | grep -Fx 'MCP IMAGE IN MODEL INPUT'
docker logs "$probe" | grep -Fx 'PROVIDER TOOLS []'
docker run --rm --network none --read-only --cap-drop=ALL --security-opt=no-new-privileges --user=10004:10004 \
  --entrypoint /usr/local/bin/bun "$image" -e '
    const blocked = await fetch("https://example.com", { signal: AbortSignal.timeout(1500) }).then(() => false, () => true);
    const hostSocket = await Bun.file("/var/run/docker.sock").exists();
    if (!blocked || hostSocket) process.exit(1);
    console.log("ARM sandbox has no internet route or Docker socket.");
  '
