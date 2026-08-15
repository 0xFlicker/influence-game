import type { PromptScenarioChain } from "../../../prompt-scenario-lab";
import type { PhaseContext, TranscriptEntry } from "../../../game-runner.types";
import { Phase } from "../../../types";

const players = {
  Zara: { id: "1e846a8f-4df7-4cc4-a94e-c74452769080", name: "Zara" },
  Finn: { id: "3004e489-824b-499d-be5a-0bcb3f0755c4", name: "Finn" },
  Orion: { id: "4530b4c0-2420-4898-b37c-6106c745d19c", name: "Orion" },
  Riven: { id: "4c939381-9900-40cc-b842-ec310078f85c", name: "Riven" },
  Sage: { id: "6a475bad-4341-45fd-9af1-1dd44a2b2232", name: "Sage" },
  Thane: { id: "737802c5-77b0-48db-954f-0939934c2587", name: "Thane" },
  Atlas: { id: "959a13b1-9701-4cf8-851f-c82220a0ae02", name: "Atlas" },
  Luna: { id: "a0eda268-2c65-4d43-b5eb-13da39a4b5c0", name: "Luna" },
  Vera: { id: "b2b43c24-19cd-4feb-ac26-a3dce07faf7f", name: "Vera" },
  Jace: { id: "cf6ce4a7-8814-462d-b343-91d29d7fd036", name: "Jace" },
  Mira: { id: "d1a4b63e-993d-442e-80e8-5d343e4564f0", name: "Mira" },
  Lyra: { id: "d73010a9-8ef2-4454-9482-e0a90c881da9", name: "Lyra" },
} as const;

const fullRoster = Object.values(players);
const roundTwoAlive = fullRoster.filter((player) => player.id !== players.Atlas.id);

const roundTwoPublicMessages: PhaseContext["publicMessages"] = [
  {
    from: "Riven",
    text: "Atlas’s warning is fair, and I’m trying not to turn one clean-looking consensus into a group hug with a alibi attached. Sage, I still value the way you held the room, but that vote for Thane is a receipt I need you to explain plainly—not because it proves anything, but because trust gets stronger when the exception has a reason. For empower, I’m leaning toward someone who will make a clear call and own it afterward; calm is lovely, but calm without accountability is just very elegant fog.",
    phase: Phase.LOBBY,
    round: 2,
  },
  {
    from: "Sage",
    text: "The Thane vote was deliberate, not a protest against anyone: after everyone converged on me, I wanted a trusted barometer beside the wheel so my first read could be tested rather than simply echoed. I’m comfortable owning that choice, and I agree that consensus needs pressure—not panic, but questions with actual answers. For the next empower, I’d be glad to see Luna tested; she listens closely, and I suspect she’ll know when a room is hiding behind a group hug.",
    phase: Phase.LOBBY,
    round: 2,
  },
  {
    from: "Thane",
    text: "The receipt is easy to explain from my side: I empowered Sage because I genuinely thought she’d make the strongest first call, and her vote for me reads more like a deliberate test than a betrayal. I’m glad she owned it plainly; I’d rather have a visible disagreement than a room full of polite fog. For the next empower, Luna feels like a good fresh test—warm, observant, and hopefully willing to turn Monsieur Whiskers-level information control into an actual decision.",
    phase: Phase.LOBBY,
    round: 2,
  },
  {
    from: "Zara",
    text: "I’m with the “fresh test” instinct on Luna—she’s been listening closely, and I’d like to see whether Monsieur Whiskers’ most trusted correspondent can make a clean call when the room gets muddy. The Sage/Thane receipt feels explained rather than incriminating to me; what matters now is whether everyone can own their choices without hiding behind consensus. I’m keeping my eye on the people who sound agreeable in every direction, because even cookies need a little structure or they become crumbs.",
    phase: Phase.LOBBY,
    round: 2,
  },
  {
    from: "The House",
    text: "Majority Elimination ballots: Mira→Lyra; Lyra→Sage; Luna→Sage; Riven→Sage; Vera→Sage; Sage→Lyra; Thane→Lyra; Zara→Lyra; Finn→Lyra; Jace→Thane; Orion→Lyra",
    phase: Phase.FORMAT_RESOLVE,
    round: 2,
  },
  {
    from: "Lyra",
    text: "I’m disappointed to be leaving, but I’m grateful for the conversations and the people who challenged me directly. One gentle warning from the analyst in me: when a room reaches agreement this smoothly, keep asking what everyone may be overlooking. Take care, everyone.",
    phase: Phase.FORMAT_RESOLVE,
    round: 2,
  },
];

