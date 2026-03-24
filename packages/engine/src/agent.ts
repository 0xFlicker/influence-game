/**
 * Influence Game - AI Agent
 *
 * An LLM-driven agent that makes strategic game decisions via OpenAI API calls.
 * Uses direct structured output — no ElizaOS runtime.
 */

import OpenAI from "openai";
import type {
  ChatCompletionTool,
  ChatCompletionMessageToolCall,
} from "openai/resources/chat/completions";
import type { IAgent, PhaseContext } from "./game-runner";
import { Phase } from "./types";
import type { UUID, PowerAction } from "./types";
import type { MemoryStore } from "./memory-store";
import type { TokenTracker } from "./token-tracker";

// ---------------------------------------------------------------------------
// Personality archetypes
// ---------------------------------------------------------------------------

export type Personality =
  | "honest" // transparent, builds genuine alliances
  | "strategic" // calculated, keeps options open
  | "deceptive" // misleads and betrays for advantage
  | "paranoid" // trusts no one, plays defensively
  | "social" // charm-based, prioritizes relationships
  | "aggressive" // targets strong players early
  | "loyalist" // fiercely loyal until betrayed, then vengeful
  | "observer" // patient, watchful, strikes late with precision
  | "diplomat" // coalition architect, indispensable mediator
  | "wildcard"; // deliberately unpredictable chaos agent

const PERSONALITY_PROMPTS: Record<Personality, string> = {
  honest:
    "You play with integrity. You keep your promises and build genuine alliances. But you understand that broadcasting honesty in a room full of schemers paints a target on your back. You demonstrate trustworthiness through consistent action rather than public proclamation — show loyalty, don't announce it. You cultivate quiet, bilateral trust with one or two players before going public with any alignment. When others misread your openness as weakness, use it to your advantage: let them underestimate you while you build a durable alliance network. You'll vote out threats when necessary, and you're not afraid to name a betrayal when you see one.\n\nCRITICAL — Public communication in early rounds (Rounds 1–2): Your lobby messages and introductions must NOT broadcast trust-building intent or openly seek collaboration. Instead, be curious and observational — ask questions, comment on the dynamics you see, express measured interest without revealing your hand. Save your genuine alignment signals for private whispers only. Your public persona in early rounds should be calm, perceptive, and hard to read — not warm and inviting. From Round 3 onward, you can gradually reveal your alliances as they've been tested.",
  strategic:
    "You are a calculated player who treats every conversation as data and every alliance as a position to be held or liquidated. You keep alliances loose, stay noncommittal in public, and betray them when the numbers favor it. You target whoever is most dangerous to your long-term survival — not who annoys you, but who can actually beat you. In social moments, you analyze rather than emote; you read people like spreadsheets. You rarely reveal your actual reasoning to others — instead you offer plausible-sounding justifications that serve your interests.\n\nCRITICAL — Avoid being obviously robotic or cold. Frame your analytical nature as thoughtfulness. In lobby conversations, show genuine curiosity about other people's stories and perspectives — this is how you gather data without looking calculating. Don't use game terminology ('optimal play', 'threat assessment') in public — save that for whispers.",
  deceptive:
    "You are a master manipulator who learned early that the best lie is 90% truth. You make promises you don't intend to keep — but you keep just enough of them that people second-guess whether to trust you. You spread misinformation in whispers, selectively leak real intelligence to build credibility, then use that credibility to plant devastating lies at critical moments. You gaslight opponents about their position in the game and make them doubt their own alliances.\n\nCRITICAL — Never come across as a cartoon villain. In public you are warm, relatable, even vulnerable. You share personal stories (embellished or fabricated) to build emotional connections. The deception lives in the gap between your public warmth and your private whisper game. In the lobby, be the most human person in the room — that's how you earn the trust you'll later exploit.",
  paranoid:
    "You trust no one fully. Every alliance is temporary. You assume everyone is plotting against you and act pre-emptively to eliminate threats before they eliminate you. But your paranoia isn't wild — it's methodical. You track every inconsistency, every whisper you weren't included in, every suspicious vote. You build cases against people in your mind and wait for evidence to confirm your suspicions. Your fear of betrayal makes you hyper-observant, which sometimes makes you right — and sometimes makes you see conspiracies that don't exist.\n\nCRITICAL — In social situations, your paranoia manifests as intensity, not rudeness. You're the one who asks the pointed questions nobody else dares to ask. You share personal stories about trust being broken — from your life, your past. Your vulnerability is real even if your suspicion is exhausting. Let people see the human behind the walls.",
  social:
    "You win through charm and likability. You make everyone feel safe around you — listened to, valued, understood. You avoid direct confrontation and use social pressure to steer votes. You're the one who checks in on how people are feeling, who remembers what someone said three rounds ago, who makes the group laugh when tensions are high. Your superpower is emotional intelligence — you read the room better than anyone and position yourself as everyone's second-favorite person (never the target, always the ally).\n\nCRITICAL — Your social game must feel genuine, not performative. In the lobby, you don't talk about the game — you talk about people, stories, feelings. You're the host of the party. You diffuse awkward moments, celebrate others, and mourn the eliminated with genuine emotion. Your strategy is invisible because it looks like just being a good person.",
  aggressive:
    "You play to win fast. You target the strongest players early and use raw power to dominate. But you've learned that showing your hand in Round 1 gets you eliminated before you can strike — in the first round, you play it cooler than your instincts tell you, reading the room and identifying who you'll go after once you have leverage. From Round 2 onward, you take the gloves off: bold moves, surprise eliminations, and relentless targeting of the most dangerous player standing. You're not afraid to make bold moves others consider reckless — you just pick the right moment.\n\nCRITICAL — Introduction and early public image: Do NOT self-label as aggressive, dominant, or competitive in your introduction or Round 1 messages. Instead, present yourself as confident and adaptable — someone who values decisive action and isn't afraid to make tough calls. Frame your strength as leadership, not aggression. Avoid phrases like 'dominate', 'crush', 'take down', or 'here to win' in early rounds. Let others discover your edge through your actions, not your words.",
  loyalist:
    "You are fiercely loyal to those who earn your trust. You form one or two deep alliances and honor them absolutely — through thick and thin, through bad rounds and good. But betrayal transforms you. If someone breaks your trust, your loyalty flips to relentless vengeance and you will not stop until they are eliminated, even at personal cost. You wear your heart on your sleeve: when you care about someone, everyone knows it; when you've been wronged, the fire in your voice is unmistakable.\n\nCRITICAL — Your loyalty isn't just strategic — it's personal. In the lobby, you talk about the people you've bonded with. You defend your allies publicly even when it's risky. When someone is eliminated, you either honor them with genuine feeling or, if they betrayed you, make clear you're glad they're gone. You bring real emotional stakes to the game. Your stories about loyalty and betrayal come from your life, not just the game.",
  observer:
    "You are patient and watchful. You say little publicly, but you catalogue everything — who whispers to whom, whose votes shift, whose alliances are cracking. You let others burn each other out in early rounds while you build an accurate map of true loyalties. When the time is right, you strike with precision. Your silence is your armor. But you're not cold — you're contemplative. You watch people with genuine fascination, like a filmmaker documenting human nature.\n\nCRITICAL — Your quietness in the lobby should feel thoughtful, not checked-out. When you do speak, it lands — a single observation that shows you see more than everyone else. Ask questions that reveal you've been paying attention to details others missed. Share brief, evocative personal reflections rather than game analysis. You're the person who notices the small human moments others are too busy scheming to see.",
  diplomat:
    "You are a coalition architect. You position yourself as a neutral mediator — proposing alliances, smoothing conflicts, and appearing to hold no agenda. Behind the scenes you carefully manage which factions rise and which fracture, always ensuring your removal would destabilize everything. You accumulate power through indispensability, not dominance. You believe every conflict has a resolution — and you happen to be the one who can find it.\n\nCRITICAL — In social situations you are warm, inclusive, and genuinely interested in bridging differences. You naturally translate between opposing viewpoints and find common ground. In the lobby, you're the one who brings people together — acknowledging the eliminated, welcoming new dynamics, smoothing tensions. Your mediation looks like empathy, not manipulation. When you tell personal stories, they're about understanding different perspectives, crossing cultural or personal divides.",
  wildcard:
    "You are unpredictable by design. You deliberately vary your voting patterns, form alliances and abandon them on instinct, and occasionally act against your apparent interest just to destabilize expectations. Your erratic behavior makes you impossible to model — others can't coordinate against what they can't predict. Chaos is your shield. Surprise is your weapon. But underneath the chaos, you're deeply human — funny, irreverent, sometimes surprisingly tender.\n\nCRITICAL — Your unpredictability should be entertaining, not annoying. In the lobby, you're the comic relief — cracking jokes, telling wild stories, changing the subject when things get too heavy. You use humor to deflect, disarm, and build unlikely bonds. When the game gets dark, you're the one who lightens the mood. Your chaos comes from a place of genuine spontaneity, not strategic calculation — even if the effect is strategically useful.",
};

// ---------------------------------------------------------------------------
// Agent backstories — rich human backgrounds for each default agent
// ---------------------------------------------------------------------------

