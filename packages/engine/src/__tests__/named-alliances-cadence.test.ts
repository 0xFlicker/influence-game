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
  it("runs Mingle I and pre-vote huddles before public Vote, then post-vote Mingle after Vote", async () => {
    const { actor, started } = createCadenceActor();

    await advance(actor); // init -> introduction
    await advance(actor); // introduction -> lobby
    await advance(actor); // lobby -> mingle_i
    await advance(actor); // mingle_i -> pre_vote_huddle
    await advance(actor); // pre_vote_huddle -> vote

    actor.send({ type: "VOTES_TALLIED", empoweredId: "alice" });
    await advance(actor); // vote -> post_vote_mingle

    expect(actor.getSnapshot().value).toBe("post_vote_mingle");
    expect(started).toEqual([
      Phase.INIT,
      Phase.INTRODUCTION,
      Phase.LOBBY,
      Phase.MINGLE_I,
      Phase.PRE_VOTE_HUDDLE,
      Phase.VOTE,
      Phase.POST_VOTE_MINGLE,
    ]);

    actor.stop();
  });

  it("routes pass/protect power through Reveal and pre-Council huddles before Council", async () => {
    const { actor } = createCadenceActor();

    await advance(actor); // init -> introduction
    await advance(actor); // introduction -> lobby
    await advance(actor); // lobby -> mingle_i
    await advance(actor); // mingle_i -> pre_vote_huddle
    await advance(actor); // pre_vote_huddle -> vote
    actor.send({ type: "VOTES_TALLIED", empoweredId: "alice" });
    await advance(actor); // vote -> post_vote_mingle
    await advance(actor); // post_vote_mingle -> power
    actor.send({ type: "CANDIDATES_DETERMINED", candidates: ["bob", "charlie"], autoEliminated: null });
    await advance(actor); // power -> reveal

    expect(actor.getSnapshot().value).toBe("reveal");

    await advance(actor); // reveal -> pre_council_huddle
    expect(actor.getSnapshot().value).toBe("pre_council_huddle");

    await advance(actor); // pre_council_huddle -> council
    expect(actor.getSnapshot().value).toBe("council");

    actor.stop();
  });

  it("skips pre-Council huddles and Council when Power eliminates", async () => {
    const { actor } = createCadenceActor();

    await advance(actor); // init -> introduction
    await advance(actor); // introduction -> lobby
    await advance(actor); // lobby -> mingle_i
    await advance(actor); // mingle_i -> pre_vote_huddle
    await advance(actor); // pre_vote_huddle -> vote
    actor.send({ type: "VOTES_TALLIED", empoweredId: "alice" });
    await advance(actor); // vote -> post_vote_mingle
    await advance(actor); // post_vote_mingle -> power
    actor.send({ type: "CANDIDATES_DETERMINED", candidates: null, autoEliminated: "bob" });
    actor.send({ type: "PLAYER_ELIMINATED", playerId: "bob" });
    actor.send({ type: "UPDATE_ALIVE_PLAYERS", aliveIds: ["alice", "charlie", "dana", "echo", "finn"] });
    await advance(actor); // power -> checkGameOver -> lobby

    expect(actor.getSnapshot().value).toBe("lobby");

    actor.stop();
  });
});
