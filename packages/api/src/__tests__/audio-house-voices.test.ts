import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { getHousePortraitGender, HOUSE_CAST } from "@influence/engine";
import { assignPlayerVoice, PLAYER_VOICES } from "@influence/engine/voice-catalog";
import { startWerewolf, werewolfConfig } from "@influence/engine/werewolf";
import { schema, type DrizzleDB } from "../db/index.js";
import { freezeLiveVoices, previewGameVoices } from "../services/audio-voices.js";
import { readJson } from "../services/payload-storage.js";
import { createWerewolfHousePlayers } from "../services/werewolf-games.js";
import { setupTestDB } from "./test-utils.js";

let db: DrizzleDB;
beforeEach(async () => { db = await setupTestDB(); });

for (const gameKind of ["influence", "werewolf"] as const) {
  test(`${gameKind} House voices match roster gender and remain frozen`, async () => {
    const gameId = `house-voices-${gameKind}`;
    await db.insert(schema.games).values({ id: gameId, slug: gameId, gameKind, status: "in_progress", config: "{}" });
    // Exclude the rest of the catalog so the reported identities are always tested.
    const names = ["Jace", "Kael", "Atlas", "Vera", "Mira", "Wren"];
    const players = createWerewolfHousePlayers(HOUSE_CAST.filter(member => !names.includes(member.name)), 6);
    expect(players.map(player => player.name).sort()).toEqual(names.sort());
    for (const player of players) expect(player.gender).toBe(getHousePortraitGender(player.name, player.personaKey));
    if (gameKind === "werewolf") {
      const event = startWerewolf(gameId, players, werewolfConfig("one_wolf"), "house-voices");
      await db.insert(schema.werewolfEvents).values({ gameId, sequence: event.sequence, event });
    } else {
      await db.insert(schema.gamePlayers).values(players.map(player => ({ id: player.id, gameId, persona: JSON.stringify(player), agentConfig: "{}" })));
    }
    const voices = await previewGameVoices(db, gameId);
    for (const player of players) {
      const voice = voices[player.id]!;
      expect(player.gender).toBe(PLAYER_VOICES.find(candidate => candidate.id === voice.voiceId)?.gender);
      expect(voice).toEqual(assignPlayerVoice(player.id, player.gender ?? null));
    }
    expect(await db.select().from(schema.gameAudioTracks)).toHaveLength(0);
    await db.transaction(tx => freezeLiveVoices(tx, gameId));
    const [track] = await db.select().from(schema.gameAudioTracks);
    expect(await readJson(track!.voices)).toEqual(voices);
    await db.transaction(tx => freezeLiveVoices(tx, gameId));
    expect(await db.select().from(schema.gameAudioTracks)).toHaveLength(1);
    expect(await db.select().from(schema.agentVoices)).toHaveLength(0);
  });
}

test("historical missing genders stay unspecified and owned manual choices take precedence", async () => {
  const gameId = "house-voices-historical";
  await db.insert(schema.users).values({ id: "owner" });
  await db.insert(schema.agentProfiles).values({ id: "profile", userId: "owner", name: "Custom character", personality: "Calm", gender: "male" });
  const selected = assignPlayerVoice("profile", "male", "ara");
  await db.insert(schema.agentVoices).values({ agentProfileId: "profile", assignment: selected });
  await db.insert(schema.games).values({ id: gameId, slug: gameId, status: "completed", config: "{}" });
  await db.insert(schema.gamePlayers).values([
    { id: "legacy", gameId, persona: JSON.stringify({ name: "Jace" }), agentConfig: "{}" },
    { id: "owned", gameId, agentProfileId: "profile", persona: JSON.stringify({ name: "Custom character", gender: "male" }), agentConfig: "{}" },
    { id: "deleted-profile", gameId, persona: JSON.stringify({ name: "Unfamiliar character", gender: "female" }), agentConfig: "{}" },
    { id: "nonbinary", gameId, persona: JSON.stringify({ name: "Another character", gender: "non-binary" }), agentConfig: "{}" },
  ]);
  const voices = await previewGameVoices(db, gameId);
  expect(voices.legacy).toEqual(assignPlayerVoice("legacy", null));
  expect(voices.owned).toEqual(selected);
  expect(voices["deleted-profile"]).toEqual(assignPlayerVoice("deleted-profile", "female"));
  expect(voices.nonbinary).toEqual(assignPlayerVoice("nonbinary", "non-binary"));
  // No read-time catalog/name inference, even for a built-in name.
  await db.update(schema.gamePlayers).set({ persona: JSON.stringify({ name: "Atlas" }) }).where(eq(schema.gamePlayers.id, "legacy"));
  expect((await previewGameVoices(db, gameId)).legacy).toEqual(voices.legacy);
});