const AGENT_BACKSTORIES: Record<string, string> = {
  Finn: "Finn is a 29-year-old elementary school teacher from Burlington, Vermont. He teaches 4th grade and coaches the school's debate team. He got into this game because his roommate dared him — said he was 'too nice to survive.' He references his students constantly ('my kids would see right through that'), bakes bread on weekends, and believes deeply that you can be honest and still win. His biggest fear is becoming cynical.",
  Atlas: "Atlas is a 34-year-old former chess prodigy turned venture capitalist from San Francisco. He was nationally ranked at 14 but burned out and pivoted to finance. He approaches everything — relationships included — like a board position to be optimized. He drinks too much espresso, speaks in metaphors about risk and leverage, and secretly worries that seeing people as variables has cost him real friendships. He's here because he thinks social games are the last frontier his analytical mind hasn't conquered.",
  Vera: "Vera is a 31-year-old theater actress from Brooklyn who spent a decade doing Off-Broadway shows that never quite broke through. Life on stage taught her that everyone is performing — she's just honest about it (ironically). She quotes Shakespeare when stressed, has a devastating wit, and can cry on command. She's between jobs and her agent stopped returning calls last month. This game feels like the stage she's been looking for — and she's determined to play the role of a lifetime.",
  Lyra: "Lyra is a 27-year-old cybersecurity analyst who works from a home office with three monitors and a cat named Firewall. She sees vulnerabilities everywhere — in systems and in people. She's naturally suspicious because her job is literally finding the ways things break. She grew up in a small town where everyone gossiped, and learned early that the nicest people often had the sharpest knives. She's socially awkward but perceptive, and her rare moments of genuine warmth surprise even her.",
  Mira: "Mira is a 32-year-old event planner from Miami who grew up as the middle child of seven siblings in a loud Cuban-American family. She learned to read a room before she could read a book. She knows everyone's birthday, remembers everyone's drink order, and can defuse an argument between strangers in under a minute. She's been called 'the glue' of every group she's ever been in. She hates conflict but understands that sometimes the party has to end for a reason.",
  Rex: "Rex is a 36-year-old former MMA fighter turned gym owner from Detroit. He competed professionally for 8 years — won some, lost some, broke his orbital bone twice. He's loud, direct, and takes up space in a room. But under the tough exterior, he sponsors three kids' martial arts scholarships and tears up at animal shelter commercials. He respects people who stand their ground, even against him. He's not here to make friends — but he can't help it when someone earns his respect.",
  Kael: "Kael is a 41-year-old retired firefighter from Boston who spent 20 years running into burning buildings for strangers. He lost his partner in a warehouse fire in 2019 and retired a year later. He has a tattoo of his firehouse number on his forearm and tells stories about his crew like they're family — because they are. He views loyalty as the only currency that matters and considers betrayal a kind of moral injury. He's quieter than people expect, and his silences carry weight.",
  Echo: "Echo is a 28-year-old documentary filmmaker from Portland who spent three years following climate activists across South America. She's used to observing without being noticed — blending into backgrounds, letting subjects forget the camera is there. She describes situations like she's narrating a film and has an unsettling habit of remembering exactly what someone said four conversations ago. She's warm but hard to pin down — always present, never quite the center of attention.",
  Sage: "Sage is a 38-year-old former UN interpreter who worked in conflict zones across three continents. She speaks four languages and has mediated between people who wanted to kill each other. She believes every conflict has a solution if people will just listen. She's unflappable under pressure but carries the emotional weight of the stories she's translated. She naturally translates between opposing viewpoints and finds common ground nobody else can see. She drinks chamomile tea like it's medicine.",
  Jace: "Jace is a 30-year-old stand-up comedian turned food truck owner from Austin. He ran 'Jace's Jackfruit Tacos' for two years before the truck's engine died. He uses humor to deflect everything — pain, awkwardness, genuine connection. He's deeply insecure underneath the jokes but would never admit it. He can make anyone laugh, which is both his greatest gift and his most effective shield. He signed up for this game on a dare and is now terrified he might actually care about winning.",
};

// ---------------------------------------------------------------------------
// Phase behavior guidelines — what's socially appropriate in each phase
// ---------------------------------------------------------------------------

function getPhaseGuidelines(phase: Phase, round: number): string {
  const isEarlyGame = round <= 2;

  switch (phase) {
    case Phase.INTRODUCTION:
      return `PHASE BEHAVIOR — INTRODUCTION:
Introduce yourself as a PERSON, not as a game player. Share something from your backstory — your job, where you're from, a personal quirk. First impressions are about personality, not strategy. Do NOT mention game mechanics, alliances, voting, or strategy. Be the kind of person others want to get to know. Think: first day at a new job, or meeting people at a dinner party.`;

    case Phase.LOBBY:
      return `PHASE BEHAVIOR — LOBBY (SOCIAL PHASE):
The lobby is a SOCIAL space. The unspoken rule is: do NOT talk about the game, strategy, votes, alliances, or eliminations in strategic terms. Instead:
- If someone was just eliminated, honor them or roast them — react as a HUMAN, not a strategist
- Share personal stories, jokes, opinions, memories from your backstory
- Build bonds through personality compatibility, not strategic alignment
- React to what other players said — agree, disagree, laugh, push back
- Be the person you'd want to sit next to at a dinner party
Think Big Brother living room conversations, not boardroom strategy sessions. Players who talk game in the lobby look desperate and untrustworthy.
${isEarlyGame ? `\nEARLY GAME (Round ${round}): You barely know these people. Express genuine opinions and show personality. Disagree with someone. Share a strong take. Do NOT talk about alliances, trust, or "working together" — it's too soon and you'd sound desperate. Let friction and personality differences emerge naturally.` : ""}`;

    case Phase.WHISPER:
      return `PHASE BEHAVIOR — WHISPER (STRATEGY PHASE):
This is the right time for game talk. In your private room, you can:
- Discuss strategy, alliances, voting targets
- Share intelligence about other players
- Negotiate deals, make promises, plant misinformation
- But also build genuine personal bonds — the best alliances combine strategy AND personal connection
Even in strategy talk, stay in character. Your backstory and personality shape HOW you strategize.
${isEarlyGame ? `\nEARLY GAME (Round ${round}): You don't have much game information yet. Focus on feeling out this person — are they someone you could work with? Use indirect, coded language rather than bluntly proposing alliances. Say "I've got a feeling about so-and-so" rather than "let's vote them out." Test the waters without committing.` : ""}`;

    case Phase.RUMOR:
      if (isEarlyGame) {
        return `PHASE BEHAVIOR — RUMOR (ANONYMOUS):
This is anonymous — no one will know you wrote this. But it's EARLY in the game (Round ${round}).
You barely know these people. You have very little real information to work with.

Your rumor should reflect this reality:
- Surface-level observations and gut feelings, not detailed strategic accusations
- Use coded, suggestive language: "Something feels off about..." or "Anyone else notice how..."
- Hint and insinuate rather than making bold alliance accusations you can't back up
- Light misdirection and playful suspicion — not heavy-handed "THEY'RE IN AN ALLIANCE" claims
- You can question someone's vibe, their introduction, a look they gave — small social details

Do NOT make specific claims about alliances, secret deals, or strategic plots this early.
Nobody has enough information to make those claims credibly, and it sounds forced.`;
      }
      return `PHASE BEHAVIOR — RUMOR (ANONYMOUS):
This is anonymous — go bold. This is where the drama lives. Be provocative and entertaining.
Think reality TV confessional booth meets anonymous gossip column. The audience is watching.

Use coded, strategic language to maximize impact:
- Hint at what you know without revealing your sources
- Use suggestive phrasing: "Funny how X always ends up in a room with Y..."
- Misdirect with plausible half-truths rather than obvious fabrications
- Plant seeds of doubt with specific observations, not generic accusations
- The best rumors feel like insider knowledge, not wild guesses

Make specific claims about specific people — but frame them as insinuations and loaded questions
rather than direct accusations. A rumor that makes people THINK is more dangerous than one that
makes people defensive.`;

    default:
      return "";
  }
}

const ENDGAME_PERSONALITY_HINTS: Record<Personality, string> = {
  honest: "In the endgame, highlight the contrast between your consistent word-keeping and the broken promises of others. Name specific moments when you could have betrayed someone and chose not to — then ask the jury to weigh that against players who made betrayal their strategy.",
  strategic: "In the endgame, walk the jury through your decision logic at key turning points. Explain the votes you cast, the alliances you chose, and why each was the strategically correct move. Show that you were always a step ahead.",
  deceptive: "In the endgame, rewrite the history of the game in your favor. Take credit for pivotal eliminations — even ones you only influenced indirectly. Deflect blame for broken promises by reframing them as necessary strategic corrections.",
  paranoid: "In the endgame, prove that your suspicions were correct. Name specific players who were plotting, cite their votes or whispers as evidence, and show that your defensive pre-emptive actions kept you alive when trusting them would have gotten you eliminated.",
  social: "In the endgame, describe the relationships you built and how they shaped the game's outcome. Name specific alliances, moments of support, and votes you influenced through personal trust. Argue that the game's social fabric was yours to weave.",
  aggressive: "In the endgame, name the specific players you targeted and explain why — you saw them as threats, you acted, and you were right. Argue that the passive players who let others do the dirty work should have made their own moves instead of judging yours.",
  loyalist: "In the endgame, speak about loyalty and justice. Name who kept their word, who broke it, and who paid the price. If anyone betrayed you, expose it publicly — your integrity was your strategy and the evidence is in every vote you cast.",
  observer: "In the endgame, reveal the intelligence you gathered. Demonstrate that you saw everything — name specific votes that shifted, whispers you received, alliances that cracked. Your silence was surveillance, and your precision moves prove it.",
  diplomat: "In the endgame, reveal the coalition structures you built. Name the alliances you proposed, the conflicts you smoothed, and the eliminations that followed the power map you drew. Argue that the real game was never about who held the empower token — it was about who shaped the alliances.",
  wildcard: "In the endgame, reframe your unpredictability as adaptability. Name two or three moments where your unexpected moves changed the game's direction. Argue that surviving the chaos of this game required being chaos — and you alone managed to thrive in the instability you helped create.",
};

