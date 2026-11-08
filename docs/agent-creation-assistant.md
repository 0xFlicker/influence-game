> Current workspace: Guided and Advanced share one persistent draft, model and voice controls, explicit artwork selection and a before/after submission review. Save enters enforced screening; see [the current contract](agent-content-submissions.md). The assistant stage/command details below operate inside that workspace.

# Guided Agent creation

Once a draft has character text, an unscoped `revise_character` turn uses the
existing strict edit tool to select fields before generation. Gender edits may
update pronouns and gendered references in related text, and character edits can
complete missing fields, including game notes. Populated unrelated content and
the existing name stay fixed unless the user requests a change. Explicit section
choices supply the requested scope; focused strategy edits stay isolated to that
game. The tool carries an explicit `generateImages` decision, so text consistency
in appearance/performance notes does not itself dispatch artwork. Image requests
still require explicit intent, and all text changes appear in the review.

## Public preview and signup

`/agents/create` is the canonical public creator for ordinary, join-game, and
Daily Free entry points. The former dashboard creation route is removed. Arriving
signed out shows the same stone hall, House mark, ingredients, and composer;
it does not open authentication.

An anonymous browser gets one successful House text message. A single strict
structured provider attempt returns `{reply, profile}`: questions can receive a
grounded answer with `profile: null`, and character ideas can produce all nine
character cards, including separate Influence and Werewolf strategies. There is no image generation or Agent saving in this endpoint.
Approval remains a local action. Asking for another message, an image, Advanced
create, or a server save opens account creation. The authentication modal uses
the House hall, gold mark, and muted purple surfaces. Free accounts keep the
existing text and image allowances (100 text operations and 25 image operations).

`GET /api/agent-profiles/anonymous` establishes a signed, HTTP-only browser cookie
and reads whether its message is used. `POST` accepts only a message, curated
ingredient IDs, and an idempotency key. PostgreSQL serializes admission to the
Anonymous pool: at most one provider dispatch globally per rolling minute. Busy
responses include `Retry-After` and offer account creation or trying later,
without consuming that browser's message. Browser identity is not proof of a
person; clearing cookies creates a new visitor, still subject to the global cap.

`anonymous_text_operations` stores hashed visitor identity, operation state,
provider request identity, token counts, estimated cost, and accepted results.
Exact successful replays return the stored result without another provider call.
Confirmed failures preserve cost evidence and allow a new attempt after the
global cooldown. Unknown transport outcomes retain the visitor's used slot.
The admin inference page reports this pool separately as **Anonymous**, including
recent operations without raw prompts or character content. Game spend and
authenticated account balances remain separate.

Anonymous drafts use the existing tab-local editor storage. The active form keeps
its draft storage owner through signup, preserving cards, typed text, and stage
without a remount. An authenticated reload can recover an anonymous draft when
there is no account-specific draft. Saving or discarding retires the active draft.

## Guided interaction

All creation entry points (ordinary, join-game and Daily Free) offer an AI
assistant or Advanced create. Advanced uses the existing full editor and save
contract. Switching from the assistant preserves the current draft. The former
site-wide Daily Free acquisition prompt is no longer displayed; queue entry lives
on the relevant game and season pages.

The assistant fills the viewport over a dark stone hall with gold and purple
accents. The House mark and starting cue remain in the upper scene through
clarifications and failed requests. Once character text or a portrait exists,
the upper scene becomes a character summary. On tall screens its cards grow
within the upper half of the viewport; the summary never extends below the
midpoint. The summary stays at the top while the conversation moves beneath it.
Messages build from the bottom, with older bubbles clipped above the visible
area and no message scrollbar.
On short screens the page itself can scroll. The inset circular send arrow
becomes the activity indicator while working; mobile generation messages use
the full width without a separate icon. The House message, ingredient picker,
and labeled composer share one centered column. Ingredient rows stay directly
above the composer when available; the composer has a distinct surface and
border so the entry point stays visible.
Clicking a long-text character tile or an Advanced **Refine** link selects that
field and focuses the Guided composer immediately. Image **Revise** uses the same
transition, scoped to Appearance. Its arrow separately opens a full-text reader;
reading never selects a change. A mouse hover previews full text after 600ms,
without reflow, and can be dismissed with Escape. Touch uses the arrow.
Name and Archetype open compact editors directly in Guided. Cancel or Escape
discards the local buffer; OK (or Enter for Name) applies it to the shared draft.
The sparkle queues that field's existing draft value for the next assistant turn,
preserves the composer message and returns focus there without making a request.
All these dialogs anchor near the clicked tile, flip to fit, and stay inside the
visible viewport rather than using the editor's bottom activity panel position.
The selected section appears above the composer with its current text; longer
text can be expanded inline. Removing the section restores an unrestricted
message. Selecting another section replaces the scope. Repeating Refine on the
same field restores focus and scope. Failed requests preserve both scope and
message, while successful requests clear them. Selected sections constrain which
generated fields the client applies.

