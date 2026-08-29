# Two Names Viewer Choreography

**Status:** Visual direction for implementation  
**Prototype:** [`two-names-viewer-ui.html`](./two-names-viewer-ui.html)  
**Parent plan:** [`../plans/2026-08-28-001-feat-two-names-format-plan.md`](../plans/2026-08-28-001-feat-two-names-format-plan.md)

## Experience thesis

Two Names should feel like a public political rupture, not another tally card. Its visual identity is a **duel dossier**: two oversized names share one field of tension while the people responsible for changing that pair move visibly through the ceremony.

Safety Bounce earns attention through spatial movement between pools. Two Names earns it through **persistent stakes and controlled substitution**:

- Empowered is introduced first, then moves into a quiet corner anchor before each nominee arrives;
- the Override draw creates a second visible power center;
- a used Override physically breaks the pair before the replacement enters;
- both Mingles return to the existing conversation view, where compact player tags carry the relevant roles;
- pleas temporarily strip away all other game noise;
- the sealed ballot becomes a bilateral contest rather than a generic table;
- an exact tie returns the whole frame to Empowered.

The presentation is editorial luxury inside the existing dark broadcast shell: near-black void, warm ivory display type, muted gold for authority, violet for Override, rose for danger, and vivid agent portraits. Large ceremony surfaces use nested bezels and quiet material depth rather than generic bordered cards.

## The invariant composition

Every Two Names moment is composed from two layers.

### 1. Ceremony power anchors

Ceremonies earn their role context through continuity rather than a persistent status rail:

1. Empowered is revealed at center, then the same portrait moves into a small top-left anchor.
2. The Override holder is absent until the draw reveals them, then the same portrait moves into a top-right anchor.
3. Nominee dossiers remain the sole large source of truth for the current pair; do not repeat the pair in the header.

The anchors appear only after their corresponding public reveal. They stay secondary to the ceremony and may disappear when the established Mingle surface takes over. Long names truncate visually but retain full accessible labels and browser title text.

During Mingles, role tags in the existing cast/sidebar surface identify Empowered, nominated, and Override players. The tags are current state, not a historical ledger. Removed-name history belongs to replay and completed results.

### 2. Transforming main stage

The stage changes by semantic cue. Ceremonies temporarily take over the theater; Mingles return the existing conversation surface to primary position with a simple fade out/fade in. Role anchors never compete with a ceremony, and the pair is never duplicated above its dossier cards.

## Beat contract