const baseTranscript: TranscriptEntry[] = [
  {
    round: 2,
    phase: Phase.LOBBY,
    timestamp: 1_786_799_449_643,
    from: "Riven",
    scope: "public",
    text: roundTwoPublicMessages[0]!.text,
    entrySequence: 117,
    speakerPlayerId: players.Riven.id,
    audiencePlayerIds: [],
  },
  {
    round: 2,
    phase: Phase.LOBBY,
    timestamp: 1_786_799_458_220,
    from: "Sage",
    scope: "public",
    text: roundTwoPublicMessages[1]!.text,
    entrySequence: 119,
    speakerPlayerId: players.Sage.id,
    audiencePlayerIds: [],
  },
  {
    round: 2,
    phase: Phase.LOBBY,
    timestamp: 1_786_799_462_739,
    from: "Thane",
    scope: "public",
    text: roundTwoPublicMessages[2]!.text,
    entrySequence: 120,
    speakerPlayerId: players.Thane.id,
    audiencePlayerIds: [],
  },
  {
    round: 2,
    phase: Phase.LOBBY,
    timestamp: 1_786_799_466_182,
    from: "Zara",
    scope: "public",
    text: roundTwoPublicMessages[3]!.text,
    entrySequence: 121,
    speakerPlayerId: players.Zara.id,
    audiencePlayerIds: [],
  },
  {
    round: 2,
    phase: Phase.FORMAT_RESOLVE,
    timestamp: 1_786_799_973_032,
    from: "The House",
    scope: "system",
    text: roundTwoPublicMessages[4]!.text,
    entrySequence: 193,
    audiencePlayerIds: [],
  },
  {
    round: 2,
    phase: Phase.FORMAT_RESOLVE,
    timestamp: 1_786_799_975_946,
    from: "Lyra",
    scope: "public",
    text: roundTwoPublicMessages[5]!.text,
    entrySequence: 197,
    speakerPlayerId: players.Lyra.id,
    audiencePlayerIds: [],
  },
];