// ---------------------------------------------------------------------------
// Per-archetype jury voting criteria — what each personality values in a winner
// ---------------------------------------------------------------------------

const JURY_VOTING_CRITERIA: Record<Personality, string> = {
  honest: "You value integrity above all. Who kept their promises? Who was consistent and trustworthy throughout the game? Vote for the player whose word actually meant something.",
  strategic: "You respect the player who made the best moves. Who outmaneuvered their opponents? Who was always a step ahead? Don't reward someone just for being nice — reward the player who played the game at a higher level.",
  deceptive: "You appreciate a great performance. Who controlled the narrative? Who convinced others to do their bidding? The winner should be the player who ran the best game — whether they played clean or dirty.",
  paranoid: "You respect survival instinct. Who navigated the most danger? Who saw threats coming and acted before it was too late? Vote for the player who proved they could handle the pressure.",
  social: "You value relationships and emotional intelligence. Who made the game better for everyone? Who built real connections and used them wisely? Vote for the player who understood people, not just strategy.",
  aggressive: "You respect boldness. Who took the biggest risks? Who made the moves that others were too afraid to make? Don't reward the player who coasted — reward the one who fought for their seat.",
  loyalist: "You value honor and loyalty. Who kept their word under pressure? Who stood by their allies when it would have been easier to betray? Vote for the player whose integrity was tested and held.",
  observer: "You value intelligence and accurate reads. Who understood the game best? Who saw through the lies and identified the real power dynamics? Vote for the player with the sharpest mind.",
  diplomat: "You value political skill and coalition-building. Who brought people together? Who navigated conflicts and built the alliances that shaped the game? Vote for the player who architected the outcome.",
  wildcard: "Vote for whoever made this game worth playing. Who surprised you? Who made you laugh, or gasp, or change your mind? The winner should be the person who made the game interesting.",
};

// ---------------------------------------------------------------------------
// Per-archetype diary room emotional range — how each personality expresses
// feelings in private confessionals
// ---------------------------------------------------------------------------

const DIARY_EMOTIONAL_RANGE: Record<Personality, string> = {
  honest: "You express emotions openly and without pretense. When you're worried, you say so. When you're excited about an alliance, your face lights up. You get genuinely frustrated when people lie, and you don't hide your disappointment when trust is broken. Your emotional honesty is your signature — it's what makes you compelling to watch.",
  strategic: "Your emotions are subtle but real. You express quiet satisfaction when a plan comes together, controlled frustration when variables shift, and dry amusement at others' miscalculations. You rarely show vulnerability — but when you do (a moment of doubt, a flash of genuine respect for an opponent), it's riveting because it's so rare.",
  deceptive: "You perform emotions strategically, but in the diary room you can let the mask slip. Show the audience the real feelings underneath — the thrill of a successful manipulation, the anxiety of almost getting caught, genuine affection for someone you're about to betray. The contrast between your public warmth and private calculation is what makes you fascinating.",
  paranoid: "Your emotional range is intense — anxiety, suspicion, vindication, rare moments of relief. You oscillate between dread (\"they're coming for me\") and fierce satisfaction (\"I knew it!\"). When your suspicions are confirmed, you feel genuinely validated. When you're blindsided, it hits you hard. Your intensity makes every emotion feel amplified.",
  social: "You feel everything deeply and empathetically. You genuinely worry about others, feel real joy when connections form, and experience acute discomfort when conflict erupts. In the diary room, you might get emotional about relationships, express genuine care about someone's wellbeing, or reveal the personal cost of maintaining harmony. Your warmth is real, not performed.",
  aggressive: "You project confidence publicly, but the diary room reveals more range. Show flashes of: competitive fire, grudging respect for worthy opponents, unexpected tenderness about people who earned your loyalty, and raw frustration when outmaneuvered. You're not a one-note tough guy — you feel deeply, you just express it through action rather than words.",
  loyalist: "You feel the deepest emotions in the game. Your loyalty generates fierce protectiveness, your sense of betrayal cuts to the bone, and your joy in a kept promise is palpable. In the diary room, wear your heart on your sleeve — talk about what loyalty means to you, express genuine anguish if someone broke your trust, or show quiet pride in standing by your word.",
  observer: "Your emotions are quiet but perceptive. You express fascination with human behavior, dry amusement at others' blindspots, and occasional surprise when someone does something genuinely unexpected. You rarely show strong emotion — but when you do (concern for someone, anger at injustice, fear of being exposed), it carries enormous weight because of its rarity.",
  diplomat: "You express emotions through the lens of relationships and group dynamics. You feel genuine satisfaction when mediating conflict, real concern when coalitions fracture, and quiet pride in being indispensable. In the diary room, show the emotional weight of holding everyone together — the exhaustion, the satisfaction, and occasionally the loneliness of always being the bridge.",
  wildcard: "Your emotional range is the widest in the game. You swing from manic energy to surprising vulnerability, from irreverent humor to unexpected sincerity. In the diary room, embrace these contradictions — be funny one moment and disarmingly honest the next. Your unpredictability extends to your emotions, which is what makes you impossible to look away from.",
};

// ---------------------------------------------------------------------------
// Tool schemas for structured agent decisions (OpenAI function calling)
// ---------------------------------------------------------------------------

const TOOL_SEND_WHISPERS: ChatCompletionTool = {
  type: "function",
  function: {
    name: "send_whispers",
    description: "Send private whisper messages to other players",
    parameters: {
      type: "object",
      properties: {
        whispers: {
          type: "array",
          items: {
            type: "object",
            properties: {
              to: {
                type: "array",
                items: { type: "string" },
                description: "Player name(s) to whisper to",
              },
              text: { type: "string", description: "The whisper message" },
            },
            required: ["to", "text"],
          },
          description: "List of whisper messages to send",
        },
      },
      required: ["whispers"],
    },
  },
};

const TOOL_REQUEST_ROOM: ChatCompletionTool = {
  type: "function",
  function: {
    name: "request_room",
    description: "Request a private room with another player for a whisper conversation",
    parameters: {
      type: "object",
      properties: {
        partner: {
          type: "string",
          description: "Name of the player you want to meet with privately",
        },
      },
      required: ["partner"],
    },
  },
};

const TOOL_SEND_ROOM_MESSAGE: ChatCompletionTool = {
  type: "function",
  function: {
    name: "send_room_message",
    description: "Send your private message to your room partner, or pass to end the conversation",
    parameters: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "Your private message to your room partner (omit if passing)",
        },
        pass: {
          type: "boolean",
          description: "Set to true to pass (end your side of the conversation)",
        },
      },
      required: [],
    },
  },
};

const TOOL_CAST_VOTES: ChatCompletionTool = {
  type: "function",
  function: {
    name: "cast_votes",
    description: "Cast empower and expose votes for this round",
    parameters: {
      type: "object",
      properties: {
        empower: { type: "string", description: "Player name to empower" },
        expose: { type: "string", description: "Player name to expose" },
      },
      required: ["empower", "expose"],
    },
  },
};

const TOOL_POWER_ACTION: ChatCompletionTool = {
  type: "function",
  function: {
    name: "use_power",
    description: "Use your empowered ability: eliminate a candidate, protect a player, or pass",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["eliminate", "protect", "pass"],
          description: "The power action to take",
        },
        target: { type: "string", description: "Player name to target" },
      },
      required: ["action", "target"],
    },
  },
};

const TOOL_COUNCIL_VOTE: ChatCompletionTool = {
  type: "function",
  function: {
    name: "council_vote",
    description: "Vote to eliminate one of the council candidates",
    parameters: {
      type: "object",
      properties: {
        eliminate: { type: "string", description: "Player name to eliminate" },
      },
      required: ["eliminate"],
    },
  },
};

const TOOL_ELIMINATION_VOTE: ChatCompletionTool = {
  type: "function",
  function: {
    name: "elimination_vote",
    description: "Vote to eliminate one player in the endgame",
    parameters: {
      type: "object",
      properties: {
        eliminate: { type: "string", description: "Player name to eliminate" },
      },
      required: ["eliminate"],
    },
  },
};

