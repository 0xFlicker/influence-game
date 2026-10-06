import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { WerewolfLibraryCard } from "../components/games/werewolf/werewolf-library-card";
import type { WerewolfGameSummary } from "../lib/werewolf-api";

const game: WerewolfGameSummary = {id:"game-id",slug:"original-slug",gameKind:"werewolf",status:"completed",playerCount:6,joinedPlayers:6,modelLabel:"OpenAI gpt-6-luna",createdAt:"2026-10-05"};
test("old and waiting games use the same spoiler-safe village artwork", () => {
  for (const status of ["waiting","in_progress","completed"] as const) {
    const html=renderToString(<WerewolfLibraryCard game={{...game,status}} />);
    expect(html).toContain('/visual/werewolf/lantern-village.webp');
    expect(html).toContain('href="/games/original-slug"');
    expect(html).toContain('The House / Werewolf');
    expect(html).toContain(status === "waiting" ? "Casting open" : status === "in_progress" ? "Live" : "completed");
  }
});
test("operator episode copy and cover never change the route slug", () => {
  const html=renderToString(<WerewolfLibraryCard game={{...game,episode:{title:"Lanterns and Lies",description:"Six voices gather.",coverUrl:"https://example.test/approved-cover.png",cast:[],episodeNumber:null,status:"ready",locked:true,revision:2,frameOrder:[]}}} />);
  expect(html).toContain('Lanterns and Lies');expect(html).toContain('Six voices gather.');expect(html).toContain('https://example.test/approved-cover.png');
  expect(html).toContain('href="/games/original-slug"');expect(html).not.toContain('href="/games/Lanterns');
});
