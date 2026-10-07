import type { HouseCutsResponse } from "@influence/engine/house-cuts/publication";
export function houseCutsFixture(audience: "public" | "mystery" | "omniscient" = "public"): HouseCutsResponse {
  return { game: { id: "game-id", slug: "edge-smoke-dusk", kind: audience === "public" ? "influence" : "werewolf" }, audience, status: "ready", publication: { version: "v1", audience, cuts: [{
    id: "v1-1", title: "A Seer claim changes the argument", context: "A conversation takes a turn.", angle: "Certainty has an audience.", payoff: null,
    participants: [{ id: "a", name: "Kaiya" }], quotes: [{ name: "Kaiya", text: "I am the seer." }], sourceRefs: ["e:1"], replayHref: "/games/edge-smoke-dusk/replay?audience=omniscient&cursor=1",
  }] } };
}