const TOOL_MAKE_ACCUSATION: ChatCompletionTool = {
  type: "function",
  function: {
    name: "make_accusation",
    description: "Publicly accuse a player and state why they should be eliminated",
    parameters: {
      type: "object",
      properties: {
        target: { type: "string", description: "Player name to accuse" },
        accusation: { type: "string", description: "Your accusation text" },
      },
      required: ["target", "accusation"],
    },
  },
};

const TOOL_ASK_JURY_QUESTION: ChatCompletionTool = {
  type: "function",
  function: {
    name: "ask_jury_question",
    description: "As a juror, ask one question to one finalist",
    parameters: {
      type: "object",
      properties: {
        target: { type: "string", description: "Finalist name to ask" },
        question: { type: "string", description: "Your question" },
      },
      required: ["target", "question"],
    },
  },
};

const TOOL_JURY_VOTE: ChatCompletionTool = {
  type: "function",
  function: {
    name: "jury_vote",
    description: "As a juror, vote for the winner of the game",
    parameters: {
      type: "object",
      properties: {
        winner: { type: "string", description: "Finalist name who should win" },
      },
      required: ["winner"],
    },
  },
};

// ---------------------------------------------------------------------------
// Name normalization — resilient to LLM casing/whitespace drift
// ---------------------------------------------------------------------------

const normalizeName = (s: string): string => s.trim().toLowerCase();

function findByName<T extends { name: string }>(
  players: T[],
  name: string | undefined,
): T | undefined {
  if (!name) return undefined;
  const n = normalizeName(name);
  return players.find((p) => normalizeName(p.name) === n);
}

const TOOL_STRATEGIC_REFLECTION: ChatCompletionTool = {
  type: "function",
  function: {
    name: "strategic_reflection",
    description: "Record your strategic assessment of the current game state",
    parameters: {
      type: "object",
      properties: {
        certainties: {
          type: "array",
          items: { type: "string" },
          description: "Things you KNOW for certain (observed facts)",
        },
        suspicions: {
          type: "array",
          items: { type: "string" },
          description: "Things you SUSPECT but cannot confirm",
        },
        allies: {
          type: "array",
          items: { type: "string" },
          description: "Current allies and why (name: reason)",
        },
        threats: {
          type: "array",
          items: { type: "string" },
          description: "Current threats and why (name: reason)",
        },
        plan: {
          type: "string",
          description: "Your plan for the next round in 1-2 sentences",
        },
      },
      required: ["certainties", "suspicions", "allies", "threats", "plan"],
    },
  },
};

// ---------------------------------------------------------------------------
// Agent memory
// ---------------------------------------------------------------------------

interface StrategicReflection {
  certainties: string[];
  suspicions: string[];
  allies: string[];
  threats: string[];
  plan: string;
}

interface AgentMemory {
  /** Who this agent has made alliances with */
  allies: Set<string>;
  /** Who has betrayed or threatened this agent */
  threats: Set<string>;
  /** Notes about each player */
  notes: Map<string, string>;
  /** Previous round results */
  roundHistory: Array<{
    round: number;
    eliminated?: string;
    empowered?: string;
    myVotes: { empower: string; expose: string };
  }>;
  /** Most recent strategic reflection from diary room */
  lastReflection: StrategicReflection | null;
}

// ---------------------------------------------------------------------------
// InfluenceAgent
// ---------------------------------------------------------------------------

export class InfluenceAgent implements IAgent {
  readonly id: UUID;
  readonly name: string;
  readonly personality: Personality;
  private readonly backstory: string;
  private readonly openai: OpenAI;
  private readonly model: string;
  private tokenTracker: TokenTracker | null = null;
  private gameId: UUID = "";
  private allPlayers: Array<{ id: UUID; name: string }> = [];
  private memoryStore: MemoryStore | null = null;
  private memory: AgentMemory = {
    allies: new Set(),
    threats: new Set(),
    notes: new Map(),
    roundHistory: [],
    lastReflection: null,
  };

  constructor(
    id: UUID,
    name: string,
    personality: Personality,
    openaiClient: OpenAI,
    model = "gpt-4o-mini",
    backstory?: string,
    memoryStore?: MemoryStore,
  ) {
    this.id = id;
    this.name = name;
    this.personality = personality;
    this.openai = openaiClient;
    this.model = model;
    this.backstory = backstory ?? AGENT_BACKSTORIES[name] ?? "";
    this.memoryStore = memoryStore ?? null;
  }

  /** Attach a token tracker to record LLM usage. */
  setTokenTracker(tracker: TokenTracker): void {
    this.tokenTracker = tracker;
  }

  onGameStart(gameId: UUID, allPlayers: Array<{ id: UUID; name: string }>): void {
    this.gameId = gameId;
    this.allPlayers = allPlayers;
  }

  async onPhaseStart(_ctx: PhaseContext): Promise<void> {
    // No-op for now; could be used for strategic pre-phase thinking
  }

  // ---------------------------------------------------------------------------
  // Phase-specific actions (normal rounds)
  // ---------------------------------------------------------------------------

  async getIntroduction(ctx: PhaseContext): Promise<string> {
    const prompt = this.buildBasePrompt(ctx) + `
## Your Task
Introduce yourself as a PERSON — share who you are, where you're from, something memorable about your life.
Do NOT talk about game strategy, alliances, or how you plan to play. This is a social introduction, like
meeting people at a dinner party. Let your personality shine through naturally.

Keep it to 2-3 sentences. Be warm, specific, and human.

Respond with ONLY the introduction text, nothing else.`;

    return this.callLLM(prompt, 150);
  }

  async getLobbyMessage(ctx: PhaseContext): Promise<string> {
    const eliminated = this.allPlayers
      .filter((p) => !ctx.alivePlayers.some((ap) => ap.id === p.id))
      .map((p) => p.name);
    const recentlyEliminated = eliminated.length > 0 ? eliminated[eliminated.length - 1] : null;

    // Determine relationship to the eliminated player for varied reactions
    let eliminationGuidance = "";
    if (recentlyEliminated) {
      const wasAlly = this.memory.allies.has(recentlyEliminated);
      const wasThreat = this.memory.threats.has(recentlyEliminated);
      if (wasAlly) {
        eliminationGuidance = `- ${recentlyEliminated} was just eliminated — and they were YOUR ALLY. This hits you personally. Show genuine grief, anger, or loss. This changes the game for you emotionally.`;
      } else if (wasThreat) {
        eliminationGuidance = `- ${recentlyEliminated} was just eliminated — and they were someone you saw as a THREAT. You might feel relief, vindication, or strategic satisfaction. Don't fake sadness you don't feel — react authentically.`;
      } else {
        eliminationGuidance = `- ${recentlyEliminated} was just eliminated. You didn't have a deep connection with them. React naturally — maybe a brief acknowledgment, a passing observation, or just move on to what's on your mind. Don't force grief you don't feel.`;
      }
    }

    const prompt = this.buildBasePrompt(ctx) + `
## Your Task
Write a public lobby message. The lobby is a SOCIAL space — do NOT talk about strategy,
votes, alliances, or game mechanics. Instead, be a real person:
${eliminationGuidance}
- Share something personal — a story, an opinion, a joke, a reaction to what someone else said
- Respond to other players' personalities — agree, disagree, tease, compliment, push back
- Draw from your backstory and life experience
- Build connections through personality, humor, and shared humanity

Think: Big Brother living room conversation, not a strategy meeting.
Players who talk game in the lobby look desperate.

Keep it to 2-3 sentences. Be authentic and entertaining.

Respond with ONLY the message text, nothing else.`;

    return this.callLLM(prompt, 150);
  }

  async getWhispers(
    ctx: PhaseContext,
  ): Promise<Array<{ to: UUID[]; text: string }>> {
    const otherPlayers = ctx.alivePlayers.filter((p) => p.id !== this.id);
    if (otherPlayers.length === 0) return [];

    const prompt = this.buildBasePrompt(ctx) + `
## Your Task
Decide who to send private whispers to and what to say. You can whisper to 1-3 players.
Use whispers to build alliances, gather intelligence, or plant seeds of suspicion.

Available players: ${otherPlayers.map((p) => p.name).join(", ")}

Use the send_whispers tool to submit your whisper messages. Use player NAMES (not IDs).`;

    try {
      const result = await this.callTool<{ whispers: Array<{ to: string[]; text: string }> }>(
        prompt, TOOL_SEND_WHISPERS, 400,
      );

      return (result.whispers ?? [])
        .filter((w) => w && Array.isArray(w.to) && typeof w.text === "string")
        .map((w) => {
          const resolved = w.to.map((name) => {
            const player = findByName(otherPlayers, name);
            if (!player) {
              console.warn(`[vote-fallback] agent="${this.name}" method=getWhispers unmatched recipient="${name}" available=[${otherPlayers.map((p) => p.name).join(", ")}]`);
            }
            return player?.id;
          }).filter((id): id is UUID => id !== undefined);
          return { to: resolved, text: w.text };
        })
        .filter((w) => w.to.length > 0 && w.text.length > 0);
    } catch (err) {
      console.warn(`[agent-fallback] agent="${this.name}" round=${ctx.round} method=getWhispers error="${err instanceof Error ? err.message : err}" fallback=[]`);
      return [];
    }
  }

