# Retrospective knowledge and hindsight

Retrospectives remain group-shareable speech only. The exact response is still `{ speech }`; no private-thinking, rationale, or evidence-reference output was added.

The revised prompt invites one or two concrete moments rather than requiring a full recap, success, failure, and lesson in every statement. It distinguishes information and beliefs at the time from postgame revelations, treats earlier statements as claims rather than factual authority, and discourages invented mistakes or motives. Character voice, roasting, and responses to earlier statements remain welcome.

Each Werewolf speaker receives a deterministic personal reference derived from canonical events: starting role/faction, original pack membership when applicable, dated investigation results available before elimination, named own ballots/night choices, fallback markers, and elimination sequence. A check resolving on the Seer's death night remains in the full revealed account but is excluded from information usable for another gameplay decision. No provider thinking or reconstructed motive supplies this reference.

The shared frozen game account, its input hash, historical accepted speeches, and speech schema are unchanged. The reference belongs to the speaker context and is detached by the existing snapshot path. Public replay/API/MCP continue consuming accepted speech.

## Evidence

- Provider-free checks: 2,737 passed, five skipped, zero failed.
- Focused context, recovery, and invocation checks: 50 passed. After final prompt/type wording, 29 focused perspective/invocation checks passed again.
- Workspace typechecking and lint passed; `git diff --check` passed.
- PostgreSQL baseline: 2,086 passed, zero failed.
- Recompiling the three saved API games (`lean-amber-cloud`, `calm-khaki-lake`, `lean-mint-stone`) preserves their original frozen-input hashes. Jace's new reference shows both day ballots against Vera and distinguishes them from his investigation of Mira. Orion's reference identifies a villager with no private investigations and a ballot against Rex.

No paid inference was run for this change. Saved-game inspection verifies source accuracy, not improved generated retrospective quality. Future API games must still be assessed for false memories, hindsight presented as prior knowledge, repetitive phrasing, and character voice.
