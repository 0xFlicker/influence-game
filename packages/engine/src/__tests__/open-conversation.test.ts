import { describe, expect, test } from "bun:test";
import { advanceConversation, beginConversation, conversationPrompt, validateConversationState } from "../open-conversation";

const participants = ["a", "b", "c"].map(id => ({id, name: id.toUpperCase()}));
const speech = (recipientId: string | null = null, message = "A useful answer.") => ({message, noReply: false, recipientId});
const pass = {message: null, noReply: true, recipientId: null};
describe("bounded open conversation", () => {
  test("allows A B A B, then directs B away from A while preserving prior references", () => {
    let state = {...beginConversation(["a","b","c"],"seed"),nextActorId:"a"};
    state = advanceConversation(state,"a",speech("b"));
    state = advanceConversation(state,"b",speech("a"));
    expect(conversationPrompt(state,participants,[]).warnFinalHandoff).toBeTrue();
    state = advanceConversation(state,"a",speech("b"));
    const prompt = conversationPrompt(state,participants,[{from:"A",text:"Earlier question"}]);
    expect(prompt).toMatchObject({redirect:true,legalRecipientIds:["c"],messages:[{id:1,from:"A",text:"Earlier question"}]});
    expect(() => advanceConversation(state,"b",speech("a"))).toThrow("recipient");
    state = advanceConversation(state,"b",{...speech("c"),replyToContributionId:1});
    expect(state.nextActorId).toBe("c");
    expect(state.handoffs).toBe(1);
    expect(validateConversationState(state)).toEqual([]);
  });
  test("a redirect schedules the chosen recipient even when someone else has waited longer", () => {
    const ids = ["a", "b", "c", "d"];
    let state = {...beginConversation(ids,"seed"),order:ids,nextActorId:"a"};
    for (const [actor, recipient] of [["a","b"],["b","a"],["a","b"]] as const) {
      state = advanceConversation(state,actor,speech(recipient));
    }
    expect(conversationPrompt(state,ids.map(id=>({id,name:id})),[]).legalRecipientIds).toEqual(["c","d"]);
    // C would win the fair queue; B explicitly chooses D instead.
    state = advanceConversation(state,"b",speech("d"));
    expect(state.nextActorId).toBe("d");
    expect(state.handoffs).toBe(1);
    expect(conversationPrompt(state,ids.map(id=>({id,name:id})),[]).redirect).toBeFalse();
    state = advanceConversation(state,"d",speech("b"));
    state = advanceConversation(state,"b",speech("d"));
    expect(() => advanceConversation(state,"d",speech("b"))).toThrow("recipient");
    expect(validateConversationState(state)).toEqual([]);
  });
  test("changing participants resets the pair limit instead of limiting a chain through the room", () => {
    const ids = ["a", "b", "c", "d"];
    let state = {...beginConversation(ids,"seed"),nextActorId:"a"};
    for (const [actor, recipient] of [["a","b"],["b","c"],["c","d"],["d","a"],["a","c"]] as const) {
      state = advanceConversation(state,actor,speech(recipient));
      expect(state.nextActorId).toBe(recipient);
      expect(state.handoffs).toBe(1);
      expect(conversationPrompt(state,ids.map(id=>({id,name:id})),[]).redirect).toBeFalse();
      expect(validateConversationState(state)).toEqual([]);
    }
  });
  test("a pass or group address at the pair limit returns to the fair queue", () => {
    const ids = ["a", "b", "c", "d"];
    let state = {...beginConversation(ids,"seed"),order:ids,nextActorId:"a"};
    state = advanceConversation(state,"a",speech("b"));
    state = advanceConversation(state,"b",speech("a"));
    state = advanceConversation(state,"a",speech("b"));
    for (const response of [pass, speech()]) {
      const next = advanceConversation(state,"b",response);
      expect(next.nextActorId).toBe("c");
      expect(next.handoffs).toBe(0);
      expect(validateConversationState(next)).toEqual([]);
    }
  });
  test("pairs can alternate without a third-person redirect", () => {
    let state = {...beginConversation(["a","b"],"seed"),nextActorId:"a"};
    for(let i=0;i<8;i++){
      const actor = state.nextActorId;
      expect(conversationPrompt(state,participants.slice(0,2),[]).redirect).toBeFalse();
      state = advanceConversation(state,actor,speech(actor==="a"?"b":"a"));
    }
    expect(state.ended).toBeFalse();
  });
  test("charges exact UTF-8 accepted speech only and does not guarantee an opportunity", () => {
    let state = {...beginConversation(["a","b","c"],"seed",{bytesPerParticipant:110,messageBytes:320,maxHandoffs:3}),nextActorId:"a"};
    expect(() => advanceConversation(state,"a",speech(null,"🐺".repeat(81)))).toThrow("size");
    state=advanceConversation(state,"a",speech(null," 🐺 "));
    expect(state.remainingBytes).toBe(324);
    state=advanceConversation(state,state.nextActorId,speech(null,"hello"));
    expect(state.remainingBytes).toBe(319);
    expect(state.ended).toBeTrue();
    expect(Object.keys(state.lastOffered)).toHaveLength(2);
  });
  test("silence sweep ends the room, accepted speech resets it, unavailable offers remain private", () => {
    let state=beginConversation(["a","b","c"],"seed");
    const initial=structuredClone(state);
    state=advanceConversation(state,state.nextActorId,pass);
    state=advanceConversation(state,state.nextActorId,{...pass,providerAbsence:{kind:"provider_exhausted"}});
    expect(state.remainingBytes).toBe(initial.remainingBytes);
    expect(state.ended).toBeFalse();
    const prompt=conversationPrompt(state,participants,[]);
    expect(JSON.stringify(prompt)).not.toMatch(/silentIds|unavailableIds|offers|lastOffered/);
    state=advanceConversation(state,state.nextActorId,speech());
    expect(state.silentIds).toEqual([]);
    for(let i=0;i<3;i++)state=advanceConversation(state,state.nextActorId,pass);
    expect(state.ended).toBeTrue();
    expect(initial.offers).toBe(0);
    expect(validateConversationState(state)).toEqual([]);
  });
  test("restored scheduler follows the same decisions and rejects corrupt cursors", () => {
    const state=beginConversation(["a","b","c"],"seed");
    expect(advanceConversation(state,state.nextActorId,speech())).toEqual(advanceConversation(JSON.parse(JSON.stringify(state)),state.nextActorId,speech()));
    expect(validateConversationState({...state,nextActorId:"outsider"})).not.toEqual([]);
    expect(validateConversationState({...state,remainingBytes:0})).not.toEqual([]);
  });
});