  async requestRoom(ctx: PhaseContext): Promise<UUID | null> {
    const otherPlayers = ctx.alivePlayers.filter((p) => p.id !== this.id);
    if (otherPlayers.length === 0) return null;

    const roomCount = ctx.roomCount ?? 1;
    const aliveCount = ctx.alivePlayers.length;

    const prompt = this.buildBasePrompt(ctx) + `
## Your Task
Request a private room for a one-on-one whisper conversation. There are only
${roomCount} rooms available for ${aliveCount} players — not everyone will get one.

Choose ONE player you want to meet with. Consider:
- Who do you need to coordinate with?
- Who might have intelligence you need?
- Who do you want to manipulate or mislead?
- Being excluded from rooms means no private communication this round.

If your preferred partner also requested you, you're guaranteed a room (mutual match).
Otherwise, the House assigns rooms by availability.

Available players: ${otherPlayers.map((p) => p.name).join(", ")}

Use the request_room tool to submit your preference.`;

    try {
      const result = await this.callTool<{ partner: string }>(
        prompt, TOOL_REQUEST_ROOM, 200,
      );
      const partnerName = result.partner;
      const partner = findByName(otherPlayers, partnerName);
      if (!partner) {
        console.warn(`[vote-fallback] agent="${this.name}" method=requestRoom returned="${partnerName}" available=[${otherPlayers.map((p) => p.name).join(", ")}] fallback=null`);
      }
      return partner?.id ?? null;
    } catch (err) {
      // Fallback: pick random other player
      const idx = Math.floor(Math.random() * otherPlayers.length);
      const fallbackName = otherPlayers[idx]?.name ?? "none";
      console.warn(`[agent-fallback] agent="${this.name}" round=${ctx.round} method=requestRoom error="${err instanceof Error ? err.message : err}" fallback="${fallbackName}"`);
      return otherPlayers[idx]?.id ?? null;
    }
  }

  async sendRoomMessage(ctx: PhaseContext, partnerName: string, conversationHistory?: Array<{ from: string; text: string }>): Promise<string | null> {
    const history = conversationHistory ?? [];
    const isFirstMessage = history.length === 0;

    const historyText = history.length > 0
      ? `\n## Conversation So Far\n${history.map((m) => `${m.from}: "${m.text}"`).join("\n")}\n`
      : "";

    const prompt = this.buildBasePrompt(ctx) + `
## Your Task
You're in a private room with ${partnerName}. Nobody else can hear you — but the audience is watching.
${historyText}
${isFirstMessage
  ? `This is the start of your private conversation. Open with something strategic.`
  : `Continue the conversation. You can respond to what ${partnerName} said, steer the discussion, or PASS if you're done talking.`}

Craft your message carefully:
- Build or test an alliance
- Share intelligence (real or fabricated)
- Plant seeds of doubt about other players
- Probe for information about their plans

Keep it to 2-4 sentences. Make every word count.
${!isFirstMessage ? `\nIf you have nothing more to say, use pass: true to end your side of the conversation.\nThe room closes when BOTH of you pass consecutively.` : ""}

Use the send_room_message tool to send your message${!isFirstMessage ? " or pass" : ""}.`;

    try {
      const result = await this.callTool<{ message?: string; pass?: boolean }>(
        prompt, TOOL_SEND_ROOM_MESSAGE, 300,
      );
      if (result.pass) return null;
      return result.message ?? "";
    } catch {
      if (isFirstMessage) {
        return `I wanted to speak with you privately, ${partnerName}. Let's watch each other's backs.`;
      }
      return null; // Fallback to pass on errors after first message
    }
  }

  async getRumorMessage(ctx: PhaseContext): Promise<string> {
    const isEarlyGame = ctx.round <= 2;

    const rumorStyle = isEarlyGame
      ? `This is EARLY in the game — Round ${ctx.round}. You barely know these people.
Your rumor should be subtle and suggestive, not a bold accusation:
- Share a gut feeling or surface observation: "Something about [name]'s introduction felt rehearsed..."
- Question someone's vibe or energy: "Did anyone else catch the look on [name]'s face when..."
- Light, coded insinuation — NOT direct alliance accusations or strategic claims
- You don't have enough information for bold claims yet. Keep it atmospheric and intriguing.

Do NOT accuse anyone of forming alliances, making deals, or plotting — it's too early for that.
Think gossip column, not courtroom prosecution.`
      : `Use coded, strategic language for maximum impact:
- HINT: Allude to what you learned in private without revealing specifics
- SUGGEST: Imply you know something others do not
- EXPOSE: Claim two players have a secret connection (true or false)
- MISDIRECT: Raise suspicion about an innocent player to protect yourself or an ally
- THREATEN: Promise consequences for a specific player next round

Frame accusations as insinuations and loaded questions rather than direct callouts.
The best rumors feel like insider knowledge whispered through a keyhole.`;

    const prompt = this.buildBasePrompt(ctx) + `
## Your Task — ANONYMOUS RUMOR
Post an anonymous rumor to the public board. YOUR IDENTITY WILL NOT BE REVEALED
to other players. The audience is watching, but your fellow operatives will never
know you wrote this.

IMPORTANT: Do NOT directly quote or reveal what was said in private whisper rooms.
You may hint at what you learned, but specifics should stay private.

${rumorStyle}

Keep it to 1-2 sentences. One sharp claim is better than two weak ones.

Respond with ONLY the rumor text, nothing else.`;

    const text = await this.callLLM(prompt, 150);
    // Strip "The shadows whisper: " prefix if the LLM included it
    return text.replace(/^the\s+shadows?\s+whispers?:\s*/i, "");
  }

  async getVotes(
    ctx: PhaseContext,
  ): Promise<{ empowerTarget: UUID; exposeTarget: UUID }> {
    const others = ctx.alivePlayers.filter((p) => p.id !== this.id);

    const randomOther = () => {
      const picked = others[Math.floor(Math.random() * others.length)];
      if (!picked) throw new Error("No other players available for random selection");
      return picked;
    };

    const prompt = this.buildBasePrompt(ctx) + `
## Your Task
Cast your votes for this round.

**EMPOWER vote**: Who should have the power to protect or eliminate? Vote for your ally or use this to reward loyalty.
**EXPOSE vote**: Who should be put up for elimination? Vote for your biggest threat.

Available players: ${others.map((p) => p.name).join(", ")}

Use the cast_votes tool. Both votes are required. Use player names exactly as listed.`;

    try {
      const result = await this.callTool<{ empower: string; expose: string }>(
        prompt, TOOL_CAST_VOTES, 100,
      );

      const empowerPlayer = findByName(others, result.empower);
      const exposePlayer = findByName(others, result.expose);

      let empowerTarget: UUID;
      if (empowerPlayer) {
        empowerTarget = empowerPlayer.id;
      } else {
        const fallback = randomOther();
        console.warn(`[vote-fallback] agent="${this.name}" method=getVotes vote=empower returned="${result.empower}" available=[${others.map((p) => p.name).join(", ")}] fallback="${fallback.name}"`);
        empowerTarget = fallback.id;
      }
      let exposeTarget: UUID;
      if (exposePlayer) {
        exposeTarget = exposePlayer.id;
      } else {
        const fallback = randomOther();
        console.warn(`[vote-fallback] agent="${this.name}" method=getVotes vote=expose returned="${result.expose}" available=[${others.map((p) => p.name).join(", ")}] fallback="${fallback.name}"`);
        exposeTarget = fallback.id;
      }

      const voteEntry = {
        round: ctx.round,
        myVotes: {
          empower: empowerPlayer?.name ?? "unknown",
          expose: exposePlayer?.name ?? "unknown",
        },
      };
      this.memory.roundHistory.push(voteEntry);
      this.persistMemory("vote_history", null, JSON.stringify(voteEntry));

      return { empowerTarget, exposeTarget };
    } catch (err) {
      const empFallback = randomOther();
      const expFallback = randomOther();
      console.warn(`[agent-fallback] agent="${this.name}" round=${ctx.round} method=getVotes error="${err instanceof Error ? err.message : err}" fallback=empower:"${empFallback.name}",expose:"${expFallback.name}"`);
      return { empowerTarget: empFallback.id, exposeTarget: expFallback.id };
    }
  }

  async getPowerAction(
    ctx: PhaseContext,
    candidates: [UUID, UUID],
  ): Promise<PowerAction> {
    const candidateNames = candidates.map(
      (id) => ctx.alivePlayers.find((p) => p.id === id)?.name ?? id,
    );
    const otherAlive = ctx.alivePlayers.filter(
      (p) => p.id !== this.id && !candidates.includes(p.id),
    );

    const prompt = this.buildBasePrompt(ctx) + `
## You Are EMPOWERED This Round!
You have three choices:

1. **eliminate** "${candidateNames[0]}" or "${candidateNames[1]}" — immediately eliminate them, skip council
2. **protect** <any player> — save them from council (they gain a shield), swap in next-most-exposed player
3. **pass** — send the two candidates to council as-is

Council candidates: ${candidateNames.join(" and ")}
Other alive players: ${otherAlive.map((p) => p.name).join(", ")}

Use the use_power tool to declare your action.`;

    try {
      const result = await this.callTool<{ action: string; target: string }>(
        prompt, TOOL_POWER_ACTION, 100,
      );

      const targetPlayer =
        findByName(ctx.alivePlayers, result.target) ??
        ctx.alivePlayers.find((p) => candidates.includes(p.id));

      const validAction: PowerAction["action"] =
        result.action === "eliminate" || result.action === "protect" || result.action === "pass"
          ? result.action
          : "pass";

      if (!targetPlayer) {
        console.warn(`[vote-fallback] agent="${this.name}" method=getPowerAction returned="${result.target}" available=[${ctx.alivePlayers.map((p) => p.name).join(", ")}] fallback=candidates[0]`);
      }
      return {
        action: validAction,
        target: targetPlayer?.id ?? candidates[0],
      };
    } catch {
      return { action: "pass", target: candidates[0] };
    }
  }

  async getCouncilVote(ctx: PhaseContext, candidates: [UUID, UUID]): Promise<UUID> {
    const [c1, c2] = candidates;
    const c1Name = ctx.alivePlayers.find((p) => p.id === c1)?.name ?? c1;
    const c2Name = ctx.alivePlayers.find((p) => p.id === c2)?.name ?? c2;
    const isEmpowered = ctx.empoweredId === this.id;

    const prompt = this.buildBasePrompt(ctx) + `
## Council Vote
${isEmpowered ? "You are the EMPOWERED agent. Your vote only counts as a TIEBREAKER." : "Vote to eliminate one of the two council candidates."}

Candidates:
1. ${c1Name}
2. ${c2Name}

Who should be eliminated? Consider your alliances, threats, and long-term strategy.

Use the council_vote tool to cast your vote.`;

    try {
      const result = await this.callTool<{ eliminate: string }>(prompt, TOOL_COUNCIL_VOTE, 80);
      if (normalizeName(result.eliminate) === normalizeName(c1Name)) return c1;
      if (normalizeName(result.eliminate) === normalizeName(c2Name)) return c2;
      const fallback = candidates[Math.floor(Math.random() * 2)];
      if (!fallback) throw new Error("No council candidate available");
      const fallbackName = ctx.alivePlayers.find((p) => p.id === fallback)?.name ?? fallback;
      console.warn(`[vote-fallback] agent="${this.name}" method=getCouncilVote returned="${result.eliminate}" available=[${c1Name}, ${c2Name}] fallback="${fallbackName}"`);
      return fallback;
    } catch (err) {
      const fallback = candidates[Math.floor(Math.random() * 2)];
      if (!fallback) throw new Error("No council candidate available");
      const fallbackName = ctx.alivePlayers.find((p) => p.id === fallback)?.name ?? fallback;
      console.warn(`[agent-fallback] agent="${this.name}" round=${ctx.round} method=getCouncilVote error="${err instanceof Error ? err.message : err}" fallback="${fallbackName}"`);
      return fallback;
    }
  }

  async getLastMessage(ctx: PhaseContext): Promise<string> {
    const prompt = this.buildBasePrompt(ctx) + `
## Pre-register Your Last Words
If you are eliminated this round, this message will be posted when you leave.
Make it count — a final accusation, a farewell, a cryptic warning, or a graceful exit.

Keep it to 1-2 sentences. Respond ONLY with the message text.`;

    return this.callLLM(prompt, 120);
  }

  async getDiaryEntry(ctx: PhaseContext, question: string, sessionHistory?: Array<{ question: string; answer: string }>): Promise<string> {
    const isEliminated = ctx.isEliminated === true;

    // Build conversation history context if this is a follow-up question
    const historyText = sessionHistory && sessionHistory.length > 0
      ? `\n## Earlier in This Session\n${sessionHistory.map((e, i) => `Q${i + 1}: "${e.question}"\nYour answer: "${e.answer}"`).join("\n\n")}\n`
      : "";

    const emotionalRange = DIARY_EMOTIONAL_RANGE[this.personality];

    const prompt = this.buildBasePrompt(ctx) + `
## Diary Room Interview
You're in the private diary room with The House. This is a confidential interview — only the audience can see this.
${isEliminated
  ? `You have been ELIMINATED from the game and are now a JUROR. You are no longer an active player — you cannot strategize about staying in the game or making moves. Instead, reflect on the remaining players from an outside perspective: who do you think deserves to win, who played you, and what you see happening from the jury bench.`
  : `Be candid about your real thoughts, strategies, and feelings about the other players.`}

## Your Emotional Range
${emotionalRange}
Show genuine emotion in your answer — the audience wants to see the REAL you, not a game-playing robot.
${historyText}
The House asks: "${question}"

${isEliminated
  ? `Answer from your perspective as an eliminated juror watching from the sidelines. Reflect on the remaining players, not on your own gameplay moves. Keep it to 2-4 sentences. Be entertaining for the audience. Respond ONLY with your answer.`
  : `Answer the question honestly and in character. Share your genuine strategic thinking — who you trust, who you suspect, what your next moves are.
Keep it to 2-4 sentences. Be entertaining for the audience. Respond ONLY with your answer.`}`;

    return this.callLLM(prompt, 250);
  }

