import type { schema } from "../db/index.js";

type Revision = typeof schema.agentContentRevisions.$inferSelect;
type Review = typeof schema.agentModerationReviews.$inferSelect;
export interface ModerationRevisionState { revision: Revision; review: Review }

/** Pure whole-snapshot selection. Ordering comes only from recorded parentage. */
export function planModerationSelection(input: {
  states: ModerationRevisionState[];
  targetId: string;
  disposition: "allowed" | "rejected";
  latestId: string | null;
  effectiveId: string | null;
}) {
  const states = new Map(input.states.map(s => [s.revision.id, { revision: s.revision, review: { ...s.review } }]));
  const target = states.get(input.targetId);
  if (!target) throw new Error("Moderation target has no immutable revision.");
  const chain = (id: string | null) => {
    const result: string[] = [];
    while (id) {
      if (result.includes(id)) throw new Error("Content revision ancestry contains a cycle.");
      const state = states.get(id);
      if (!state) throw new Error("Content revision ancestry is incomplete.");
      result.push(id);
      id = state.revision.parentRevisionId;
    }
    return result;
  };
  const rejected = input.disposition === "rejected" && target.review.disposition !== "rejected";
  const unknownAncestry = rejected && input.states.some(s => !s.revision.ancestryKnown);
  const heldIds: string[] = [];
  if (rejected) {
    for (const [id, state] of states) {
      if (id !== input.targetId && (unknownAncestry || chain(id).slice(1).includes(input.targetId))) {
        state.review.held = true;
        heldIds.push(id);
      }
    }
  }
  target.review.disposition = input.disposition;
  // An explicit decision reviews the entire target snapshot, including an inherited hold.
  target.review.held = false;
  const eligible = (id: string) => {
    const review = states.get(id)?.review;
    return review?.disposition === "allowed" && !review.held;
  };
  const latestChain = chain(input.latestId);
  let effectiveId = latestChain.find(eligible) ?? null;
  // Unknown legacy histories have no invented ordering. Keep a permitted current
  // selection; an explicitly restored target is only a fallback, never a rollback.
  if (!effectiveId && input.effectiveId && eligible(input.effectiveId)) effectiveId = input.effectiveId;
  if (!effectiveId && eligible(input.targetId)) effectiveId = input.targetId;
  return { effectiveId, heldIds: heldIds.sort(), unknownAncestry, states: [...states.values()] };
}
