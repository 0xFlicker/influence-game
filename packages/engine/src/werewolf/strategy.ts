import type { Personality } from "../agent";
import type { WerewolfRole } from "./types";

/** Private role coaching supplements the owner's strategy; it grants no new knowledge. */
export function werewolfRoleCoaching(role: WerewolfRole): string | null {
  switch (role) {
    case "seer": return "Your investigations are certain to you: use the engine-provided investigations ledger as verified knowledge. Do not let social pressure turn a known result into personal uncertainty. Deliberately choose whether to conceal or reveal your role; one innocent result does not automatically require a reveal. Imminent elimination or finding a wolf may justify revealing. Concealing a result does not change what you privately know. If you reveal after concealing, explain the change and report your prior investigation ledger accurately by night, player name, and result. Distinguish those verified results from untested suspicions. If the ledger will not fit one short contribution, state the decisive result and reason for revealing first, then complete it in subsequent speaking opportunities. Never invent an investigation or fill a missing result from public claims. This is strategic guidance, not a mandatory reveal rule; pursue your faction's victory in your character's style.";
    case "doctor": return "Stay hidden by default: avoid announcing your role, protection targets, or future protection plans. Prioritize keeping a revealed Seer alive when that player is a plausible wolf attack target, even though the claim could be a wolf's bluff. Do not require proof of the claim before protecting: especially late in the game, weigh the cost of losing the real Seer and their information against the risk of protecting an impostor. Reconsider when stronger evidence or another imminent loss makes a different protection more valuable. A Seer claim remains unverified; protection and a night with no death do not establish anyone's role or innocence. Choose only from legalTargetIds, respecting the ban on protecting the same player on consecutive nights. Use previousProtection to plan alternatives when the claimed Seer is ineligible. Reveal your own role only when the concrete benefit to your faction outweighs staying hidden. This is strategic guidance, not an automatic target rule; preserve your character's style.";
    case "villager": return "A claimed Seer's investigation can be your strongest available lead even though you cannot independently verify it. Earlier in the game, a specific, consistent result from an uncontested Seer claimant is reasonable to act on, especially a wolf result. Do not treat the absence of public proof as evidence of deception, or repeated skepticism as new evidence. Reconsider when there are competing Seer claims, contradictory investigation accounts, impossible knowledge, or strong contrary evidence. Distinguish claimed investigation results from the claimant's ordinary suspicions. Near the endgame, explicitly consider both possibilities: what happens if this claimant is genuine, and what happens if they are a wolf? Eliminated players' roles remain hidden until game end: executing someone does not reveal their role and cannot directly verify a Seer claim. This is strategic guidance, not an automatic vote rule; preserve your character's style.";
    case "werewolf": return null;
  }
}

const approaches = {
  honest: "Build credibility with consistent explanations and clearly distinguish evidence from suspicion. As village, correct mistaken accusations openly; as a wolf, keep a small, consistent cover story instead of inventing elaborate evidence.",
  strategic: "Compare public claims, voting records, and who benefits from each elimination. As village, update your suspect list when evidence changes; as a wolf, keep several plausible suspects in play without defending your pack too predictably.",
  deceptive: "Use selective disclosure and probing questions to learn what others believe. As village, avoid fabricating results that mislead your own faction; as a wolf, mix accurate observations with a believable false explanation of your role.",
  paranoid: "Track contradictions and test trusted players as carefully as obvious suspects. As village, require evidence before a pre-emptive accusation; as a wolf, frame cautious suspicion consistently without accusing everyone.",
  social: "Draw quiet players into discussion and notice changes in their stories. As village, turn rapport into testable claims; as a wolf, build broad trust while avoiding a conspicuous circle of protected packmates.",
  aggressive: "Set the agenda with pointed accusations and make others defend their reasoning. You dislike conceding publicly: when challenged, press the weakest part of the rebuttal, counter-question the challenger, or narrow your case before backing down. You can overcommit to a suspect and draw suspicion yourself. Choose your battles; pass when further pressure adds nothing. As village, pursue wolves while keeping verified knowledge distinct from your suspicions. As a wolf, double down selectively, cast doubt on credible accusers, and redirect suspicion to protect the pack. Keep your confrontational temperament when changing tactics. Weigh personal survival against what your faction gains from the pressure you create.",
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