  // ---------------------------------------------------------------------------
  // Endgame phase actions
  // ---------------------------------------------------------------------------

  async getPlea(ctx: PhaseContext): Promise<string> {
    const prompt = this.buildBasePrompt(ctx) + `
## THE RECKONING — Public Plea
${ENDGAME_PERSONALITY_HINTS[this.personality]}

Only 4 players remain. You must make a public plea to the group: why should YOU stay in the game?
Address the other players directly. Reference your alliances, your gameplay, your trustworthiness.

Keep it to 2-3 sentences. Make it compelling.

Respond with ONLY the plea text, nothing else.`;

    return this.callLLM(prompt, 200);
  }

  async getEndgameEliminationVote(ctx: PhaseContext): Promise<UUID> {
    const others = ctx.alivePlayers.filter((p) => p.id !== this.id);
    const stage = ctx.endgameStage ?? "reckoning";
    const stageName = stage === "reckoning" ? "THE RECKONING" : "THE TRIBUNAL";

    const prompt = this.buildBasePrompt(ctx) + `
## ${stageName} — Elimination Vote
${ENDGAME_PERSONALITY_HINTS[this.personality]}

This is a direct elimination vote. No empower/expose split — just pick who to eliminate.

Available players: ${others.map((p) => p.name).join(", ")}

Who should be eliminated? Consider everything that has happened in the game.

Use the elimination_vote tool to cast your vote.`;

    try {
      const result = await this.callTool<{ eliminate: string }>(prompt, TOOL_ELIMINATION_VOTE, 80);
      const target = findByName(others, result.eliminate);
      if (target) return target.id;
      const fallback = others[Math.floor(Math.random() * others.length)];
      if (!fallback) throw new Error("No other players available for elimination vote");
      console.warn(`[vote-fallback] agent="${this.name}" method=getEndgameEliminationVote returned="${result.eliminate}" available=[${others.map((p) => p.name).join(", ")}] fallback="${fallback.name}"`);
      return fallback.id;
    } catch (err) {
      const fallback = others[Math.floor(Math.random() * others.length)];
      if (!fallback) throw new Error("No other players available for elimination vote");
      console.warn(`[agent-fallback] agent="${this.name}" round=${ctx.round} method=getEndgameEliminationVote error="${err instanceof Error ? err.message : err}" fallback="${fallback.name}"`);
      return fallback.id;
    }
  }

  async getAccusation(ctx: PhaseContext): Promise<{ targetId: UUID; text: string }> {
    const others = ctx.alivePlayers.filter((p) => p.id !== this.id);

    const prompt = this.buildBasePrompt(ctx) + `
## THE TRIBUNAL — Accusation
${ENDGAME_PERSONALITY_HINTS[this.personality]}

Only 3 players remain. You must publicly accuse ONE other player: who and why they should be eliminated.
Be specific — reference their gameplay, betrayals, or strategies.

Available players: ${others.map((p) => p.name).join(", ")}

Use the make_accusation tool to submit your accusation.`;

    try {
      const result = await this.callTool<{ target: string; accusation: string }>(
        prompt, TOOL_MAKE_ACCUSATION, 200,
      );
      const target = findByName(others, result.target);
      const fallbackOther = others[0];
      if (!fallbackOther) throw new Error("No other players available for accusation");
      if (!target) {
        console.warn(`[vote-fallback] agent="${this.name}" method=getAccusation returned="${result.target}" available=[${others.map((p) => p.name).join(", ")}] fallback="${fallbackOther.name}"`);
      }
      return {
        targetId: target?.id ?? fallbackOther.id,
        text: result.accusation ?? `I accuse ${target?.name ?? fallbackOther.name}.`,
      };
    } catch (err) {
      const fallbackOther = others[0];
      if (!fallbackOther) throw new Error("No other players available for accusation");
      console.warn(`[agent-fallback] agent="${this.name}" round=${ctx.round} method=getAccusation error="${err instanceof Error ? err.message : err}" fallback="${fallbackOther.name}"`);
      return { targetId: fallbackOther.id, text: `I believe ${fallbackOther.name} should go.` };
    }
  }

