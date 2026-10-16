import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { EpisodeCard, castSlideshowFrames, episodeFallbackFrames } from "../app/games/episode-preview";
import type { WerewolfGameSummary } from "../lib/werewolf-api";

const game: WerewolfGameSummary = {id:"game-id",slug:"original-slug",gameKind:"werewolf",status:"completed",playerCount:6,joinedPlayers:6,modelLabel:"OpenAI gpt-6-luna",createdAt:"2026-10-05"};
test("old and waiting games use the same spoiler-safe village artwork", () => {
  for (const status of ["waiting","in_progress","completed"] as const) {
    const html=renderToString(<EpisodeCard game={{...game,status}} />);
    expect(html).toContain('/visual/werewolf/lantern-village.webp');
    expect(html).toContain('href="/games/original-slug"');
    expect(html).toContain('The House / Werewolf');
    expect(html).toContain(status === "waiting" ? "Casting open" : status === "in_progress" ? "Live" : "Completed");
  }
});
test("operator episode copy and cover never change the route slug", () => {
  const html=renderToString(<EpisodeCard game={{...game,episode:{title:"Lanterns and Lies",description:"Six voices gather.",coverUrl:"https://example.test/approved-cover.png",cast:[],episodeNumber:null,status:"ready",locked:true,revision:2,frameOrder:[]}}} />);
  expect(html).toContain('Lanterns and Lies');expect(html).toContain('Six voices gather.');expect(html).toContain('https://example.test/approved-cover.png');
  expect(html).toContain('href="/games/original-slug"');expect(html).not.toContain('href="/games/Lanterns');
});

test("cast groups remain separate ordinary frames with no pagination controls or House badge", () => {
  const cast = Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, name: `Agent ${i}`, avatarUrl: null, personaKey: null }));
  const frames = episodeFallbackFrames({ episode: { cast, coverUrl: null } });
  expect(frames.map(frame => frame.players?.length)).toEqual([4, 4, 1]);
  expect(frames.map(frame => frame.label)).toEqual(["Meet the cast", "Meet the cast", "Meet the cast"]);
  expect(castSlideshowFrames([{ id: "alliance", kind: "cast", label: "Garden Map Pair", players: cast }]).map(frame => ({ label: frame.label, players: frame.players?.map(player => player.id) }))).toEqual([
    { label: "Garden Map Pair", players: ["p0", "p1", "p2", "p3"] },
    { label: "Garden Map Pair", players: ["p4", "p5", "p6", "p7"] },
    { label: "Garden Map Pair", players: ["p8"] },
  ]);
  const html = renderToString(<EpisodeCard game={{ ...game, status: "waiting", joinedPlayers: 1, episode: { title: "A village", description: "Casting", cast: cast.slice(0, 1), coverUrl: null, episodeNumber: null, status: "unrequested", locked: false, revision: 0, frameOrder: [] } }} />);
  expect(html).toContain("Agent 0");
  expect(html).toContain("1/6 joined");
  expect(html).toContain("Join game");
  expect(html).not.toContain("pagination");
  expect(html).not.toContain("/logo.png");
});
