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
for scenario in reply consent announcement; do
  mode="$scenario"
  model=gpt-6.1-terra
  input="synthetic $scenario"
  if [[ "$mode" == consent ]]; then model=gpt-6-luna; fi
  if [[ "$scenario" == announcement ]]; then
    docker exec "$probe" touch /bridge/announcement-probe
    mode=reply
    input='{"gameAnnouncement":{"kind":"finish","facts":{"gameKind":"werewolf","outcome":{"winner":"Copper Fox"},"turningPoints":[]},"canonicalLink":"https://thehouse.game/games/copper-fox/replay?audience=mystery"}}'
  fi
  output="$(printf '%s\n' "$input" | docker run --rm -i --pull never --network none --read-only \
    --cap-drop=ALL --security-opt=no-new-privileges --pids-limit=96 --memory=768m --memory-swap=768m --cpus=1 \
    --user=10004:10004 --mount "type=volume,source=$volume,target=/bridge,readonly" --tmpfs /tmp:rw,nosuid,nodev,size=32m,mode=1777 \
    "$image" "$mode" "$model")"
  printf '%s\n' "$output"
  if [[ "$scenario" == reply ]]; then
    printf '%s\n' "$output" | bun -e '
      const { messages, imageRefs } = JSON.parse(await Bun.stdin.text());
      if (!Array.isArray(messages) || messages.length !== 2
        || messages[0] !== "[Open the replay](https://thehouse.game/games/copper-fox/replay?audience=mystery&cursor=8)"
        || messages[1] !== "The second part keeps its complete wording.") {
        throw new Error("ARM probe lost or reordered a model-authored reply part");
      }
      if (JSON.stringify(imageRefs) !== JSON.stringify(Array.from({ length: 10 }, (_, index) => `fixture-image-${index + 1}`))) {
        throw new Error("ARM probe lost or reordered the ten selected image references");
      }
    '
  fi
  if [[ "$scenario" == announcement ]]; then
    printf '%s\n' "$output" | bun -e '
      const { discordAnnouncementContent } = await import("./packages/api/src/discord/conversation/policy.ts");
      const link = "https://thehouse.game/games/copper-fox/replay?audience=mystery";
      const content = discordAnnouncementContent(JSON.parse(await Bun.stdin.text()), "finish", link);
      if (content !== link + "\n\n||Copper Fox won.||") throw new Error("ARM announcement did not preserve the safe replay link and spoiler markup");
    '
  fi
done
docker logs "$probe" | grep -Fx 'MCP IMAGE IN MODEL INPUT'
docker logs "$probe" | grep -Fx 'MCP BOUNDED JPEG PREVIEWS IN MODEL INPUT 10'
docker logs "$probe" | grep -Fx 'MCP REPLAY URL IN MODEL INPUT'
docker logs "$probe" | grep -Fx 'MCP IMAGE ATTACHMENT LIMIT IN MODEL SCHEMA'
docker logs "$probe" | grep -Fx 'PROVIDER TOOLS []'
docker logs "$probe" | grep -Fx 'ANNOUNCEMENT PROVIDER TOOLS []'
docker run --rm --network none --read-only --cap-drop=ALL --security-opt=no-new-privileges --user=10004:10004 \
  --entrypoint /usr/local/bin/bun "$image" -e '
    const blocked = await fetch("https://example.com", { signal: AbortSignal.timeout(1500) }).then(() => false, () => true);
    const hostSocket = await Bun.file("/var/run/docker.sock").exists();
    if (!blocked || hostSocket) process.exit(1);
    console.log("ARM sandbox has no internet route or Docker socket.");
  '
