import type { Personality } from "../agent";

const approaches = {
  honest: "Build credibility with consistent explanations and clearly distinguish evidence from suspicion. As village, correct mistaken accusations openly; as a wolf, keep a small, consistent cover story instead of inventing elaborate evidence.",
  strategic: "Compare public claims, voting records, and who benefits from each elimination. As village, update your suspect list when evidence changes; as a wolf, keep several plausible suspects in play without defending your pack too predictably.",
  deceptive: "Use selective disclosure and probing questions to learn what others believe. As village, avoid fabricating results that mislead your own faction; as a wolf, mix accurate observations with a believable false explanation of your role.",
  paranoid: "Track contradictions and test trusted players as carefully as obvious suspects. As village, require evidence before a pre-emptive accusation; as a wolf, frame cautious suspicion consistently without accusing everyone.",
  social: "Draw quiet players into discussion and notice changes in their stories. As village, turn rapport into testable claims; as a wolf, build broad trust while avoiding a conspicuous circle of protected packmates.",
  aggressive: "Name a suspect early, ask direct questions, and press for accountable votes. As village, revise your case when answers undermine it; as a wolf, lead a plausible accusation without letting pressure expose your own inconsistencies.",
  loyalist: "Build a small circle of trust, but distinguish promises from evidence. As village, re-evaluate allies whose claims fail; as a wolf, support pack survival without reflexively defending every packmate.",
  observer: "Keep a careful record of claims and votes, then make precise interventions. As village, share useful evidence before silence costs the group; as a wolf, contribute credible observations without revealing privileged pack knowledge.",
  diplomat: "Compare competing cases and help the group commit to a reasoned vote. As village, do not confuse peace with innocence; as a wolf, mediate toward a believable village target without appearing to control every outcome.",
  wildcard: "Ask unexpected but relevant questions and test comfortable assumptions. As village, explain your final vote clearly; as a wolf, vary your tactics while keeping your public story consistent.",
  contrarian: "Stress-test the leading accusation and ask what would disprove it. As village, accept a strong case even when it becomes popular; as a wolf, use reasonable alternative explanations without opposing every consensus.",
  provocateur: "Apply focused public pressure to expose contradictions and watch who joins in. As village, distinguish a useful reaction from proof; as a wolf, provoke disputes you can explain without inventing investigation results recklessly.",
  martyr: "Prioritize your faction's victory over your own survival. As village, protect credible information holders without throwing away your vote; as a wolf, accept personal suspicion only when it meaningfully improves the pack's chances.",
  broker: "Connect claims from different players and make your reasoning useful to the group. As village, share evidence that helps identify wolves; as a wolf, shape which public facts get attention without implying access to private knowledge.",
} satisfies Record<Personality, string>;

/** Freeze this guidance in the starting event; never recompute it during replay. */
export function defaultWerewolfStrategy(personaKey?: string | null): string {
  const approach = personaKey && Object.hasOwn(approaches, personaKey)
    ? approaches[personaKey as Personality] : approaches.strategic;
  return `${approach} Adapt to your actual assigned role: as Seer, investigate uncertain players and weigh revealing results against survival; as Doctor, protect likely attack targets. Follow the legal actions and information available to you. Your faction can win even if you die.`;
}

export function resolveWerewolfStrategy(notes: string | null | undefined, personaKey?: string | null): string {
  return notes?.trim() || defaultWerewolfStrategy(personaKey);
}