Authenticated generation and Review wait for account-draft recovery. The footer
shows “Loading draft…” while the account read is pending; loading alone does not
show a failure or start an image request. A failed read retains Reload and support.
Closing an untouched creator does not create an empty recovery draft.
The footer reserves its geometry from initial loading through draft restoration,
text updates, image work and validation. It stays fixed on mobile with content
space reserved underneath. Activity opens a dialog above the footer (a sheet on
mobile), containing requests, draft choices/conflicts and moderation details.
Resume remains a direct footer action. No late status adds a row above the form,
and reveal motion never translates the editor vertically.

Active text generation sweeps only its selected fields (including missing fields
being completed), in Guided fixtures and Advanced inputs. The composer shows
activity immediately while routing or awaiting a reply. Existing artwork stays
still during text-only edits. Image generation and portrait preparation scan the
artwork independently, retaining its pixels and the real operation stage. These
indeterminate effects do not imply a percentage or completion estimate. They use
existing geometry and stop on success, failure or cancellation. Reduced motion
uses a static highlight instead of a moving scan.

Agent management opens an owner's profile from the agent image or name. Both
share one keyboard-focusable link and preserve the list's return position. Edit
remains the card's primary button; there is no separate View button.
Edit, Analyze and Archive share one always-visible row without a disclosure.
Archive asks for confirmation with Cancel and Archive, without a duplicate Close
action or a change to the gallery layout.
Analyze remains available because the collection does not provide a reliable
availability flag across season receipts and owner learning; management does not
load each agent's analysis just to decide whether to show a link.
The Needs attention panel and filter are hidden when no agents need attention,
using the collection's existing attention list without an extra request or scan.
An empty attention filter returns to All and removes that URL parameter while
preserving search and the agent return position.
Management cards put the name, archetype, model, voice and activity in badges over
the full-body artwork. The name sits above the figure; other badges occupy its
left edge. Voice badges include the catalog gender, never an inferred character
gender. Only Edit, Analyze and Archive sit below the picture. Cards have a fixed
picture height, and long names reflow above the image rather than covering faces.
Ready agents have no status badge. Pending edits show Still usable alongside
review status only when a published version exists. Queued/running image work
scans the artwork; automatic review spins its badge without scanning the image.
Effects stop on terminal states and respect reduced motion. Status changes never
move the action row or neighboring cards.
The management grid always uses the full content width. Generation requests,
attention items, errors and accepted game/season continuations appear in Activity,
whose count includes each pending continuation. Activity never reserves a sidebar
or changes card positions when its contents change.
The management header has no duplicate Create action. Its Activity control is an
icon with a numeric badge, hidden when empty. It spins for queued/running image
work and automatic review, stays still for results or errors needing a decision,
and respects reduced motion. The dialog includes reviewing agents as well as
attention items and image requests.
The owner profile's Agents link sits above the background panel, aligned with the
profile heading and separated by a 16px gap on desktop and mobile.

Pending images appear in both the editor and agent management. View reconnects to
the correct workspace; Cancel keeps character edits while retiring image work.
See [pending generation and charge recovery](agent-generations.md).

After character text exists, Guided has a direct Gender control. It changes the
draft immediately without inference, pronoun rewriting, or image generation.
On acceptance, an automatic voice follows the saved gender; an explicitly
selected voice stays selected. AI requests can also change gender through the
strict structured field: the existing value is context, not a fixed constraint
when gender is selected or the request is unrestricted. An explicit top-level
gender constraint or an edit to other selected fields keeps gender fixed.

Voice options display the catalog's Male/Female label beside each name, and the
selected voice retains that label in the closed picker.

Advanced groups Character, Strategy and Appearance inside one dark, blurred
panel with connected tabs. Arrow keys, Home and End navigate the tabs. Model and
voice preferences stay outside this panel. Archetypes use a styled listbox with
icons, descriptions, typeahead and keyboard navigation.

Exhausted or paused generation allowance still opens the contact dialog with
Discord, email and X links, including inside the workspace. Dismissing it leaves
the draft and unsent message intact; a short inline notice retains support links.

Submitted messages appear on the right and clear the composer immediately, with
an assistant typing bubble while awaiting a response. The ingredient picker,
composer, and secondary actions remain in place but are disabled while working.
Failed requests restore the typed message for retry.

Starter ingredient pills and “Surprise me” use the same curated traits as
Advanced create. Background (including interests), Strategy, and Gender rows start the
conversation; the appearance question offers form and visual-style pills.
Human, halfling, and gnome are among the initial form options.
Both character and portrait review hide the ingredient picker so the player can
focus on approval or describe a specific change.
Pill rows hide native scrollbars and subtly fade only edges with more content;
swipe, trackpad, and keyboard navigation remain available.
Gender uses the same independently selectable tags, including multiple gender
directions. Selecting a suggestion consumes it until the next shuffle, even if
the active tag is removed. Shuffling excludes all active tags.
Selected ingredients become removable tags and can be sent
without typing a prompt. Successful turns clear them; failed
requests preserve the tags and typed message for retry.

