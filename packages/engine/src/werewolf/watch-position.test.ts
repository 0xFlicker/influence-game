import {expect, test} from "bun:test";
import {completedCurrentWerewolfFixture, completedWerewolfResultsFixture, werewolfResultsFixture} from "../fixtures/werewolf-results";
import {mapWerewolfWatchCue, projectWerewolfProductionProvenance, projectWerewolfProductionWatch} from "./watch";

test.each([7, 8, 9, 10, 11] as const)("audience mapping follows the accepted public event for Werewolf v%i", async version => {
  const events = version === 7 ? await werewolfResultsFixture("saved", "map-v7") : version === 8 ? await completedWerewolfResultsFixture("saved", "map-v8") : await completedCurrentWerewolfFixture(`map-v${version}`, version);
  if (version === 7) {
    const started = events[0];
    if (!started || started.type !== "werewolf.started") throw new Error("Missing v7 fixture start");
    events[0] = {...started,payload:{...started.payload,config:{...started.payload.config,rulesVersion:7}}};
  }
  const mystery = projectWerewolfProductionWatch(events, "mystery");
  const omni = projectWerewolfProductionWatch(events, "omniscient");
  const mysteryEvents = projectWerewolfProductionProvenance(events, "mystery");
  const omniEvents = projectWerewolfProductionProvenance(events, "omniscient");
  const silent = mystery.moments.find(moment => !mystery.playback.some(row => row.cursor === moment.cursor));
  if (silent) {
    const sourceEvent = mysteryEvents.find(row => row.cursor === silent.cursor)!;
    const boundary = omniEvents.findLast(row => row.eventSequence <= sourceEvent.eventSequence);
    const preceding = omni.playback.findLast(row => row.cursor <= (boundary?.cursor ?? 0));
    expect(mapWerewolfWatchCue(events, "mystery", "omniscient", silent.cursor, `${mystery.gameId}:mystery:${silent.cursor}:boundary`))
      .toEqual({cursor:preceding?.cursor ?? null,key:preceding?.keys.at(-1) ?? null,exact:false,boundaryCursor:boundary?.cursor ?? null});
  }
  const dawn = mystery.moments.find(moment => moment.entry.kind === "night")!;
  const mysteryKey = mystery.playback.find(row => row.cursor === dawn.cursor)!.keys.at(-1)!;
  const event = mysteryEvents.find(row => row.cursor === dawn.cursor)!;
  const omniCursor = omniEvents.find(row => row.eventSequence === event.eventSequence)!.cursor;
  const expected = omni.playback.find(row => row.cursor === omniCursor)!.keys.at(-1)!;
  expect(mapWerewolfWatchCue(events, "mystery", "omniscient", dawn.cursor, mysteryKey)).toEqual({cursor:omniCursor,key:expected,exact:true});
  expect(mapWerewolfWatchCue(events, "omniscient", "mystery", omniCursor, expected)).toEqual({cursor:dawn.cursor,key:mysteryKey,exact:true});
  const privateKey = omni.playback.find(row => row.cursor === omniCursor)!.keys.find(key => /:(protect|investigate|hunt)(:decision)?$/.test(key));
  if (privateKey) {
    const previous = mysteryEvents.filter(row => row.eventSequence < event.eventSequence).findLast(row => mystery.playback.some(play => play.cursor === row.cursor));
    const mapped = mapWerewolfWatchCue(events, "omniscient", "mystery", omniCursor, privateKey);
    expect(mapped.cursor).toBe(previous?.cursor ?? null);
    expect(mapped.exact).toBe(false);
  }
  expect(() => mapWerewolfWatchCue(events, "mystery", "omniscient", dawn.cursor, expected)).toThrow("Unavailable watch cue");
  if (version === 7) return;
  const last = mystery.playback.at(-1)!;
  const lastEvent = mysteryEvents.find(row => row.cursor === last.cursor)!;
  const omniLast = omniEvents.find(row => row.eventSequence === lastEvent.eventSequence)!;
  expect(mapWerewolfWatchCue(events, "mystery", "omniscient", last.cursor, `${mystery.gameId}:mystery:${last.cursor}:reprise`)).toEqual({cursor:omniLast.cursor,key:`${omni.gameId}:omniscient:${omniLast.cursor}:reprise`,exact:true});
});
