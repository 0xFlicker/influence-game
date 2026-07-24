import { describe, expect, it } from "bun:test";
import { createActor } from "xstate";
import { createPhaseMachine } from "../phase-machine";
import { Phase } from "../types";

const PLAYERS = ["alice", "bob", "charlie", "dana", "echo", "finn"];

async function advance(actor: ReturnType<typeof createActor<ReturnType<typeof createPhaseMachine>>>): Promise<void> {
  actor.send({ type: "PHASE_COMPLETE" });
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function createCadenceActor(playerIds = PLAYERS) {
  const actor = createActor(createPhaseMachine(), {
    input: {
      gameId: "game-cadence",
      playerIds,
      maxRounds: 5,
    },
  });
  const started: Phase[] = [];
  actor.on("PHASE_STARTED", (event) => started.push(event.phase));
  actor.start();
  return { actor, started };
}

describe("named alliance round cadence", () => {
  it("runs alliance formation and the scarce pre-format huddle before Vote and FORMAT_MENU", async () => {
    const { actor, started } = createCadenceActor();

    await advance(actor); // init -> introduction
    await advance(actor); // introduction -> lobby
    await advance(actor); // lobby -> mingle_i
    await advance(actor); // mingle_i -> pre_vote_huddle
    await advance(actor); // pre_vote_huddle -> vote

    actor.send({ type: "VOTES_TALLIED", empoweredId: "alice" });
    await advance(actor); // vote -> format_menu

    expect(actor.getSnapshot().value).toBe("format_menu");
    expect(started).toEqual([
      Phase.INIT,
      Phase.INTRODUCTION,
      Phase.LOBBY,
      Phase.MINGLE_I,
      Phase.PRE_VOTE_HUDDLE,
      Phase.VOTE,
      Phase.FORMAT_MENU,
    ]);

    actor.stop();
  });

  it("routes FORMAT_MENU through pick, format-aware Mingle, and resolution in order", async () => {
    const { actor, started } = createCadenceActor();

    await advance(actor); // init -> introduction
    await advance(actor); // introduction -> lobby
    await advance(actor); // lobby -> mingle_i
    await advance(actor); // mingle_i -> pre_vote_huddle
    await advance(actor); // pre_vote_huddle -> vote
    actor.send({ type: "VOTES_TALLIED", empoweredId: "alice" });
    await advance(actor); // vote -> format_menu
    expect(actor.getSnapshot().value).toBe("format_menu");
    await advance(actor); // format_menu -> format_pick
    expect(actor.getSnapshot().value).toBe("format_pick");
    await advance(actor); // format_pick -> format_mingle
    expect(actor.getSnapshot().value).toBe("format_mingle");
    await advance(actor); // format_mingle -> format_resolve
    expect(actor.getSnapshot().value).toBe("format_resolve");
    expect(started.slice(-4)).toEqual([
      Phase.FORMAT_MENU,
      Phase.FORMAT_PICK,
      Phase.FORMAT_MINGLE,
      Phase.FORMAT_RESOLVE,
    ]);

    actor.stop();
  });

  it("routes one format elimination to the next Lobby without starting the retired classic lane", async () => {
    const { actor, started } = createCadenceActor();

    await advance(actor); // init -> introduction
    await advance(actor); // introduction -> lobby
    await advance(actor); // lobby -> mingle_i
    await advance(actor); // mingle_i -> pre_vote_huddle
    await advance(actor); // pre_vote_huddle -> vote
    actor.send({ type: "VOTES_TALLIED", empoweredId: "alice" });
    await advance(actor); // vote -> format_menu
    await advance(actor); // format_menu -> format_pick
    await advance(actor); // format_pick -> format_mingle
    await advance(actor); // format_mingle -> format_resolve
    actor.send({ type: "PLAYER_ELIMINATED", playerId: "bob" });
    actor.send({ type: "UPDATE_ALIVE_PLAYERS", aliveIds: ["alice", "charlie", "dana", "echo", "finn"] });
    await advance(actor); // format_resolve -> checkGameOver -> lobby

    expect(actor.getSnapshot().value).toBe("lobby");
    expect(started.at(-1)).toBe(Phase.LOBBY);
    expect(started).not.toContain(Phase.POST_VOTE_MINGLE);
    expect(started).not.toContain(Phase.POWER);
    expect(started).not.toContain(Phase.REVEAL);
    expect(started).not.toContain(Phase.PRE_COUNCIL_HUDDLE);
    expect(started).not.toContain(Phase.COUNCIL);

    actor.stop();
  });
});
