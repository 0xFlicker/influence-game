import { describe, test, expect } from "bun:test";
import OpenAI from "openai";
import { createProviderAdapter } from "../provider-adapters";
import { modelCatalogEntryById } from "../model-catalog";
import type { LlmProviderRuntime } from "../llm-client";
import { werewolfConfig, startWerewolf, nextWerewolfStep, applyWerewolfEvent, replayWerewolf, werewolfEvent, werewolfActionPlans } from "../werewolf/rules";
import { observeWerewolf, projectWerewolfView } from "../werewolf/observation";
import { projectWerewolfWatch } from "../werewolf/watch";
import { werewolfDecisionArtifact, WerewolfModelAgent } from "../werewolf/agent";
import { werewolfRoleCoaching } from "../werewolf/strategy";
import { exactStructuredOutputRegistry } from "../structured-output";
import { runWerewolf, advanceWerewolf, werewolfFallback, type WerewolfAgent } from "../werewolf/runner";
import { fixtureRetrospectiveCapacity, fixtureWerewolfRetrospective } from "../fixtures/retrospective-agent";
import type { WerewolfDecision, WerewolfEvent, WerewolfState } from "../werewolf/types";

function setup(two = false, bytesPerLivingPlayer = 400) {
  const config = werewolfConfig(two ? "two_wolves" : "one_wolf", 10);
  config.discussionPolicy!.bytesPerLivingPlayer = bytesPerLivingPlayer;
  const players = Array.from({ length: two ? 8 : 6 }, (_, i) => ({ id: `p${i}`, name: `Player ${i}`, personality: "Curious", backstory: "", strategy: "Reason carefully", avatarUrl: null }));
  const events = [startWerewolf("v9-test", players, config, "v9-seed")];
  const state = () => replayWerewolf(events);
  const store = { read: async () => structuredClone(events), append: async (event: WerewolfEvent) => { applyWerewolfEvent(state(), event); events.push(event); } };
  function accept(decision?: WerewolfDecision, unavailable = false) {
    const s = state(), step = nextWerewolfStep(s);
    if (step.kind === "complete") return s;
    const event = step.kind === "event" ? werewolfEvent(s, step.event) : werewolfEvent(s, { type: "werewolf.action_accepted", payload: { ...step.request,
      decision: decision ?? normal(s), fallback: unavailable ? "provider_unavailable" : null } });
    events.push(event); return state();
  }
  function until(predicate: (s: WerewolfState) => boolean) {
    for (let i = 0; i < 2000; i++) { const s = state(); if (predicate(s)) return s; accept(); }
    throw new Error("Did not reach boundary");
  }
  return { config, players, events, state, store, accept, until };
}
function normal(state: WerewolfState): WerewolfDecision {
  const step = nextWerewolfStep(state); if (step.kind !== "action") throw new Error("Expected action");
  const r = step.request;
  if (r.action === "pack_propose") return { kind: "spoken_target", targetId: r.legalTargetIds[0]!, text: "That target.", cue: null, thinking: "Agreed" };
  if (r.action === "public_vote") return ballot(null);
  return werewolfFallback(state, r);
}
const say = (text: string | null, recipientId: string | null = null, replyToContributionId: number | null = null): WerewolfDecision => ({ kind: "conversation", text, cue: null, recipientId, replyToContributionId });
const ballot = (targetId: string | null): WerewolfDecision => ({ kind: "spoken_target", targetId, text: "My choice.", cue: null, thinking: "Considered previous votes" });