The conversation proceeds through character direction, character approval,
appearance and portrait review. Character feedback regenerates the draft and
asks for approval again. The explicit “Yes, that feels right” button advances
locally without a model call; typed replies still use the command router.
Approval requests appearance only when no image exists. With an existing image,
it returns to portrait review or submission, preserving the confirmed headshot
after text refinements. Approval does not generate
images automatically. Appearance generation preserves the approved character
text. Appearance generation temporarily replaces the summary cards with a
formation scene: a pulsing silhouette, rising light, and sparse particles. It is
indeterminate, makes no percentage or timing claims, and becomes static for
reduced-motion preferences. The previous/default portrait stays hidden. A failed image request can be retried with its existing request ID.

`POST /api/agent-profiles/creation-assistant` is authenticated and returns
`{command, reply}`. Each stage has an exact provider-native JSON schema and
semantic decoder shared with the client. `reply` is short model-authored
presentation text only for `clarify`; every action command requires an empty
reply. It can answer a game question, explain a choice in the current draft,
or offer distinct character directions before asking what the player wants.
No reply prose or user-text regexes control transitions. Invalid, extra-field,
fenced, incomplete or out-of-stage output fails the turn without applying
effects. The application owns action replies, generation and save actions.
Abuse and repetitive loops can end chat;
the draft remains available in Advanced create. Ordinary criticism and fictional
villainous characters are not grounds for ending a conversation.

The guided router receives the current draft; guided and Advanced editors and
profile generation share a compact general rules and strategy primer in
`packages/api/src/services/agent-creation-game-primer.ts`. It summarizes the
Influence standard rounds, ballot rules, endgame, jury and alliance limits, plus Werewolf role knowledge, day/night rules, faction victory and character tradeoffs. Identity and visuals are shared; strategyStyle is Influence only and werewolfStrategyStyle is Werewolf only. New profiles receive suggestions for both games, and blank Werewolf notes use a previewable archetype-specific default frozen at game start. It describes no live game state or
guaranteed format, and prompt writers should keep it aligned with the canonical
format catalog and public rules when those rules change.

The guided command router and character writer use low reasoning effort. The
Advanced Workshop uses strict function tools with `reasoning_effort: "none"`:
GPT-6 Luna rejects function tools with reasoning in Chat Completions. All three
explicitly request Standard (`service_tier: "default"`), bypassing the background Flex
transport. Each provider call has a 45-second timeout and no SDK retries; the
command request has a 60-second browser deadline. Timeouts return a readable retry message and
leave the draft intact. Game and background generation policy is unchanged.
[Flex processing](https://developers.openai.com/api/docs/guides/flex-processing)
trades lower cost for slower responses and occasional resource unavailability;
interactive character creation uses Standard instead.

## Advanced edit and incomplete profiles

The Workshop sends incomplete drafts to inference; missing gender or archetype
does not block an assistant turn. Strategy-only edits select only the requested game block, even if shared fields or the other strategy are blank. Other character edits include missing fields in the structured profile writer's selection, including empty game notes; populated unrelated blocks stay unchanged. Guided appearance revisions select visual design, complete missing details and keep populated unrelated character fields. Text-only edits omit image references, including gendered wording corrections to appearance notes. Gender and archetype come
from validated enum fields in its response, never from application parsing of
character prose. A missing archetype is sent as missing rather than silently
replaced with Strategist.

Existing characters missing name, personality, gender or archetype show a
“Fill missing details” action in the Workshop. It completes empty fields from
the existing character with one profile generation, preserving populated
fields and existing images. This action does not save the character.

Save validation and server errors appear beside the Workshop save button,
including when the composer is collapsed. Field errors also remain beside
their inputs, and validation focuses and centers the first invalid field so it
stays above the fixed Workshop. Successful AI completion clears errors for the completed fields;
manual selection clears the corresponding field error. Reference and assistant
failures remain visible in the Workshop, and assistant timeouts preserve typed
text with a readable retry message.

Profile data retains the existing local draft recovery and submission contract.
Conversation history and approval are scoped to the open assistant; restoring
a profile asks for approval again. The assistant never saves or enters a game
on the model's authority; the user uses the final create button.

After guided image generation, the full-screen image editor opens automatically
with both crop and head controls available. Confirmation requires no edits.
The Advanced editor retains its confirmation-first preview; “Adjust framing” opens two explicit
modes: Portrait crop and Head position. Drag the active box to move it and its
44px corner target to resize, with the same pointer controls for touch and mouse.
The portrait remains square in source pixels. Only the active box receives
pointer input, so overlapping boxes do not compete. The source stays visible
while precise keyboard-accessible sliders are open. Export checks that the
entire head fits inside the portrait and keeps the original full-body image.
If the head extends outside the crop, amber stripes mark only the excluded
area. The warning replaces the helper text in a shared reserved space, keeping
the confirmation button and controls stationary.

Validation uses strict-contract and interaction tests, mocked-provider API tests,
and the local identity browser harness. No paid providers or external writes are
needed for these checks. They do not establish live model quality.
