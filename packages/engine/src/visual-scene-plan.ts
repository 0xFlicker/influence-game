import { VISUAL_ROOMS, type PerformanceCue, type VisualRoomId } from "./visual-mode";

export interface VisualCastMember {
  id: string;
  name: string;
  /** Frozen, content-addressed reference for this game, not a mutable profile URL. */
  referenceArtifactId: string;
  /** Explicit preparation outcome; identical image hashes do not imply degraded quality. */
  portraitFallback?: boolean;
  performanceInstructions: string;
}
export interface VisualPlacement {
  playerId: string;
  sectionId: string;
  position: string;
  role: "participant" | "addressing" | "finalist" | "juror";
}
export interface VisualScenePlan {
  version: 1;
  roomId: VisualRoomId;
  roomVersion: number;
  backgroundArtifactId: string | null;
  cast: readonly VisualCastMember[];
  placements: readonly VisualPlacement[];
  /** House-held grouping facts only. Never extracted from transcript prose. */
  allianceGroups: readonly (readonly string[])[];
  cues: readonly { playerId: string; cue: PerformanceCue }[];
}

/** Deterministic staging. The inventory suggests furniture-relative positions, not room capacity. */
export function planVisualScene(input: {
  roomId: VisualRoomId;
  backgroundArtifactId: string | null;
  cast: readonly VisualCastMember[];
  allianceGroups?: readonly (readonly string[])[];
  roles?: Readonly<Record<string, VisualPlacement["role"]>>;
  previous?: VisualScenePlan;
  cues?: VisualScenePlan["cues"];
}): VisualScenePlan {
  const room = VISUAL_ROOMS[input.roomId];
  if (!room || (input.backgroundArtifactId !== null && !input.backgroundArtifactId.trim())) throw new Error("Visual scene requires a versioned room background");
  const ids = new Set(input.cast.map((member) => member.id));
  if (ids.size !== input.cast.length || input.cast.some((member) => !member.id.trim() || !member.name.trim() || !member.referenceArtifactId.trim())) throw new Error("Visual cast needs unique identities and frozen references");
  const groups: string[][] = [];
  const grouped = new Set<string>();
  for (const group of input.allianceGroups ?? []) {
    const members = group.filter((id) => ids.has(id) && !grouped.has(id));
    const unique = [...new Set(members)];
    unique.forEach((id) => grouped.add(id));
    if (unique.length) groups.push(unique);
  }
  // Canonical caller order resolves ties and gives unaffiliated players a stable position.
  const order = [...groups.flat(), ...input.cast.map((member) => member.id).filter((id) => !grouped.has(id))];
  const placements = new Map<string, VisualPlacement>();
  const occupied = new Set<string>();
  const slotKey = (sectionId: string, position: string) => JSON.stringify([sectionId, position]);
  const roleFor = (id: string) => input.roles?.[id] ?? "participant";
  const sectionForRole = (role: VisualPlacement["role"]) => {
    if (input.roomId === "tribunal") return role === "addressing" ? ["address"] : ["listeners"];
    if (input.roomId === "finals") return role === "finalist" ? ["finalists"] : ["jury-left", "jury-right"];
    return room.sections.map((section) => section.id);
  };
  const previous = input.previous;
  if (previous?.roomId === room.id && previous.roomVersion === room.version && previous.backgroundArtifactId === input.backgroundArtifactId) {
    for (const placement of previous.placements) {
      const key = slotKey(placement.sectionId, placement.position);
      if (!ids.has(placement.playerId) || occupied.has(key) || placements.has(placement.playerId)
        || !sectionForRole(roleFor(placement.playerId)).includes(placement.sectionId)) continue;
      placements.set(placement.playerId, { ...placement, role: roleFor(placement.playerId) });
      occupied.add(key);
    }
  }
  for (const id of order) {
    if (placements.has(id)) continue;
    const role = roleFor(id);
    const sections = room.sections.filter((section) => sectionForRole(role).includes(section.id));
    const group = groups.find((members) => members.includes(id));
    const allySection = group?.map((ally) => placements.get(ally)?.sectionId).find(Boolean);
    const preferred = [...sections].sort((a, b) => Number(b.id === allySection) - Number(a.id === allySection));
    let selected: VisualPlacement | undefined;
    for (const section of preferred) {
      const position = section.positions.find((position) => !occupied.has(slotKey(section.id, position)));
      if (position) { selected = { playerId: id, sectionId: section.id, position, role }; break; }
    }
    // Overflow adds staging space, never rejects a legal game room assignment.
    if (!selected) {
      const section = preferred[0]!;
      let index = 1;
      while (occupied.has(slotKey(section.id, `additional standing position ${index}`))) index += 1;
      selected = { playerId: id, sectionId: section.id, position: `additional standing position ${index}`, role };
    }
    occupied.add(slotKey(selected.sectionId, selected.position));
    placements.set(id, selected);
  }
  return {
    version: 1, roomId: room.id, roomVersion: room.version, backgroundArtifactId: input.backgroundArtifactId,
    cast: input.cast.map((member) => ({ ...member })), placements: input.cast.map((member) => placements.get(member.id)!),
    allianceGroups: groups,
    cues: (input.cues ?? []).filter((cue) => ids.has(cue.playerId)).map((entry) => ({ playerId: entry.playerId, cue: entry.cue })),
  };
}

/** Cues inform the next necessary render but cannot make a scene dirty themselves. */
export function sameVisualArrangement(left: VisualScenePlan, right: VisualScenePlan): boolean {
  const normalized = (plan: VisualScenePlan) => JSON.stringify({
    roomId: plan.roomId, roomVersion: plan.roomVersion, backgroundArtifactId: plan.backgroundArtifactId,
    cast: [...plan.cast].sort((a, b) => a.id.localeCompare(b.id))
      .map((member) => [member.id, member.name, member.referenceArtifactId, member.performanceInstructions]),
    placements: [...plan.placements].sort((a, b) => a.playerId.localeCompare(b.playerId))
      .map((placement) => [placement.playerId, placement.sectionId, placement.position, placement.role]),
  });
  return normalized(left) === normalized(right);
}

/** At most four character references plus the common room image per edit. */
export function visualRenderGroups(plan: VisualScenePlan): VisualPlacement[][] {
  if (plan.cast.length <= 4) return plan.cast.length ? [[...plan.placements]] : [];
  const result: VisualPlacement[][] = [];
  for (const section of VISUAL_ROOMS[plan.roomId].sections) {
    const members = plan.placements.filter((placement) => placement.sectionId === section.id);
    for (let index = 0; index < members.length; index += 4) result.push(members.slice(index, index + 4));
  }
  return result;
}