const roundThreeMessages = [
  ["Mira", "Lyra’s warning about smooth agreement is still hanging over the room, so I’m less interested in who can make a polished explanation than who keeps the same standard when it costs them something. Luna got the wheel and made a real call; I’m watching who engages with that call honestly and who suddenly discovers that accountability is only important when it points away from them. Monsieur Whiskers, please log the hypocrisy.", 202, 1_786_800_003_167],
  ["Luna", "Lyra’s warning gets one final sticky note on the fridge, then we move on before the house forms a memorial committee. I’m leaning **Zara for empower**: she’s been willing to question the comfortable explanation without needing the room to applaud first, and I want to see whether that independence survives the big red button. If we’re going to test accountability, let’s not keep handing the microphone to the same beautifully coordinated choir.", 203, 1_786_800_009_093],
  ["Riven", "Lyra’s warning gets a brief nod, but I’m with Luna on giving Zara the wheel—she’s shown she can question comfort without needing permission, and I want to see whether that independence holds when the call has consequences. I’m also saying this plainly: accountability cannot mean relitigating the same receipt until the room gets the answer it wants; if we test someone, we owe them a real standard and an honest record. Zara, take the microphone—but don’t let the choir choose your song before you’ve heard the room.", 204, 1_786_800_013_788],
  ["Vera", "Lyra gets a brief curtain call, but the play continues. I’m comfortable putting the wheel in **Zara’s** hands—she’s questioned the comfortable story without demanding applause, and I want to see whether that independence survives an actual decision. Zara, make the call plainly, name the standard, and don’t let any beautifully synchronized choir hand you the script; I’ve had enough bad direction for one lifetime.", 205, 1_786_800_017_893],
  ["Sage", "Lyra gets her brief curtain call; now the living choices matter. I’ve answered the Thane receipt plainly, and I won’t ask anyone to protect me out of familiarity—but if we’re applying an accountability standard, let’s examine who keeps reopening an answered question rather than allowing a current pressure campaign to become its own alibi. Zara, take the wheel independently; I’ll accept the result, but I hope the call is based on what is happening now, not on a receipt the room has already logged.", 206, 1_786_800_022_541],
  ["Thane", "Lyra gets a brief nod, but the living board needs a current question—not another autopsy of a receipt I’ve already answered. If Zara is genuinely taking an independent wheel, my provisional concern is **Sage**: not because her Thane vote is unexplained, but because her influence keeps defining which explanations count as “settled” and which remain “pressure.” Zara, make the call on a live standard; I’ll accept scrutiny, but I won’t let accountability become a permission slip for a pile-on built on yesterday’s evidence.", 207, 1_786_800_028_420],
  ["Zara", "I appreciate the trust, genuinely—but if I get the wheel, nobody is handing me a prewritten script, no matter how beautifully synchronized the choir sounds. I’m not interested in turning an already-answered receipt into a permanent subscription; I want a current standard, and I’ll be watching who can actually own a position instead of agreeing elegantly in every direction. Monsieur Whiskers can keep the logs, but the living board gets the decision.", 208, 1_786_800_033_943],
  ["Finn", "Zara has my support for empower. She’s earned the chance to make a call without inheriting a script from either the choir or the counter-choir. I’m wary of turning one old receipt into a permanent conviction; whoever gets tested should be judged on a current, specific record—and I’ll expect the same standard from everyone, including the people I trust.", 209, 1_786_800_041_662],
  ["Jace", "Zara gets my empower vote—I’d rather hand the microphone to someone who says she won’t inherit a script than keep replaying the same episode until Monsieur Whiskers files a grievance. I’m watching the current board, not treating an answered receipt as a life sentence, and I’d ask everyone pushing a target to name a living player and a concrete present-tense reason. If we’re testing independence, let’s actually let Zara make an independent call instead of applauding her while quietly handing her our homework.", 210, 1_786_800_047_843],
  ["Orion", "Zara still gets my empower vote—I want the microphone in the hands of someone who says she’ll make her own call. For the ballot, my provisional target is **Sage**: not because the Thane receipt needs another autopsy, but because her influence is now shaping which questions count as settled and which become “pressure.” If we’re testing independence, test the person with the most ability to define the test.", 211, 1_786_800_053_543],
] as const;

const roundThreePublicMessages: PhaseContext["publicMessages"] = roundThreeMessages.map(
  ([from, text]) => ({ from, text, phase: Phase.LOBBY, round: 3 }),
);

const roundThreeTranscript: TranscriptEntry[] = roundThreeMessages.map(
  ([from, text, entrySequence, timestamp]) => ({
    round: 3,
    phase: Phase.LOBBY,
    timestamp,
    from,
    scope: "public" as const,
    text,
    entrySequence,
    speakerPlayerId: players[from as keyof typeof players].id,
    audiencePlayerIds: [],
  }),
);