| Beat | Main stage | Role continuity | Motion and pacing |
|---|---|---|---|
| Format locked | “Two Names” title and concise rule | No unrevealed role appears in a corner anchor | 1.2s breath, then setup |
| Empowered intro and initial naming | Empowered owns the field first; after the portrait moves to the top-left, `Atlas nominates:` appears and the two dossier cards reveal one at a time | Empowered installs only after the transfer; Override remains absent | Portrait transfer, then opposing shallow-Y rotations with enough separation to read each choice |
| Override draw | Canonical roster portraits orbit a quiet draw field; the accepted holder enlarges at center | Holder installs at top-right only after the draw settles | Candidate cycling is presentation only; accepted holder is never chosen by animation |
| Initial-names Mingle | The existing room/dialogue experience remains primary | Sidebar/cast tags identify Empowered, both nominees, and Override | Simple fade only; speaking agents retain normal viewer treatment |
| Override declined | Holder receives a focused portrait beat: “leaves the names untouched” | Both power anchors may remain; initial dossiers are now final | One decisive crossfade; 1.8s hold; no second-Mingle cue |
| Override removal | Reuse the two-dossier composition. The removed dossier receives one diagonal strike, then fades from its slot; the retained dossier does not move | Both power anchors remain | The replacement must not leak during this beat even though removal and replacement committed atomically |
| Replacement reveal | The replacement rotates into the exact slot vacated by the removed dossier; the retained dossier remains spatially continuous | Both power anchors remain | One named entrance; ambient field subtly changes only after the new pair is legible |
| Final-names Mingle | The existing conversation surface returns with fresh state | Sidebar/cast tags identify Empowered, final nominees, and used Override | Simple fade only; never reuse first-Mingle room motion or inbox state |
| Plea one | First finalist portrait plus one large editorial quotation; opponent remains absent rather than competing visually | `FINAL PLEA · 1 OF 2` | Uninterrupted; duration follows readable text pacing with a 1.5s minimum hold after completion |
| Plea two | Same composition mirrored for the second finalist | `FINAL PLEA · 2 OF 2` | Same visual weight and pacing as plea one |
| Plea absent | Portrait remains; the quote field says “No plea was received” | Correct plea ordinal remains visible | 1.5s semantic beat; never synthesize contestant speech |
| Ballots sealing | `Exit voting begins` above two finalists and a sealed central disc; receipt pips show accepted count only | Power anchors remain secondary | Targets, leaning, and running totals remain hidden |
| Named roll call | Each accepted voter-to-target receipt enters in canonical roster order; bilateral totals update beside the two finalists. Show `Tie` only when the totals are equal | Power anchors remain secondary | Each receipt gets 0.7–1.0s; the final receipt gets a longer hold |
| Clear result | Higher-total side gains visual weight; the other dossier recedes | `RESULT LOCKED` | 1.6s result hold before elimination |
| Exact tie | A balanced center mark replaces the sealed disc | `TIE` | 1.4s suspension before the tiebreak stage |
| Empowered tiebreak | Empowered portrait descends into a gold decision chamber; final pair remains named in the rail | `EMPOWERED TIEBREAK` | 2.0s setup, then accepted choice reveal |
| Elimination | Eliminated portrait and name own the field; resolution method remains a small factual caption | Eliminated name is marked only when the elimination cue is public | Weighty fade and scale only; no celebratory survivor treatment |

The interactive prototype follows the Override-used tie branch because it contains every presentation primitive. It also includes the decline branch as an alternate preview; production cue order selects exactly one branch.

## Visual system

### Typography

- **Ceremony display:** Instrument Serif or an equivalently high-contrast open-source variable serif, self-hosted through `next/font/local` with its license committed. Use it only for names, verdicts, and high-drama statements.
- **Interface and dialogue:** Geist Variable or Plus Jakarta Sans, also self-hosted. Use compact uppercase micro-labels for role and state metadata.
- **Canonical counts:** JetBrains Mono or the existing viewer monospace stack.
- Do not use the current generic system stack inside the Two Names stage. The serif/sans contrast is the format's editorial signature.

### Color authority

- **Ivory `#F5F1EA`:** primary name and ceremony text.
- **Authority gold `#E7BD70`:** Empowered and tiebreak focus.
- **Override violet `#A68CFF`:** holder, draw, and Override decision.
- **Danger rose `#FF7B91`:** named, removed, votes, and elimination.
- Agent art remains vivid; large color fields stay restrained so portraits retain hierarchy.

### Material hierarchy

- Ceremony cards use a double bezel: a translucent outer tray, 6–8px inset, and a darker inner core with a top-edge highlight.
- Role anchors and Mingle tags use the same construction at lower contrast.
- Avoid generic one-pixel gray outlines, flat rounded rectangles, harsh shadows, and thick iconography.
- Blurred glass is limited to the fixed playback dock or existing sticky shell chrome. Scrolling stage content uses opaque/translucent surfaces without backdrop blur.

## Motion language

All animation is authored through the existing presentation director and Motion controls. CSS or Motion may animate only `transform` and `opacity`; layout state changes use layout projection rather than animating dimensions.

- **Heavy entrance:** `cubic-bezier(0.16, 1, 0.3, 1)`, 800–1100ms.
- **State crossfade:** `cubic-bezier(0.32, 0.72, 0, 1)`, 450–700ms.
- **No looping spectacle during dialogue.** The draw may have a bounded scan; it stops on the accepted holder.
- **No screen shake.** Political tension comes from composition and pacing, not arcade effects.
- Playback pause, resume, speed, manual advance, and reconnect remain owned by the existing director.

## Reconnect and entry policy