describe("Werewolf v9", () => {
  test("player observations hide passes, scheduler bookkeeping and reference gaps without rewriting evidence", () => {
    const c = setup(); c.until(s => s.phase === "day");
    c.accept(say("First public statement."));
    const before = c.state();
    const passer = before.conversation!.nextActorId;
    const after = c.accept(say(null));
    // A pass alone changes no player-facing facts, even for its author.
    for (const actor of after.aliveIds) expect(observeWerewolf(after, actor)).toEqual(observeWerewolf(before, actor));
    expect(after.history.at(-1)).toMatchObject({kind: "conversation", actorId: passer, text: null, id: 2});
    c.accept(say(null), true);
    const state = c.accept(say("Second public statement.", null, 1));
    const observation = observeWerewolf(state, state.aliveIds[0]!);
    expect(observation.board.entries.filter(e => e.kind === "conversation")).toMatchObject([
      {id: 1, text: "First public statement."}, {id: 2, text: "Second public statement.", replyToContributionId: 1},
    ]);
    expect(Object.keys(observation.board.conversation!).sort()).toEqual(["finalRecipientMustRedirect", "messageBytes", "mustRedirect", "remainingBytes", "totalBytes"]);
    expect(observation.board.cursor).toBe(observation.board.entries.length);
    expect(state.history.filter(e => e.kind === "conversation")).toHaveLength(4);
    const turn = nextWerewolfStep(state);
    if (turn.kind !== "action" || turn.request.action !== "conversation") throw new Error("Missing conversation");
    const artifact = werewolfDecisionArtifact(turn.request, new Map([[1,1],[2,4]]));
    expect(artifact.schema).toMatchObject({properties: {replyToContributionId: {enum: [1,2,null]}}});
    const response = {text: "I challenge that second statement.", cue: null, recipientId: null, replyToContributionId: 2, thinking: "A useful correction."};
    const decoded = artifact.decodeProviderPayload(response);
    expect(decoded).toMatchObject({status: "valid", value: {...response, kind: "conversation", replyToContributionId: 4}});
    if (decoded.status !== "valid") throw new Error("Invalid fixture");
    expect(artifact.decodeAcceptedValue(decoded.value)).toEqual(decoded);
    expect(artifact.decodeProviderPayload({...response, replyToContributionId: 3}).status).toBe("invalid");
  });
  test("directed exchanges end in redirection but retain earlier references", () => {
    const c = setup(); let s = c.until(s => s.phase === "day");
    const a = s.conversation!.nextActorId, b = s.aliveIds.find(id => id !== a)!;
    s = c.accept(say("Question?", b)); expect(s.conversation!.nextActorId).toBe(b);
    s = c.accept(say("Answer.", a, 1)); expect(s.conversation!.nextActorId).toBe(a);
    s = c.accept(say("Closing point.", b, 2)); expect(s.conversation!.nextActorId).toBe(b);
    const step = nextWerewolfStep(s); if (step.kind !== "action" || step.request.action !== "conversation") throw new Error("Missing redirect");
    expect(step.request.legalRecipientIds).not.toContain(a); expect(step.request.legalReplyIds).toContain(3);
    expect(() => c.accept(say("Again?", a))).toThrow();
    const other = step.request.legalRecipientIds[0]!;
    s = c.accept(say("Room, consider that earlier claim.", other, 3));
    expect(s.conversation!.handoffsUsed).toBe(0);
    expect(s.conversation!.nextActorId).toBe(s.conversation!.order.find(id => id !== a && id !== b)!);
  });
  test("UTF-8 budget stops before a tiny remainder and does not invent missing passes", () => {
    const c = setup(); let s = c.until(s => s.phase === "day");
    const total = s.conversation!.totalBytes;
    while (!s.conversation!.ended) s = c.accept(say("é".repeat(150)));
    expect(s.conversation!.remainingBytes).toBe(total % 300);
    expect(s.conversation!.endReason).toBe("output_budget");
    expect(s.history.filter(e => e.kind === "conversation").every(e => e.kind !== "conversation" || e.text !== null)).toBe(true);
    expect(nextWerewolfStep(s)).toMatchObject({ kind: "event", event: { type: "werewolf.phase_started", payload: { phase: "vote" } } });
  });
  test("conversation prompts expose voting space and explain both sides of the final redirect", async () => {
    const c = setup(); const s = c.until(s => s.phase === "day");
    const step = nextWerewolfStep(s); if (step.kind !== "action" || step.request.action !== "conversation") throw new Error("No conversation turn");
    let sent: Record<string, unknown> | undefined;
    let completionLimit: number | undefined;
    let systemPrompt = "";
    const client = new OpenAI({ apiKey: "fixture", baseURL: "http://fixture.invalid/v1", maxRetries: 0, fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      sent = JSON.parse(body.messages.at(-1).content);
      completionLimit = body.max_tokens;
      systemPrompt = body.messages[0].content;
      const request = sent!.request as {action: string};
      return Response.json({ id: "allowance-prompt", object: "chat.completion", created: 0, model: "glm-5-2",
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(request.action === "public_vote"
            ? {text: null, cue: null, targetId: null, thinking: "No elimination target."}
            : {text: null, cue: null, recipientId: null, replyToContributionId: null, thinking: "Wait for useful information"}) } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
    } });
    const entry = modelCatalogEntryById("katana:glm-5-2")!;
    const runtime: LlmProviderRuntime = { adapter: createProviderAdapter("katana", client), catalogId: entry.id, providerProfileId: "katana", modelId: entry.modelId,
      modelCapabilities: entry.capabilities, reasoningPolicy: "medium",  position: 0, role: "primary" };
    const agent = new WerewolfModelAgent({ runtimes: [runtime] });
    const decide = async (state: WerewolfState) => {
      const turn = nextWerewolfStep(state);
      if (turn.kind !== "action") throw new Error("Missing conversation opportunity");
      await agent.decide({ gameId: state.gameId, actionSlot: state.sequence + 1,
        request: turn.request, observation: observeWerewolf(state, turn.request.actorId) });
    };
    await decide(s);
    expect(completionLimit).toBe(8192);
    expect(sent?.actingPlayer).toMatchObject({id: step.request.actorId, name: s.players.find(p => p.id === step.request.actorId)!.name});
    expect(systemPrompt).toContain("All text is spoken to the turn's audience");
    expect(systemPrompt).toContain("discloses a Seer claim");
    expect(sent?.instruction).toContain("A previously unstated evaluation of an existing argument");
    expect(sent?.instruction).toContain("Being offered the floor, including a named handoff, does not require speech");
    expect(sent?.instruction).toContain("If you would only agree, repeat an unchanged suspicion or promise, or say that evidence is missing, return null text");
    const budget = (sent?.conversationTurn as { budget: Record<string, unknown> }).budget;
    expect(budget).toMatchObject({ votingAllowanceBytes: s.aliveIds.length * step.request.messageBytes,
      votingMessageBytes: step.request.messageBytes, unit: "UTF-8 bytes" });
    const a = step.request.actorId, b = step.request.legalRecipientIds[0]!;
    c.accept(say("What do you think?", b));
    await decide(c.accept(say("I suspect the quiet player.", a)));
    expect(sent?.instruction).toContain("If you speak, close your point; do not ask them a new question");
    await decide(c.accept(say("That is my final point.", b)));
    expect(sent?.instruction).toContain(`Do not address ${s.players.find(player => player.id === a)!.name}`);
    expect(sent?.instruction).toContain("You may reference earlier statements including theirs");
    expect(sent?.instruction).toContain("If you speak: Do not address");
    expect(sent?.instruction).toContain("Passing is equally valid");
    expect(sent?.instruction).toContain("The remaining budget is a ceiling, not a target");
    c.accept(say(null));
    await decide(c.accept(say("A new public point.", null, 3)));
    expect(sent).toMatchObject({request: {legalReplyIds: [1,2,3,4]}, observation: {board: {conversation: {
      mustRedirect: false, finalRecipientMustRedirect: false,
    }}}});
    // Each role receives its own strategic coaching through the current prompt path.
    for (const role of ["villager", "seer", "doctor", "werewolf"] as const) {
      const actorId = step.request.actorId;
      const roleState = { ...s, roles: { ...s.roles, [actorId]: role } };
      await decide(roleState);
      expect(sent?.roleCoaching).toBe(werewolfRoleCoaching(role));
      expect(sent?.roleCoaching).toContain(role === "werewolf" ? "You play for the wolves" : "You play for the village");
      expect(sent?.roleCoaching).not.toContain(role === "werewolf" ? "consider preserving their information" : "You may bluff a role or investigation");
    }
    // Restore the reference-gap fixture before checking the visible history.
    await decide(c.state());
    const serialized = JSON.stringify(sent);
    for (const field of ["silentIds", "unavailableIds", "lastOffered", "offers", "nextActorId", "previousSpeakerId", "handoffsUsed", "endReason", "handoffsRemaining"]) expect(serialized).not.toContain(`"${field}"`);
    const board = (sent!.observation as ReturnType<typeof observeWerewolf>).board;
    expect(board.entries.filter(e => e.kind === "conversation").map(e => e.id)).toEqual([1,2,3,4]);
    expect(board.entries.at(-1)).toMatchObject({id: 4, replyToContributionId: 3});
    c.until(state => state.phase === "vote");
    const voted = c.accept(ballot(null));
    await decide(voted);
    expect(sent?.instruction).toContain("player you want ELIMINATED");
    expect(sent?.instruction).toContain("never endorsement");
    expect(sent?.instruction).not.toContain("wolves may eliminate a genuine Seer");
    expect(sent?.instruction).toContain("No role claim makes a legal target immune");
    const previousBallot = voted.history.find(e => e.kind === "ballot");
    if (!previousBallot || previousBallot.kind !== "ballot") throw new Error("Missing fixture ballot");
    expect(sent?.vote).toMatchObject({ballots: [{voter: {id: previousBallot.actorId, name: voted.players.find(p => p.id === previousBallot.actorId)!.name}, eliminate: null}]});
    const voteStep = nextWerewolfStep(voted);
    if (voteStep.kind !== "action") throw new Error("Missing vote");
    expect(werewolfDecisionArtifact(voteStep.request).schema).toMatchObject({properties: {targetId: {description: expect.stringContaining("want ELIMINATED")}}});
  });
  test("exactly one message allowance permits a turn, then closes before a promised reply", () => {
    const c = setup(false, 64); const s = c.until(s => s.phase === "day");
    expect(s.aliveIds).toHaveLength(5);
    expect(s.conversation!.remainingBytes).toBe(320);
    const next = nextWerewolfStep(s); if (next.kind !== "action" || next.request.action !== "conversation") throw new Error("Missing turn");
    const after = c.accept(say("x".repeat(320), next.request.legalRecipientIds[0]!));
    expect(after.conversation).toMatchObject({ remainingBytes: 0, ended: true, offers: 1, endReason: "output_budget" });
    expect(Object.keys(after.conversation!.lastOffered)).toHaveLength(1);
    expect(nextWerewolfStep(after)).toMatchObject({ kind: "event", event: { type: "werewolf.phase_started", payload: { phase: "vote" } } });
  });
  test("passes close one silent sweep; unavailable and intentional silence stay distinct", () => {
    const c = setup(); let s = c.until(s => s.phase === "day");
    const total = s.conversation!.remainingBytes;
    s = c.accept(say(null), true);
    while (!s.conversation!.ended) s = c.accept(say(null));
    expect(s.conversation!.endReason).toBe("unavailable_sweep"); expect(s.conversation!.remainingBytes).toBe(total);
    expect(s.history.filter(e => e.kind === "conversation")).toHaveLength(s.aliveIds.length);
  });
  test("one continuing speaker prevents a silent sweep while other players pass", () => {
    const c = setup(false, 80); let s = c.until(s => s.phase === "day");
    const speakerId = s.conversation!.nextActorId;
    for (let offers = 0; !s.conversation!.ended && offers < 100; offers++) {
      s = c.accept(say(s.conversation!.nextActorId === speakerId ? "One point." : null));
    }
    const turns = s.history.filter(e => e.kind === "conversation");
    expect(s.conversation).toMatchObject({ ended: true, endReason: "output_budget", remainingBytes: 310 });
    expect(turns.filter(e => e.text !== null)).toHaveLength(9);
    // A byte cap bounds output, not provider call count: four passes separate each short contribution.
    expect(turns).toHaveLength(41);
  });
  test("serial ballot observations reveal previous speech/choices; one vote cannot eliminate", () => {
    const c = setup(); let s = c.until(s => s.phase === "vote");
    expect(werewolfActionPlans(s)).toHaveLength(1);
    const target = s.aliveIds.find(id => id !== s.conversation!.voterIds[0])!;
    s = c.accept(ballot(target));
    const next = nextWerewolfStep(s); if (next.kind !== "action") throw new Error("Missing vote");
    const observation = observeWerewolf(s, next.request.actorId);
    expect(observation.board.entries.at(-1)).toMatchObject({ kind: "ballot", targetId: target, text: "My choice." });
    while (nextWerewolfStep(s).kind === "action") s = c.accept(ballot(null));
    s = c.accept();
    expect(s.history.at(-1)).toMatchObject({ kind: "vote", result: { eliminatedId: null, dayEnded: true, voteMode: "majority" } });
  });
  test("strict majority resolves only after every living player gets a vote", () => {
    const c = setup(); let s = c.until(s => s.phase === "vote");
    const target = s.conversation!.voterIds.at(-1)!;
    for (let i = 0; i < s.aliveIds.length; i++) {
      s = c.accept(ballot(s.conversation!.voterIds[i] === target ? null : target));
      expect(s.aliveIds).toContain(target);
    }
    s = c.accept(); expect(s.aliveIds).not.toContain(target);
  });
  test("pack proposals agree after first exchange and stay private from Mystery", () => {
    const c = setup(true); let s = c.until(s => s.phase === "pack");
    const before = projectWerewolfView(s, "mystery");
    s = c.accept();
    expect(projectWerewolfView(s, "mystery")).toEqual(before);
    const step = nextWerewolfStep(s); if (step.kind !== "action") throw new Error("Partner");
    expect(observeWerewolf(s, step.request.actorId).packProposals).toHaveLength(1);
    s = c.accept(); expect(nextWerewolfStep(s)).toMatchObject({ kind: "event", event: { type: "werewolf.pack_vote_resolved", payload: { endReason: "agreed" } } });
    expect(s.actions).toHaveLength(2);
  });
  test("prior-night proposals are absent from the new pack observation", () => {
    const c = setup(true);
    let s = c.until(s => s.phase === "pack");
    s = c.accept(); s = c.accept(); s = c.accept();
    s = c.until(s => s.phase === "pack" && s.day > 1);
    const wolf = nextWerewolfStep(s); if (wolf.kind !== "action") throw new Error("Missing new-night proposal");
    expect(s.history.some(entry => entry.kind === "proposal" && entry.day < s.day)).toBe(true);
    expect(observeWerewolf(s, wolf.request.actorId).packProposals).toEqual([]);
  });
  test("pack disagreement allows all six beats then no attack, with no extra ballot", () => {
    const c = setup(true); let s = c.until(s => s.phase === "pack");
    for (let i = 0; i < 6; i++) {
      const step = nextWerewolfStep(s); if (step.kind !== "action") throw new Error("Missing beat");
      s = c.accept(ballot(step.request.legalTargetIds[i % 2]!));
    }
    s = c.accept(); expect(s.pack).toMatchObject({ ended: true, targetId: null, attemptsCompleted: 3 });
  });
  test("unavailable pack beat clears its prior standing proposal before any agreement", () => {
    const c = setup(true); let s = c.until(s => s.phase === "pack");
    const first = nextWerewolfStep(s); if (first.kind !== "action") throw new Error("No pack turn");
    const [a, b] = first.request.legalTargetIds;
    s = c.accept(ballot(a!));
    s = c.accept(ballot(b!));
    expect(() => c.accept({ kind: "spoken_target", targetId: a!, text: null, cue: null, thinking: "" }, true)).toThrow("must clear its target");
    s = c.accept({ kind: "spoken_target", targetId: null, text: null, cue: null, thinking: "" }, true);
    s = c.accept(ballot(a!));
    expect(nextWerewolfStep(s).kind).toBe("action");
    s = c.accept(ballot(a!));
    expect(nextWerewolfStep(s)).toMatchObject({ kind: "event", event: { type: "werewolf.pack_vote_resolved", payload: { targetId: a, endReason: "agreed" } } });
  });
  for (const agreementBeat of [3, 4, 5, 6]) test(`pack may accept a standing proposal on beat ${agreementBeat}`, () => {
    const c = setup(true); let s = c.until(s => s.phase === "pack");
    for (let beat = 1; beat <= agreementBeat; beat++) {
      const next = nextWerewolfStep(s); if (next.kind !== "action") throw new Error("Premature agreement");
      const partner = s.actions.findLast(action => action.actorId !== next.request.actorId)?.decision;
      const target = beat === agreementBeat && partner?.kind === "spoken_target" ? partner.targetId : next.request.legalTargetIds[beat % 2]!;
      s = c.accept(ballot(target));
    }
    expect(nextWerewolfStep(s)).toMatchObject({ kind: "event", event: { type: "werewolf.pack_vote_resolved", payload: { endReason: "agreed" } } });
  });
  for (const phase of ["day", "vote", "pack"] as const) test(`malformed ${phase} decisions cannot become accepted speech or partial choices`, () => {
    const c = setup(); const s = c.until(s => s.phase === phase);
    const next = nextWerewolfStep(s); if (next.kind !== "action") throw new Error("No action");
    const artifact = werewolfDecisionArtifact(next.request);
    const valid = { text: "A short point.", cue: null, thinking: "A reason", ...(phase === "day" ? { recipientId: null, replyToContributionId: null } : { targetId: next.request.legalTargetIds[0] }) };
    for (const raw of ["plain prose", "{}", `prefix ${JSON.stringify(valid)}`, `\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``, JSON.stringify({ ...valid, extra: true }), JSON.stringify({ text: "missing fields" }), JSON.stringify({ ...valid, ...(phase === "day" ? { recipientId: "unknown" } : { targetId: "unknown" }) })]) {
      expect(exactStructuredOutputRegistry.decodeJsonDocument(artifact, raw).status).toBe("invalid");
    }
    expect(c.state()).toEqual(s);
  });
  test("schema and byte violations never mutate state and carry exact length feedback", () => {
    const c = setup(); const s = c.until(s => s.phase === "day");
    const step = nextWerewolfStep(s); if (step.kind !== "action") throw new Error("No action");
    const artifact = werewolfDecisionArtifact(step.request);
    const payload = { text: "é".repeat(161), cue: null, recipientId: null, replyToContributionId: null, thinking: "A reason" };
    const invalid = exactStructuredOutputRegistry.decodeJsonDocument(artifact, JSON.stringify(payload));
    expect(invalid).toMatchObject({ status: "invalid", feedback: { measured: 322, allowed: 320, unit: "utf8_bytes" } });
    for (const text of ["plain", "{}", `\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``, JSON.stringify({ ...payload, text: "fine", extra: true }), JSON.stringify({ text: "fine" })]) expect(exactStructuredOutputRegistry.decodeJsonDocument(artifact, text).status).toBe("invalid");
    expect(c.state()).toEqual(s);
  });
  test("UTF-8 speech and UTF-16 cue/thinking limits report their policy units", () => {
    const c = setup(); const s = c.until(s => s.phase === "day");
    const step = nextWerewolfStep(s); if (step.kind !== "action") throw new Error("No action");
    const artifact = werewolfDecisionArtifact(step.request);
    const base = { text: "fine", cue: null, recipientId: null, replyToContributionId: null, thinking: "A reason" };
    expect(exactStructuredOutputRegistry.decodeJsonDocument(artifact, JSON.stringify({ ...base, text: "😀".repeat(81) })))
      .toMatchObject({ status: "invalid", feedback: { field: "text", measured: 324, allowed: 320, unit: "utf8_bytes" } });
    expect(exactStructuredOutputRegistry.decodeJsonDocument(artifact, JSON.stringify({ ...base, cue: "😀".repeat(121) })))
      .toMatchObject({ status: "invalid", feedback: { field: "cue", measured: 242, allowed: 240, unit: "utf16_code_units" } });
    expect(exactStructuredOutputRegistry.decodeJsonDocument(artifact, JSON.stringify({ ...base, thinking: "😀".repeat(1001) })))
      .toMatchObject({ status: "invalid", feedback: { field: "thinking", measured: 2002, allowed: 2000, unit: "utf16_code_units" } });
  });
  test("lone-wolf fallback requires its seeded legal target and replay rejects blank thinking", () => {
    const c = setup(); const s = c.until(s => s.phase === "pack");
    const step = nextWerewolfStep(s); if (step.kind !== "action" || step.request.action !== "pack_propose") throw new Error("No lone-wolf proposal");
    expect(step.request.targetRequired).toBe(true);
    expect(() => c.accept({ kind: "spoken_target", targetId: null, text: null, cue: null, thinking: "" }, true)).toThrow();
    const next = setup(); const state = next.until(s => s.phase === "pack");
    const proposal = nextWerewolfStep(state); if (proposal.kind !== "action") throw new Error("No proposal");
    expect(() => next.accept({ kind: "spoken_target", targetId: proposal.request.legalTargetIds[0]!, text: null, cue: null, thinking: "   " })).toThrow();
    expect(next.state()).toEqual(state);
  });
  test("complete simulation survives replay at every prefix and produces seekable watch history", async () => {
    const c = setup();
    const agent: WerewolfAgent = { prepareRetrospectiveCapacity: fixtureRetrospectiveCapacity, getRetrospectiveStatement: fixtureWerewolfRetrospective, decide: async () => normal(c.state()) };
    const final = await runWerewolf(c.store, agent);
    expect(final.phase).toBe("complete"); expect(final.retrospective?.completedAtEventSequence).not.toBeNull();
    for (let i = 1; i <= c.events.length; i++) expect(() => replayWerewolf(c.events.slice(0, i))).not.toThrow();
    expect(projectWerewolfWatch(c.events, "mystery").latestCursor).toBe(projectWerewolfView(final, "mystery").cursor);
    const again = setup();
    const restarted: WerewolfAgent = { ...agent, decide: async () => normal(again.state()) };
    while (again.state().phase !== "complete") await advanceWerewolf(again.store, restarted);
    expect(again.events).toEqual(c.events);
  });
});
