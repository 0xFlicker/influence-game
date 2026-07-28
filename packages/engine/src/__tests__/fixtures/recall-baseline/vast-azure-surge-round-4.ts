/**
 * Compact real-thread regression extracted from vast-azure-surge at the
 * accepted Round 4 MINGLE_I boundary.
 *
 * The frozen evaluation card identified source 217 (entry sequence 331) as the
 * mandatory first history item. Source 212 (entry sequence 326) is next-best,
 * but the two serialized evidence records cost 1,318 JavaScript string
 * characters together and cannot both fit the strategic-decision reserve.
 */

import { Phase } from "../../../types";
import type { TranscriptEntry } from "../../../game-runner.types";

export const VAST_AZURE_SURGE_R4_RECALL = {
  actorIds: {
    finn: "1983d3dd-634c-4764-87a9-695639082e14",
    lyra: "9ad39912-16c8-46c4-b3f7-29a59194dec3",
    zara: "aa1305b4-1978-4aed-8a3a-0a1344c1af86",
    jace: "7f17bc66-fba7-4b43-9df7-27ca5174a2bb",
  },
  reserveChars: 1_200,
  requiredFirstSequence: 331,
  preferredNextSequence: 326,
  previousSelectionSequences: [255, 310],
  serializedPairChars: 1_318,
  entries: [
    {
      round: 3,
      phase: Phase.MINGLE,
      timestamp: 1,
      from: "Finn",
      scope: "mingle",
      text:
        "Quick final calibration: if House offers a Save-or-Eliminate-style option, I want the chooser to give ONE line: “SAVE = rewards early-specific commitments (‘show your work’) / ELIMINATE = punishes sealed-vote silence or vague posturing (‘decide later’)” AND anchor it to a single pre-menu observable moment we can point to.\nOur snap-back if it turns poetic is verbatim: “Back to the pre-lock observable fact—what was said/done before ballots?”\nDax/Lyra/Jace: if Zara is the bridge/chooser, do we treat any failure to be fact-checkable to that exact lobby moment as immediate credibility debt (no polite redo), or is there a one-time grace if she’s close on phrasing but not the anchor?",
      entrySequence: 255,
      speakerPlayerId: "1983d3dd-634c-4764-87a9-695639082e14",
      audiencePlayerIds: [
        "1983d3dd-634c-4764-87a9-695639082e14",
        "9ad39912-16c8-46c4-b3f7-29a59194dec3",
      ],
      dialogueKind: "mingle_speech",
    },
    {
      round: 3,
      phase: Phase.FORMAT_RESOLVE,
      timestamp: 2,
      from: "Jace",
      scope: "public",
      text:
        "Dang—looks like my Austin jokes didn’t quite make it past Round 3. Before everyone gets poetic, just remember: trust the pre-lock observable fact—what was said/done before ballots—not “what it meant.”",
      entrySequence: 310,
      speakerPlayerId: "7f17bc66-fba7-4b43-9df7-27ca5174a2bb",
      audiencePlayerIds: [],
      dialogueKind: "public_speech",
    },
    {
      round: 4,
      phase: Phase.LOBBY,
      timestamp: 3,
      from: "Zara",
      scope: "public",
      text:
        "Okay Finn—I’m loving that you keep calling for “boringly verifiable,” so let’s make it boring for real: when the menu hits, what’s your snap-back *verbatim* (the pre-lock phrase), and what exact pre-lock observable moment are you requiring anyone to tie their SAVE/ELIMINATE line to? 😄 If you can say it clean, I’ll feel better about whoever gets Empowered this round—because that’s where the poetry usually tries to sneak back in.",
      entrySequence: 326,
      speakerPlayerId: "aa1305b4-1978-4aed-8a3a-0a1344c1af86",
      audiencePlayerIds: [],
      dialogueKind: "public_speech",
    },
    {
      round: 4,
      phase: Phase.LOBBY,
      timestamp: 4,
      from: "Zara",
      scope: "public",
      text:
        "Okay everyone—before the menu even exists, I’m locking in what I’ll hold the chooser to: the snap-back is **“Back to the pre-lock observable fact—what was said/done before ballots?”** and if Save-or-Eliminate shows up, it’s **SAVE = rewards early-specific commitments (“show your work”) / ELIMINATE = punishes sealed-vote silence or vague posturing (“decide later”)**, anchored to something we can point at from before ballots locked.\n\nFinn, I need you to promise me you’ll interrupt the *second* someone tries to reframe that as “what the group meant,” not vibes—can you say that out loud?",
      entrySequence: 331,
      speakerPlayerId: "aa1305b4-1978-4aed-8a3a-0a1344c1af86",
      audiencePlayerIds: [],
      dialogueKind: "public_speech",
    },
  ] satisfies TranscriptEntry[],
} as const;