Live reconnect prioritizes trustworthy synchronization over replaying missed drama.

- Hydrate the last trusted snapshot and the persisted publication/presentation cursor.
- Do not replay naming, draw, Override, or ballot actions already presented before the reconnect boundary.
- If removal has been published but replacement reveal has not, render the retained dossier and an empty vacated slot. Do not expose the replacement before its publication beat.
- If replacement reveal has published, enter directly on the final pair.
- Replay mode retains every beat and can seek to any canonical sequence.
- Completed entry renders the last trusted terminal composition; it does not synthesize missing intermediate cues.

## Reduced motion and accessibility

- Reduced motion removes orbiting, rotation, parallax, and positional interpolation but preserves every semantic beat as a crossfade.
- Each ceremony keeps a minimum 1.25s readable dwell; removal and replacement each keep 1.75s so the substitution remains understandable without movement.
- Pleas use text-length-aware dwell and retain the same post-text hold.
- Use one polite live-region announcement per cue. Announce role, pair, Override decision, replacement, ballot progress, tie, tiebreak, and elimination as structured facts.
- Passive ceremonies never steal focus. Existing playback controls retain focus across cue changes.
- The vacated replacement slot announces “Replacement pending” rather than exposing an accessible full name early.
- Color is never the sole state indicator: every role and result has a visible text label.

## Mobile contract

- Below 768px, remove card rotation and overlap. The pair remains two columns when both names are the point; all other layouts collapse to one column.
- Power anchors remain at the top corners after reveal without consuming a full status row. During Mingles, the existing compact sidebar/cast area carries the role tags.
- Nominee names use one visible line with an accessible full label; the pair gets priority over descriptive copy.
- Plea portrait moves above the quotation. Ballot finalists remain side by side with the sealed state above them.
- The viewer's existing compact header and playback dock remain sticky; only theater content scrolls.
- Minimum interactive target is 44px for prototype and replay controls.

## Incomplete-state behavior

Malformed or incomplete trusted prefixes retain the last valid revealed role anchors and replace the stage with a restrained broadcast-sync panel:

- title: `Broadcast sync paused`;
- body: `Waiting for the next trusted game state.`;
- trusted-through sequence remains visible;
- replay controls pause automatically when no valid next cue exists;
- no transcript prose is parsed to fill the missing state.

This state is visually different from a legitimate absent plea, which remains part of the normal sequence and advances automatically.

## Component boundary

The production implementation should keep the visual surface cohesive while leaving the existing director in charge:

- `TwoNamesRoleAnchors` — pure trusted-snapshot rendering for already revealed power roles;
- `TwoNamesStage` — semantic cue router, not a second playback controller;
- `TwoNamesNomineeDossier` — shared initial/final/replacement card;
- `TwoNamesOverrideDraw` — accepted-holder choreography;
- existing Mingle surface — extended only with compact trusted role tags and a Two Names scene key;
- `TwoNamesPleaStage` — bounded speech or typed absence;
- `TwoNamesBallotStage` — sealed progress, roll call, tally, and tie;
- existing `FormatPresentationDirector` — cursor, time, pause, speed, reduced motion, and hydration.

The prototype is a visual reference, not production source. Production components must render real `GamePlayerAvatarPreview` identities, compile only typed viewer decisions, and preserve the current watch shell's live/replay parity.

## Visual acceptance set

Capture and review these screenshots before merging:

1. initial naming, desktop and 390px mobile;
2. accepted Override draw;
3. first Mingle using the existing view with compact role tags;
4. decline branch;
5. removal with a visibly vacated slot and no replacement leak;
6. replacement rotating into that same slot;
7. second Mingle;
8. both pleas plus typed absence;
9. partial sealed-ballot progress with no target leakage;
10. clear tally and exact tie;
11. Empowered tiebreak;
12. elimination;
13. reconnect at removal/replacement boundary;
14. reduced-motion versions of removal, replacement, and roll call;
15. malformed-prefix broadcast-sync panel.

Every screenshot must use the same deterministic fixture IDs and accepted canonical prefix as the model/director tests.
