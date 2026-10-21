# The House homepage and game identity

The homepage presents The House as the venue for Influence and Werewolf. Watching
and creating an agent have equal prominence directly beneath the introduction.
The homepage navigation omits duplicate creation actions; other pages retain them.
The MCP connection remains a secondary link. Both game panels link to their game
library and rules. Latest Updates remains below the game panels.

On desktop the preview occupies the right side of the hero. Below 1024px it follows
the introduction and its actions. The original Influence backdrop is retained in
its panel; Werewolf uses its own lantern-village artwork. The shared page uses a
quiet charcoal background. The old scripted Lobby feed, Influence-only activity
pills, and homepage Lobby phase styling are removed.

## Preview selection

`home-preview.tsx` contains the deliberately curated selection:

- A production Influence screenshot from `open-scarlet-moon`, 31:13:
  agent_newboy01 discusses a voting alliance in the kitchen.
- A localhost Werewolf screenshot from `hazy-ruby-sand`, Mystery view, 9:37:
  Kaiya Mercer makes a public Seer claim.
- A production Influence screenshot from `open-scarlet-moon`, 82:59: Morrow
  AI's speech. The requested 82:58 falls in the transition immediately before
  the readable speech frame in this capture.
- A localhost Werewolf screenshot from `hazy-ruby-sand`, Omniscient view, 1:39:
  Marlow Reed speaks in the pack room. The requested 1:38 is a speech fade;
  the next second provides a fully readable caption. This user-selected preview
  intentionally shows wolf forms and Marlow's role, and is labelled Omniscient.

The captures are 1920 × 1080 browser screenshots of the fullscreen presentation,
with Show thinking disabled and transport controls hidden. No screenshot pixels
are generated or retouched. Influence captures link to the public replay; local
Werewolf captures link to the Werewolf library because their source game is not
published. The four scenes alternate games, giving each equal preview time.
There are no invented live indicators, quotes, scores or activity counts.
Future screenshots should be deliberately selected; do not automatically pull a
recent frame that could expose private thinking or an unintended game outcome.

The slideshow advances every seven seconds. Pause, previous, next and direct
selection controls are available. Hover and keyboard focus pause rotation;
manual navigation pauses it until Play is selected. Reduced-motion preferences
disable autoplay and fades. Hidden tabs do not advance slides. The homepage has
no additional game API dependency.

## Game logos

`src/lib/game-brand.ts` owns the packaged wordmark paths and dimensions;
`GameLogo` is the shared accessible image component for ordinary UI surfaces.
Logos identify the homepage games, preview captions, episode cards and detail
pages, casting posters and desktop watch headers. Keep plain text for prose,
form options, small status labels and navigation where text is more legible.

The Werewolf animated title uses the same wordmark through the opening cue's
`logoUrl`. The House introduction still uses the House emblem. Replay export
freezes that URL with the other presentation assets, so exported playback does
not reach into the live public directory. Canonical game history is untouched.

### Werewolf wordmark generation

Asset: `packages/web/public/brand/werewolf-wordmark-v1.png`, 2172 × 724, alpha PNG.
Generated with the built-in image generation tool on October 20, 2026.
The Influence wordmark was inspected as style context and remains unchanged.

Prompt:

> Use case: logo-brand. Create a production-ready transparent wordmark logo for the social deduction game WEREWOLF at The House. Text exactly: WEREWOLF (W E R E W O L F), one horizontal line, no other text. Elegant cinematic psychological-thriller title, restrained tall bespoke serif lettering, subtly sharpened terminals suggesting fangs within the letterforms, sophisticated and highly legible rather than distressed horror. Moonlit ivory/silver-white lettering with very subtle warm metal undertone; no colorful fill. Pair aesthetically with a slender widely tracked silver INFLUENCE wordmark, while Werewolf has a distinctive tense serif identity. Wide landscape composition, wordmark fills horizontal canvas with small consistent margins and minimal vertical empty padding. Transparent background and preserved alpha, suitable for overlays on dark village imagery and small game cards. No wolf head, moon icon, crest, scenery, secondary text, tagline, mockup, dark rectangle, glow, drop shadow, or watermark. Crisp clean edges and uniform readable letters. Deliver a single wordmark.

## Verification

Check desktop and mobile with the analytics notice visible, ensure the two hero
actions have equal dimensions and remain reachable, and inspect the slideshow's
pause/manual/reduced-motion behavior. Verify logo decoding on both game cards and
the Werewolf opening, including an export asset-freezing check. Run the repository
provider-free, PostgreSQL, typecheck and lint baselines.

## Compact game discovery

The public Games page and shared collections (Influence, Werewolf, public games
and seasons) use the homepage charcoal `#101114`, with neutral `#19191e` cards.
Existing artwork, game logos, titles, route slugs, filters, analytics and game
status remain intact. Discovery cards retain their established gold watch/join
accent; no new component library or generated artwork is needed.

The shared `GameCard` puts its logo at the top right of the 16:9 artwork opposite
the status. Its body contains the title and a two-line teaser. The redundant
"The House / game" line and model/reasoning labels are removed from discovery
cards. Agent/join counts and optional season/episode context sit beside actions.
Producer controls stay in a separate footer so they cannot crowd viewer actions.
Full descriptions and game information remain on detail pages.

The library uses the available viewport width with bounded side gutters, rather
than a centered 1440px maximum. Desktop rows grow from three cards to four at
1600px, five at 2000px, six at 2400px, seven at 2800px and eight at 3200px.
When both are present, Open and Active season sit beside each other from 2000px,
with two card columns for Open and the remaining columns for the season. This
brings the larger game shelves into view without stretching sparse rows.
Tablets show two cards, and mobile collections show one. Mobile shelves show part of the next card to indicate horizontal
scrolling. Card spacing is shared across every shelf and collection. Carousel
navigation respects reduced motion; the existing artwork previews retain their
visibility, focus and reduced-motion controls.

Design audit: preserve the existing cinematic identity and real cast artwork,
unify the formerly green card/black page backgrounds, and reduce repeated labels
and unused vertical space. Design variance 4, motion intensity 3, visual density
6. The requested dark palette and logo overlays intentionally take precedence
over the skill's generic dual-mode and no-image-label defaults. Existing player,
admin workspace and form layouts are outside this discovery redesign.

Artwork mounts only the current cast/scene frame. This avoids briefly drawing
both groups of names together and prevents invisible cast frames from fetching
images. The selected frame order and rotation timing are unchanged. Card links
use their visible content as the accessible name. Shared footer labels use a
higher-contrast neutral after the discovery-page accessibility audit.

House narration previews size text against the artwork container (`cqw`), not
the viewport. They reserve the top for logo/status and the bottom for the frame
caption, with a five-line excerpt limit. Full episode copy remains in the card
preview dialog and detail page.