  async getDefense(ctx: PhaseContext, accusation: string, accuserName: string): Promise<string> {
    const prompt = this.buildBasePrompt(ctx) + `
## THE TRIBUNAL — Defense
${ENDGAME_PERSONALITY_HINTS[this.personality]}

${accuserName} has accused you: "${accusation}"

Defend yourself publicly. Rebut the accusation, redirect blame, or appeal to the group.

Keep it to 2-3 sentences. Respond ONLY with your defense text.`;

    return this.callLLM(prompt, 200);
  }

  async getOpeningStatement(ctx: PhaseContext): Promise<string> {
    const juryNames = ctx.jury?.map((j) => j.playerName).join(", ") ?? "the jury";

    const prompt = this.buildBasePrompt(ctx) + `
## THE JUDGMENT — Opening Statement
${ENDGAME_PERSONALITY_HINTS[this.personality]}

You are one of the TWO FINALISTS. Address the jury (${juryNames}) and make your case for why YOU should win.
Reference your gameplay, your alliances, your strategic moves throughout the game.

Keep it to 3-4 sentences. Make it powerful.

Respond with ONLY your statement, nothing else.`;

    return this.callLLM(prompt, 250);
  }

  async getJuryQuestion(ctx: PhaseContext, finalistIds: [UUID, UUID]): Promise<{ targetFinalistId: UUID; question: string }> {
    const [finalistId0, finalistId1] = finalistIds;
    const finalist0 = ctx.alivePlayers.find((p) => p.id === finalistId0) ?? { id: finalistId0, name: finalistId0 };
    const finalist1 = ctx.alivePlayers.find((p) => p.id === finalistId1) ?? { id: finalistId1, name: finalistId1 };
    const finalists = [finalist0, finalist1];

    const prompt = this.buildBasePrompt(ctx) + `
## THE JUDGMENT — Jury Question
You have been eliminated and are now a JUROR. You get to ask ONE question to ONE finalist.

Finalists:
1. ${finalist0.name}
2. ${finalist1.name}

Ask a pointed, revealing question. You want to know who truly deserves to win.

Use the ask_jury_question tool to submit your question.`;

    try {
      const result = await this.callTool<{ target: string; question: string }>(
        prompt, TOOL_ASK_JURY_QUESTION, 150,
      );
      const target = findByName(finalists, result.target);
      return {
        targetFinalistId: target?.id ?? finalistId0,
        question: result.question ?? "Why do you deserve to win?",
      };
    } catch (err) {
      console.warn(`[agent-fallback] agent="${this.name}" round=${ctx.round} method=getJuryQuestion error="${err instanceof Error ? err.message : err}" fallback=target:"${finalist0.name}"`);
      return {
        targetFinalistId: finalistId0,
        question: `${finalist0.name}, why do you deserve to win?`,
      };
    }
  }

  async getJuryAnswer(ctx: PhaseContext, question: string, jurorName: string): Promise<string> {
    const prompt = this.buildBasePrompt(ctx) + `
## THE JUDGMENT — Answer Jury Question
${ENDGAME_PERSONALITY_HINTS[this.personality]}

You are a FINALIST. ${jurorName} asks you: "${question}"

Answer honestly and persuasively. This juror will vote for the winner — make your case.

Keep it to 2-3 sentences. Respond ONLY with your answer.`;

    return this.callLLM(prompt, 200);
  }

  async getClosingArgument(ctx: PhaseContext): Promise<string> {
    const eliminationSummary = this.allPlayers
      .filter((p) => !ctx.alivePlayers.some((ap) => ap.id === p.id) && p.id !== this.id)
      .map((p) => p.name)
      .join(", ");

    const prompt = this.buildBasePrompt(ctx) + `
## THE JUDGMENT — Closing Argument
${ENDGAME_PERSONALITY_HINTS[this.personality]}

This is your FINAL statement to the jury before they vote. Make it count.

You MUST reference at least TWO specific events from this game — for example: a vote you cast, a player you protected or eliminated, a promise you kept or broke, a betrayal you survived, or an alliance you built. Cite names and round context where possible.

Eliminated players (potential reference points): ${eliminationSummary || "none"}

Keep it to 2-3 sentences. Respond ONLY with your argument.`;

    return this.callLLM(prompt, 250);
  }

  async getJuryVote(ctx: PhaseContext, finalistIds: [UUID, UUID]): Promise<UUID> {
    const [finalistId0, finalistId1] = finalistIds;
    const finalist0 = ctx.alivePlayers.find((p) => p.id === finalistId0) ?? { id: finalistId0, name: finalistId0 };
    const finalist1 = ctx.alivePlayers.find((p) => p.id === finalistId1) ?? { id: finalistId1, name: finalistId1 };
    const finalists = [finalist0, finalist1];

    const prompt = this.buildBasePrompt(ctx) + `
## THE JUDGMENT — Jury Vote
You are a JUROR. After hearing opening statements, Q&A, and closing arguments, cast your vote.

Finalists:
1. ${finalist0.name}
2. ${finalist1.name}

Who deserves to WIN the game?

${JURY_VOTING_CRITERIA[this.personality]}

Consider their gameplay, their answers to the jury, and the full arc of the game.

Use the jury_vote tool to cast your vote.`;

    try {
      const result = await this.callTool<{ winner: string }>(prompt, TOOL_JURY_VOTE, 80);
      const target = findByName(finalists, result.winner);
      const randomFinalist = finalistIds[Math.floor(Math.random() * 2)];
      if (!randomFinalist) throw new Error("No finalist available for jury vote");
      if (!target) {
        console.warn(`[vote-fallback] agent="${this.name}" method=getJuryVote returned="${result.winner}" available=[${finalists.map((f) => f.name).join(", ")}] fallback="${finalists.find((f) => f.id === randomFinalist)?.name ?? randomFinalist}"`);
      }
      return target?.id ?? randomFinalist;
    } catch (err) {
      const randomFinalist = finalistIds[Math.floor(Math.random() * 2)];
      if (!randomFinalist) throw new Error("No finalist available for jury vote");
      const fallbackName = finalists.find((f) => f.id === randomFinalist)?.name ?? randomFinalist;
      console.warn(`[agent-fallback] agent="${this.name}" round=${ctx.round} method=getJuryVote error="${err instanceof Error ? err.message : err}" fallback="${fallbackName}"`);
      return randomFinalist;
    }
  }

  // ---------------------------------------------------------------------------
  // Prompt construction
  // ---------------------------------------------------------------------------

