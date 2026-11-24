import type { LaunchFormatId } from "@influence/engine/format-presentation-metadata";

type Tone = "safe" | "risk" | "exit" | "choice" | "muted";
interface WalkthroughTile {
  name: string;
  value?: string | number;
  label?: string;
  tone?: Tone;
}
interface WalkthroughShot {
  title: string;
  note?: string;
  holdMs?: number;
  tiles: readonly WalkthroughTile[];
  chain?: boolean;
  pointer?: number;
  roles?: readonly string[];
}

const cast = ["Alex", "Bo", "Casey", "Drew", "Ellis", "Finn"];
const sealedVote: WalkthroughShot = {
  title: "One sealed vote each",
  note: "Vote for another player",
  chain:true, pointer:0,
  tiles: [{name:"Alex", label:"Voter"},{name:"Bo", label:"Receives one vote", value:"+1"}],
};

function totals(title: string, values: readonly (number | string)[], options: {
  names?: readonly string[]; exit?: number; choices?: readonly number[]; safe?: readonly number[];
  muted?: readonly number[]; note?: string; safeLabel?: string; mutedLabel?: string; choiceLabel?: string;
} = {}): WalkthroughShot {
  return {
    title, note: options.note,
    tiles: values.map((value, index) => {
      const name = (options.names ?? cast)[index]!;
      if (index === options.exit) return {name, value, label:"Exits", tone:"exit"};
      if (options.choices?.includes(index)) return {name, value, label:options.choiceLabel ?? "Tied", tone:"choice"};
      if (options.safe?.includes(index)) return {name, value, label:options.safeLabel ?? "Safe", tone:"safe"};
      if (options.muted?.includes(index)) return {name, value, label:options.mutedLabel ?? "Set aside", tone:"muted"};
      return {name, value};
    }),
  };
}

const safetyChain: WalkthroughShot[] = cast.map((name, index) => ({
  title: index === 0 ? "Alex starts Safe" : `${cast[index-1]} points to ${name}`,
  note: index === 0 ? "The House draws a starter" : index % 2 ? "Safe → Vulnerable" : "Vulnerable → Safe",
  chain:true, pointer:index - 1,
  tiles: cast.map((seat, position) => ({
    name:seat, label:position > index ? "Waiting" : position % 2 ? "Vulnerable" : "Safe",
    tone:position > index ? "muted" : position % 2 ? "risk" : "safe",
  })),
}));

const vulnerable = ["Bo", "Drew", "Finn"];
const nominees = (second = "Casey"): WalkthroughTile[] => [
  {name:"Bo", label:"Nominee", tone:"risk"},
  {name:second, label:"Nominee", tone:"risk"},
];
const finalPair = ["Bo", "Ellis"];
const empowerTie = "Empowered chooses between the tied players";

