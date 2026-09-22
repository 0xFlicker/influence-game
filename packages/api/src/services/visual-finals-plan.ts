import { selectActiveJury, type GameState } from "@influence/engine";
import { planVisualScene, type VisualCastMember, type VisualScenePlan } from "@influence/engine/visual-scene-plan";

/** Shared by live preparation and an operator's committed-boundary rebuild. */
export function planFinalsScene(state: GameState, cast: readonly VisualCastMember[], backgroundArtifactId: string | null, previous?: { id: string; plan: VisualScenePlan }) {
  const finalists = state.getAlivePlayerIds();
  const ids = [...new Set([...finalists, ...selectActiveJury(state.jury, state.getAllPlayers().length).map((member) => member.playerId)])];
  return planVisualScene({ roomId: "finals", backgroundArtifactId, previous: previous?.plan,
    cast: ids.map((id) => {
      const member = cast.find((entry) => entry.id === id);
      if (!member) throw new Error("Finals participant lacks a frozen reference");
      return member;
    }),
    roles: Object.fromEntries(ids.map((id) => [id, finalists.includes(id) ? "finalist" : "juror"])),
    allianceGroups: state.getHuddleEligibleAlliances().map((alliance) => alliance.memberIds),
    cues: state.getCanonicalEvents().flatMap((event) => event.type === "visual.cue_recorded" && event.payload.sceneId === previous?.id
      ? [{ playerId: event.payload.playerId, cue: event.payload.cue }] : []),
  });
}