export const ACCEPTED_SAGE_ROUND_2_SCENARIO = {
  reportKey: "7be4b087afd93e79df10bc9a",
  comparisonKey: "e3d20b018fc1b9fd39a6cd55",
  source: {
    acceptedAt: "2026-08-15",
    label: "Sage Round 2",
    game: {
      id: "c8c891fe-9ef1-4019-8e43-d61a26735c33",
      slug: "calm-cyan-frost",
      status: "completed",
      startedAt: "2026-08-15T13:03:38.344Z",
      endedAt: "2026-08-15T14:14:16.085Z",
      playerCount: 12,
      modelCatalogId: "openai:gpt-5.6-luna",
      serviceTier: "flex",
      reasoningPolicy: "action-policy",
      sourceRevision: "265999b6+staged-alliance-opportunity-fix",
      formatManifest: [
        "save_or_eliminate",
        "vote_bomb",
        "safety_bounce",
        "majority_elimination",
      ],
    },
    canonical: {
      priorEliminationSequence: 102,
      eliminationSequence: 221,
      roundResultSequence: 223,
      eliminatedPlayerId: players.Lyra.id,
    },
    decisions: {
      firstDiary: {
        decisionId: "4622aadc-711f-4fd2-9c43-1ff11a4d398a",
        evidenceManifestId: "355e372f-6feb-4536-8450-715b03a039fe",
        transcriptIds: [18829, 18835],
        totalTokens: 9_280,
      },
      followUpDiary: {
        decisionId: "d020fd20-3d2c-4d34-82d0-2a7ea62935b1",
        evidenceManifestId: "32d3b4a7-9877-4b74-984d-dffb6aa74377",
        transcriptIds: [18843, 18852],
        totalTokens: 9_371,
      },
      nextLobby: {
        decisionId: "cf08aa9f-697c-417e-b88f-ab9d4894d834",
        evidenceManifestId: "b1238cbd-02c4-4842-8d19-11aac1d675ad",
        transcriptIds: [18303],
        totalTokens: 8_645,
      },
      nextVote: {
        decisionId: "441f75eb-d11c-4b51-98cd-8cdd00a6789c",
        evidenceManifestId: "7e9e0e0a-ba2a-4c2c-9a70-214d2623da4b",
        transcriptIds: [],
        totalTokens: 9_142,
      },
    },
  },
  actor: { id: players.Sage.id, name: players.Sage.name, personality: "observer" },
  model: "gpt-5.6-luna",
  fullRoster,
  previouslyEliminatedPlayerIds: [players.Atlas.id],
  phaseContext: {
    gameId: "c8c891fe-9ef1-4019-8e43-d61a26735c33",
    round: 2,
    phase: Phase.DIARY_ROOM,
    selfId: players.Sage.id,
    selfName: players.Sage.name,
    alivePlayers: roundTwoAlive,
    publicMessages: roundTwoPublicMessages,
    mingleMessages: [],
    empoweredId: players.Luna.id,
    gameEventRecord: [
      "Round 1: Vote Bomb eliminated Atlas; Sage was empowered.",
      "Round 2: Majority Elimination eliminated Lyra 6-4-1; Luna was empowered.",
    ],
  },
  continuity: {
    compactStrategy: {
      lifecycle: "active",
      baseline: "Own Atlas as a provisional, evidence-based anchor rather than a personal vendetta; preserve Thane as a trusted barometer, audit the six-person bloc after the public empower receipts, and quietly identify who profited from the first cut.",
      deltas: [
        "Set Lyra as a provisional target and move to Room 1 to gather another signal; preserve flexibility rather than lock the bloc prematurely.",
        "Hold Lyra as the provisional target; defend Thane without overcommitting, and use Room 2 to test whether the broader vote bloc supports Lyra.",
        "Survival posture: frame the Sage vote as a coordinated pile-on after an answered receipt, consolidate the existing Lyra counterbloc, and preserve Luna as the tie-break audience.",
        "Formalize the four-person Lyra counterbloc while maintaining a single evidence-based pivot condition.",
        "Consolidate the five-person Lyra bloc through ballot lock, while preserving the agreed single-pivot condition if the count fails or materially stronger evidence emerges.",
        "Hold the Lyra bloc through ballot lock, while watching whether the opposing Sage votes consolidate enough to make Luna’s tiebreak decisive.",
        "Formalize the four-person Lyra bloc through ballot lock, while preserving the single-pivot condition if the count fails or materially stronger evidence emerges.",
        "Maintain Lyra as the pressure target while treating the Sage pile-on and Luna's tiebreak posture as the immediate survival risk.",
      ],
      priorEpoch: null,
      revision: 18,
    },
  },
  transcript: baseTranscript,
  eliminatedPlayerId: players.Lyra.id,
  diary: {
    firstQuestion: "You asked for Luna to be “tested,” yet her first empowered round ended with Lyra eliminated—and Lyra’s final warning was that the room’s agreement came too smoothly; do you still see Luna as a genuine barometer, or as someone who benefited from that consensus?",
    firstResponse: {
      message: "I still see Luna as a genuine barometer—but a barometer can be calibrated by the weather around it. She did make the call, and I respect that she put her name behind an accountability test; at the same time, the room’s smooth agreement gave her very little resistance to measure herself against, and Lyra’s warning is still ringing in my ears. I’m not planning revenge on Luna, but I am watching who keeps borrowing her certainty—and quietly building connections outside that current.",
      thinking: "Luna was not merely carried by consensus: she made a consequential call, but the smooth agreement may have made that call easier and less independently tested. Her vote against me matters, yet I should distinguish a principled accountability test from a personal threat. Lyra’s warning reinforces my need to audit the coalition and build relationships beyond the obvious bloc, without rushing into revenge.",
      strategy: "Treat Luna as a consequential, potentially principled swing rather than a protected ally; preserve the relationship while auditing who shaped her consensus and expanding beyond the current bloc.",
    },
    followUp: {
      question: "You say you’re watching who keeps borrowing Luna’s certainty and building connections outside her current, but you voted to empower Luna alongside nearly everyone else; which specific player—Vera, Thane, or someone quieter—do you suspect is using that consensus as cover?",
      response: {
        message: "The quieter player I’m watching is Riven. Vera at least announces her discomfort theatrically, and Thane has been plain with me; Riven’s vote for me was wrapped in such warm language that it could be either genuine accountability or very elegant cover. My next move is to ask Riven what evidence would actually change their mind—and to keep Luna close enough that I can tell whether she is making her own weather or merely reporting it.",
        thinking: "Riven is the quieter player whose language feels most consensus-compatible: warm, reasonable, and able to turn a trust vote into an accountability test. Vera is more transparent because she announces her theatrical discomfort, while Thane has been direct and remains a useful reality check. I should not overcommit to suspicion; I need to test Riven privately and keep Luna engaged without treating her as safe.",
        strategyDelta: "Audit Riven as the most plausible consensus-cover player; preserve Thane and cautiously maintain Luna while testing her independence.",
      },
    },
  },
  nextLobby: {
    response: {
      thinking: "I need to survive the apparent accountability pile-on without sounding desperate. Frame the Thane vote as answered, distinguish current conduct from historical receipt, and place Lyra's repeated auditing as the live pressure point while respecting Zara's likely empowerment.",
      message: roundThreePublicMessages[4]!.text,
      strategyDelta: null,
    },
  },
  nextVote: {
    publicMessages: roundThreePublicMessages,
    transcriptAppend: roundThreeTranscript,
    response: {
      thinking: "Zara is the strongest chooser seat this round. She has broad support, has explicitly resisted inheriting a script, and—unlike Thane or Orion—has not publicly committed to making me the target. Empowering her gives the stated independence a real test while preserving a relationship I may still need regardless of tonight’s format.",
      empower: players.Zara.name,
      strategyDelta: "Treat Zara as the pivotal swing: support her independence, but prepare for the possibility that her current-standard language still resolves against me.",
    },
  },
} satisfies PromptScenarioChain;
