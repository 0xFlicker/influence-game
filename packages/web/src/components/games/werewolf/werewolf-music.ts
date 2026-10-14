import type {WerewolfWatchMoment} from "@influence/engine/werewolf/watch-contract";
import type {MusicSection} from "@/components/watch/watch-music";

const tracks = {
  intro: {file: "lantern-to-fang-v1.mp3", title: "Lantern to Fang"},
  day: {file: "the-circle-closes-v1.mp3", title: "The Circle Closes"},
  pack: {file: "wolves-at-the-festival-v1.mp3", title: "Wolves at the Festival"},
  village: {file: "lanterns-still-burning-v1.mp3", title: "Lanterns Still Burning"},
};
/** Only the result entry can introduce an outcome cue. Retrospective entries
 * follow it, so they continue that same section rather than the introductions. */
export function werewolfMusic(moment: WerewolfWatchMoment | null | undefined): MusicSection | null {
  if (!moment) return null;
  const {entry, snapshot} = moment;
  let track: keyof typeof tracks;
  let section: string;
  let repeat = true;
  let continueAtEnd = false;
  if (entry.kind === "result" || entry.kind === "speech" && entry.purpose === "retrospective") {
    const faction = entry.kind === "result" ? entry.outcome.faction : snapshot.outcome?.faction;
    if (!faction) return null;
    track = faction === "village" ? "village" : "pack";
    section = `outcome:${faction}`; repeat = false; continueAtEnd = true;
  } else if (entry.kind === "pack_vote" || entry.kind === "speech" && entry.audience === "pack") {
    if (snapshot.audience !== "omniscient") return null;
    track = "pack"; section = `pack:${entry.day}`;
  } else if (entry.kind === "night" || entry.kind === "phase" && entry.phase === "night") {
    return null;
  } else if (entry.kind === "speech" && entry.audience === "public" || entry.kind === "phase" && entry.phase === "introduction") {
    track = "intro"; section = "intro";
  } else if (entry.kind === "discussion" || entry.kind === "vote" || entry.kind === "phase" && (entry.phase === "day" || entry.phase === "vote")) {
    track = "day"; section = `day:${entry.day}`;
  } else return null;
  return {key: `${snapshot.gameId}:${snapshot.audience}:${section}`, src: `/music/werewolf/v1/${tracks[track].file}`, title: tracks[track].title, repeat, continueAtEnd};
}