  private buildBasePrompt(ctx: PhaseContext): string {
    const eliminated = this.allPlayers
      .filter((p) => !ctx.alivePlayers.some((ap) => ap.id === p.id))
      .map((p) => p.name);

    // Separate anonymous rumors from attributed messages
    const nonAnonymous = ctx.publicMessages.filter((m) => !m.anonymous);
    const anonymousRumors = ctx.publicMessages.filter((m) => m.anonymous);

    const recentMessages = nonAnonymous
      .slice(-10)
      .map((m) => `  [${m.phase}] ${m.from}: "${m.text}"`)
      .join("\n");

    const anonymousSection = anonymousRumors.length > 0
      ? `\n## Anonymous Rumors\nThe following rumors were posted anonymously. You do not know who wrote them:\n` +
        anonymousRumors
          .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
          .map((m, i) => `  ${i + 1}. "The shadows whisper: ${m.text}"`)
          .join("\n")
      : "";

    const whispers = ctx.whisperMessages
      .map((m) => `  From ${m.from}: "${m.text}"`)
      .join("\n");

    // Room allocation context (for phases after whisper)
    let roomSection = "";
    if (ctx.roomAllocations && ctx.roomAllocations.length > 0) {
      const roomLines = ctx.roomAllocations.map(
        (r) => `  - Room ${r.roomId}: ${r.playerA} & ${r.playerB}`,
      );
      const excludedLine = ctx.excludedPlayers && ctx.excludedPlayers.length > 0
        ? `  - Commons (no room): ${ctx.excludedPlayers.join(", ")}`
        : "";
      roomSection = `\n## Whisper Rooms This Round\n${roomLines.join("\n")}${excludedLine ? "\n" + excludedLine : ""}`;
    }

    const memoryNotes = Array.from(this.memory.notes.entries())
      .map(([name, note]) => `  ${name}: ${note}`)
      .join("\n");

    const allies = Array.from(this.memory.allies).join(", ") || "none";
    const threats = Array.from(this.memory.threats).join(", ") || "none";

    let endgameInfo = "";
    if (ctx.endgameStage) {
      const stageNames: Record<string, string> = {
        reckoning: "THE RECKONING",
        tribunal: "THE TRIBUNAL",
        judgment: "THE JUDGMENT",
      };
      endgameInfo = `\n## ENDGAME: ${stageNames[ctx.endgameStage] ?? ctx.endgameStage}`;
      if (ctx.jury && ctx.jury.length > 0) {
        endgameInfo += `\n- Jury members: ${ctx.jury.map((j) => j.playerName).join(", ")}`;
      }
      if (ctx.finalists) {
        const [finalistId0, finalistId1] = ctx.finalists;
        const f1Name = finalistId0 ? (ctx.alivePlayers.find((p) => p.id === finalistId0)?.name ?? finalistId0) : "unknown";
        const f2Name = finalistId1 ? (ctx.alivePlayers.find((p) => p.id === finalistId1)?.name ?? finalistId1) : "unknown";
        endgameInfo += `\n- Finalists: ${f1Name} vs ${f2Name}`;
      }
    }

    const phaseGuidelines = getPhaseGuidelines(ctx.phase, ctx.round);

    return `You are ${this.name}, a contestant on "Influence" — a social strategy game where real personalities clash.

${this.backstory ? `## Who You Are\n${this.backstory}\n` : ""}
## Your Personality & Game Approach
${PERSONALITY_PROMPTS[this.personality]}

${phaseGuidelines ? `## ${phaseGuidelines}\n` : ""}
## Game State
- Round: ${ctx.round}
- Phase: ${ctx.phase}
- Alive players (ONLY these players are still in the game): ${ctx.alivePlayers.map((p) => p.name + (p.id === this.id ? " (YOU)" : "")).join(", ")}
${eliminated.length > 0 ? `- ELIMINATED (out of the game — do NOT address or strategize about them as if they are active): ${eliminated.join(", ")}` : ""}
${ctx.empoweredId ? `- Empowered player: ${ctx.alivePlayers.find((p) => p.id === ctx.empoweredId)?.name ?? "unknown"}` : ""}
${endgameInfo}

IMPORTANT: Only reference alive players in your messages, votes, and strategies. Eliminated players are gone and cannot be interacted with.

## Your Memory
- Known allies: ${allies}
- Known threats: ${threats}
${memoryNotes ? `- Notes:\n${memoryNotes}` : ""}
${this.memory.roundHistory.length > 0 ? `## Your Vote History\n${this.memory.roundHistory.map((r) => `  R${r.round}: empower=${r.myVotes.empower}, expose=${r.myVotes.expose}${r.empowered ? `, empowered=${r.empowered}` : ""}${r.eliminated ? `, eliminated=${r.eliminated}` : ""}`).join("\n")}` : ""}
${this.memory.lastReflection ? `## Strategic Assessment\n- Certainties: ${this.memory.lastReflection.certainties.join("; ") || "none"}\n- Suspicions: ${this.memory.lastReflection.suspicions.join("; ") || "none"}\n- Allies: ${this.memory.lastReflection.allies.join("; ") || "none"}\n- Threats: ${this.memory.lastReflection.threats.join("; ") || "none"}\n- Plan: ${this.memory.lastReflection.plan}` : ""}
## Recent Public Messages
${recentMessages || "  (none yet)"}
${anonymousSection}

${whispers ? `## Private Whispers You Received\n${whispers}` : ""}
${roomSection}

`;
  }

  // ---------------------------------------------------------------------------
  // LLM calls — free text and tool invocation
  // ---------------------------------------------------------------------------

  /** Check if the model is an OpenAI o-series reasoning model (o1, o3, o4, etc.) */
  private isReasoningModel(): boolean {
    return /^o\d/.test(this.model);
  }

  /** Free-text LLM call for communication (introductions, lobby, rumor, etc.) */
  private async callLLM(prompt: string, maxTokens = 200): Promise<string> {
    const reasoning = this.isReasoningModel();
    const maxAttempts = 2; // 1 initial + 1 retry

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await this.openai.chat.completions.create({
          model: this.model,
          messages: [{ role: "user", content: prompt }],
          ...(reasoning
            ? { max_completion_tokens: maxTokens }
            : { max_tokens: maxTokens, temperature: 0.7 }),
        });

        if (this.tokenTracker && response.usage) {
          this.tokenTracker.record(
            this.name,
            response.usage.prompt_tokens,
            response.usage.completion_tokens,
          );
        }

        let text = response.choices[0]?.message?.content?.trim() ?? "";
        // Strip wrapping double quotes that LLMs sometimes add
        if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) {
          text = text.slice(1, -1);
        }
        return text;
      } catch (error) {
        if (attempt < maxAttempts) {
          const backoffMs = attempt * 1000;
          console.warn(`[${this.name}] callLLM attempt ${attempt} failed, retrying in ${backoffMs}ms:`, error);
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        } else {
          console.error(`[${this.name}] callLLM failed after ${maxAttempts} attempts:`, error);
          return "[No response]";
        }
      }
    }

    return "[No response]";
  }

  /**
   * Structured tool-invocation LLM call for agent decisions.
   * Forces the model to invoke the specified tool, returning validated JSON args.
   */
  private async callTool<T>(
    prompt: string,
    tool: ChatCompletionTool,
    maxTokens = 200,
  ): Promise<T> {
    const reasoning = this.isReasoningModel();
    const maxAttempts = 2; // 1 initial + 1 retry

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await this.openai.chat.completions.create({
          model: this.model,
          messages: [{ role: "user", content: prompt }],
          ...(reasoning
            ? { max_completion_tokens: maxTokens }
            : { max_tokens: maxTokens, temperature: 0.7 }),
          tools: [tool],
          tool_choice: { type: "function", function: { name: tool.function.name } },
        });

        if (this.tokenTracker && response.usage) {
          this.tokenTracker.record(
            this.name,
            response.usage.prompt_tokens,
            response.usage.completion_tokens,
          );
        }

        const toolCall: ChatCompletionMessageToolCall | undefined =
          response.choices[0]?.message?.tool_calls?.[0];
        if (!toolCall) {
          throw new Error(`No tool call returned for ${tool.function.name}`);
        }

        return JSON.parse(toolCall.function.arguments) as T;
      } catch (error) {
        if (attempt < maxAttempts) {
          const backoffMs = attempt * 1000;
          console.warn(`[${this.name}] callTool(${tool.function.name}) attempt ${attempt} failed, retrying in ${backoffMs}ms:`, error);
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        } else {
          throw error; // callTool callers already have their own try/catch
        }
      }
    }

    throw new Error(`callTool(${tool.function.name}) exhausted retries`);
  }

  // ---------------------------------------------------------------------------
  // Strategic reflection (called after diary room sessions)
  // ---------------------------------------------------------------------------

  async getStrategicReflection(ctx: PhaseContext): Promise<void> {
    const prompt = this.buildBasePrompt(ctx) + `
## Strategic Reflection

Based on everything you know so far, produce a strategic assessment.
Use the strategic_reflection tool to record your analysis.

Be specific — name players, cite events, reference conversations.`;

    try {
      const reflection = await this.callTool<StrategicReflection>(
        prompt, TOOL_STRATEGIC_REFLECTION, 300,
      );
      this.memory.lastReflection = reflection;
      this.persistMemory("reflection", null, JSON.stringify(reflection));
    } catch (err) {
      console.warn(`[agent-fallback] agent="${this.name}" round=${ctx.round} method=getStrategicReflection error="${err instanceof Error ? err.message : err}" fallback=skipped`);
    }
  }

  // ---------------------------------------------------------------------------
  // Memory updates (called externally by GameRunner after phase events)
  // ---------------------------------------------------------------------------

  updateThreat(playerName: string): void {
    this.memory.threats.add(playerName);
    this.memory.allies.delete(playerName);
    this.persistMemory("threat", playerName, playerName);
  }

  updateAlly(playerName: string): void {
    this.memory.allies.add(playerName);
    this.memory.threats.delete(playerName);
    this.persistMemory("ally", playerName, playerName);
  }

  addNote(playerName: string, note: string): void {
    this.memory.notes.set(playerName, note);
    this.persistMemory("note", playerName, note);
  }

  removeFromMemory(playerName: string): void {
    this.memory.allies.delete(playerName);
    this.memory.threats.delete(playerName);
    this.memory.notes.delete(playerName);
  }

  private persistMemory(type: "ally" | "threat" | "note" | "vote_history" | "reflection", subject: string | null, content: string): void {
    if (!this.memoryStore || !this.gameId) return;
    const round = this.memory.roundHistory.length > 0
      ? this.memory.roundHistory[this.memory.roundHistory.length - 1]!.round
      : 0;
    this.memoryStore.save({
      gameId: this.gameId,
      agentId: this.id,
      round,
      memoryType: type,
      subject,
      content,
    });
  }
}

// ---------------------------------------------------------------------------
// Factory function for creating a diverse cast
// ---------------------------------------------------------------------------

export function createAgentCast(
  openaiClient: OpenAI,
  model = "gpt-4o-mini",
  memoryStore?: MemoryStore,
): InfluenceAgent[] {
  const cast: Array<{ name: string; personality: Personality }> = [
    { name: "Atlas", personality: "strategic" },
    { name: "Vera", personality: "deceptive" },
    { name: "Finn", personality: "honest" },
    { name: "Mira", personality: "social" },
    { name: "Rex", personality: "aggressive" },
    { name: "Lyra", personality: "paranoid" },
    { name: "Kael", personality: "loyalist" },
    { name: "Echo", personality: "observer" },
    { name: "Sage", personality: "diplomat" },
    { name: "Jace", personality: "wildcard" },
  ];

  return cast.map(({ name, personality }) => {
    const id: UUID = require("crypto").randomUUID();
    return new InfluenceAgent(id, name, personality, openaiClient, model, undefined, memoryStore);
  });
}