const DEFAULT_SHOT_MS = 3200;
const FORMAT_WALKTHROUGHS = {
  even_votes: [
    sealedVote,
    totals("Only even totals count", [3,2,1,0,0,0], {muted:[0,2], safe:[1,3,4,5], safeLabel:"Counts", mutedLabel:"Odd",note:"Zero counts as even"}),
    totals("Bo exits", [3,2,1,0,0,0], {exit:1, muted:[0,2], mutedLabel:"Odd",note:"Highest even total"}),
    totals("If the highest even totals tie", [2,2,1,1,0,0], {choices:[0,1], muted:[2,3], mutedLabel:"Odd", note:empowerTie}),
    totals("If every total is odd", [1,1,1,1,1,1], {choices:[0,1,2,3,4,5], choiceLabel:"Eligible",note:"Empowered chooses from everyone"}),
  ],
  safety_bounce: [
    ...safetyChain,
    {title:"Everyone votes",note:"Cast a sealed vote for a Vulnerable player",tiles:vulnerable.map(name => ({name,label:"Vulnerable",tone:"risk"}))},
    totals("Bo exits",[3,2,1],{names:vulnerable,exit:0,note:"Most votes among Vulnerable players"}),
    totals("If the vote ties",[3,3,0],{names:vulnerable,choices:[0,1],note:empowerTie}),
  ],
  two_names: [
    {title:"Alex names two players",tiles:nominees(),roles:["Alex · Empowered"]},
    {title:"The House draws Override",tiles:nominees(),roles:["Drew · Override"],note:"Any living player except Empowered, including nominees",holdMs:5100},
    {title:"First Mingle",tiles:nominees(),note:"Time to talk"},
    {title:"Drew’s choice",tiles:nominees(),roles:["Keep both · Go to pleas","Remove one · Alex names a replacement"],holdMs:4900},
    {title:"Drew removes Casey",tiles:[nominees()[0]!, {name:"Casey",label:"Removed",tone:"exit"}]},
    {title:"Alex names Ellis",tiles:[nominees()[0]!, {name:"Ellis",label:"Replacement",tone:"safe"}]},
    {title:"Second Mingle",tiles:nominees("Ellis"),note:"Time to talk after a replacement"},
    {title:"The nominees make their pleas",tiles:[{name:"Bo",label:"First plea",tone:"risk"},{name:"Ellis",label:"Second plea",tone:"risk"}]},
    {title:"Four players vote",tiles:nominees("Ellis"),roles:["Vote · Casey, Drew, Finn and Gray","Sit out · Empowered and both nominees"],note:"One sealed vote for a final nominee",holdMs:6500},
    totals("Ellis exits",[1,3],{names:finalPair,exit:1,note:"Higher total exits"}),
    totals("If the vote ties",[2,2],{names:finalPair,choices:[0,1],note:"Empowered chooses between the final nominees"}),
  ],
  majority_elimination: [
    sealedVote,
    totals("Bo exits",[1,3,2,0,0,0],{exit:1,note:"Highest vote total"}),
    totals("If the highest totals tie",[2,2,1,1,0,0],{choices:[0,1],note:empowerTie, safe:[2,3,4,5],safeLabel:"Lower total"}),
  ],
  vote_bomb: [
    sealedVote,
    totals("Zero votes is safe",[3,2,1,0,0,0],{safe:[3,4,5],note:"Compare players who received votes"}),
    totals("Casey exits",[3,2,1,0,0,0],{safe:[3,4,5],exit:2,note:"Fewest votes among players with at least one"}),
    totals("If the lowest positive totals tie",[3,1,1,1,0,0],{choices:[1,2,3],safe:[4,5],note:empowerTie}),
  ],
  save_or_eliminate: [
    {title:"One sealed ballot each",note:"Choose Save or Exit for another player",tiles:[{name:"Save",value:"+1",tone:"safe"},{name:"Exit",value:"−1",tone:"risk"}]},
    {title:"Add Saves and Exits",tiles:[{name:"Alex",label:"One Save",value:"+1"},{name:"Bo",label:"Two Exits",value:"−2"},{name:"Casey",label:"One Save and one Exit",value:"0"},{name:"Drew",label:"One Exit",value:"−1"}]},
    totals("Bo exits",["+1","−2","0","−1","0","0"],{exit:1,note:"Lowest net total"}),
    totals("If the lowest net totals tie",["+1","−1","0","−1","+1","0"],{choices:[1,3],note:empowerTie}),
  ],
  restricted_history: [
    {title:"Available from round 3",note:"One sealed Exit vote for another player",tiles:[{name:"Alex",label:"Voter"},{name:"Bo",label:"Previously targeted with Exit",tone:"muted"},{name:"Casey",label:"Eligible",tone:"safe"}]},
    {title:"No targets left",note:"Alex forfeits the ballot",tiles:[{name:"All other players",label:"Previously targeted with Exit",tone:"muted"}]},
    totals("Casey exits",[0,1,3,1,1,0],{exit:2,note:"Highest vote total"}),
    totals("If the highest totals tie",[0,2,2,1,1,0],{choices:[1,2],note:empowerTie}),
  ],
} satisfies Record<LaunchFormatId, readonly WalkthroughShot[]>;

export function formatWalkthroughTimeline(formatId: LaunchFormatId) {
  const shots: readonly WalkthroughShot[] = FORMAT_WALKTHROUGHS[formatId];
  let endMs = 0;
  return shots.map(shot => {
    const startMs = endMs;
    endMs += shot.holdMs ?? DEFAULT_SHOT_MS;
    return {shot, startMs, endMs};
  });
}
