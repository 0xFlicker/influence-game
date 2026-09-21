import { Phase } from "./types";

export type VisualRoomId = "lobby" | "mingle-1" | "mingle-2" | "mingle-3" | "mingle-4" | "mingle-5" | "tribunal" | "finals";
export interface VisualRoomDefinition {
  id: VisualRoomId;
  version: 1;
  name: string;
  direction: string;
  sections: readonly { id: string; furniture: string; positions: readonly string[] }[];
}
const room = (id: VisualRoomId, name: string, direction: string, sections: VisualRoomDefinition["sections"]): VisualRoomDefinition => ({ id, version: 1, name, direction, sections });
const seating = (id: string, furniture: string) => ({ id, furniture, positions: ["left seat", "center seat", "right seat", "foreground chair", "standing left", "standing right"] });

/** Stable art direction and reusable staging inventory; never a gameplay capacity limit. */
export const VISUAL_ROOMS: Readonly<Record<VisualRoomId, VisualRoomDefinition>> = {
  lobby: room("lobby", "Lobby", "Warm ivory plaster, oak floor, rust couch, cream chairs, pale kitchen bar and dark garden windows.", [
    seating("couch", "rust couch and two cream chairs"),
    { id: "bar", furniture: "pale kitchen counter and three oak stools", positions: ["left stool", "middle stool", "right stool", "behind counter left", "behind counter right", "standing beside counter"] },
    seating("window", "green window bench and cream chairs"),
  ]),
  "mingle-1": room("mingle-1", "Garden nook", "Muted green upholstery, pale stone and garden windows. Quiet, intimate daylight softened by warm lamps.", [seating("garden", "green bench and pale armchairs")]),
  "mingle-2": room("mingle-2", "Kitchen corner", "Terracotta accents, oak cabinetry, pale counter and warm pendant lights. A lived-in but uncluttered kitchen.", [
    { id: "kitchen", furniture: "pale counter and stools", positions: ["left stool", "middle stool", "right stool", "behind counter left", "behind counter right", "standing beside counter"] },
  ]),
  "mingle-3": room("mingle-3", "Reading lounge", "Muted blue upholstery, dark wood and sparse shelving. Warm reading lamps, no busy wall of books.", [seating("reading", "blue couch and dark wood armchairs")]),
  "mingle-4": room("mingle-4", "Music room", "Ochre upholstery, warm wood and one upright piano as a background landmark. Soft architectural lighting.", [seating("music", "ochre settee and wood-framed chairs")]),
  "mingle-5": room("mingle-5", "Den", "Muted plum upholstery, warm grey plaster and walnut furniture. A low coffee table, simple wall sconces and soft warm lighting; intimate and uncluttered.", [seating("den", "plum sofa, walnut-framed armchairs and a low coffee table")]),
  tribunal: room("tribunal", "Tribunal", "Charcoal walls, dark wood and restrained overhead lighting. A tense contemporary house setting, never a courtroom.", [
    seating("address", "separate chairs for the person addressing the room and the responding player"),
    seating("listeners", "dark upholstered listener benches"),
  ]),
  finals: room("finals", "Finals", "Pale stone, warm brass, symmetrical staging and brighter focused lighting. Ceremonial without trophies or podiums.", [
    seating("finalists", "distinct finalist armchairs"),
    seating("jury-left", "left jury bench facing finalists"),
    seating("jury-right", "right jury bench facing finalists"),
  ]),
};

export const VISUAL_HOUSE_STYLE = "Contemporary social-strategy house, photorealistic, simple architectural forms, warm lighting, recognizable furniture, minimal clutter, believable conversation staging. Stable materials and camera; no text or watermarks.";

export function mingleVisualRoom(roomId: number): VisualRoomId {
  if (!Number.isInteger(roomId) || roomId < 1 || roomId > 5) throw new Error("Visual Mingle room must be 1 through 5");
  return `mingle-${roomId}` as VisualRoomId;
}

/** Explicit phase mapping; procedural phases and individual addresses never create room images. */
export function visualRoomForPhase(phase: Phase, roomId?: number, endgameStage?: "reckoning" | "tribunal" | "judgment"): VisualRoomId | null {
  switch (phase) {
    case Phase.LOBBY: return endgameStage === "tribunal" ? "tribunal" : endgameStage === "judgment" ? "finals" : "lobby";
    case Phase.MINGLE:
    case Phase.MINGLE_I:
    case Phase.POST_VOTE_MINGLE:
    case Phase.FORMAT_MINGLE:
      if (roomId === undefined) throw new Error("Visual Mingle context requires an explicit room");
      return mingleVisualRoom(roomId);
    case Phase.ACCUSATION:
    case Phase.DEFENSE: return "tribunal";
    case Phase.OPENING_STATEMENTS:
    case Phase.JURY_QUESTIONS:
    case Phase.CLOSING_ARGUMENTS: return "finals";
    default: return null;
  }
}

export interface PerformanceCue {
  behavior: string;
  delivery: string;
  intendedAction: string;
}

export interface VisualPlayerAnchor {
  playerId: string;
  label: number;
  /** Normalized final-image coordinates, never intended staging coordinates. */
  head: { x: number; y: number; width: number; height: number };
  confidence: "clear" | "uncertain";
}

export interface AcceptedVisualScene {
  id: string;
  roomId: VisualRoomId;
  version: number;
  imageUrl: string;
  annotatedImageUrl: string;
  participantIds: readonly string[];
  anchors: readonly VisualPlayerAnchor[];
}

export interface ScenePerformanceCue {
  sceneId: string;
  playerId: string;
  turnId: string;
  cue: PerformanceCue;
}

export interface AgentVisualContext {
  scene: AcceptedVisualScene;
  cues: readonly ScenePerformanceCue[];
}

/** Do not accept partial identity localization for a scene given to agents. */
export function assertVisualAnchors(anchors: readonly VisualPlayerAnchor[], playerIds: readonly string[]): void {
  if (new Set(playerIds).size !== playerIds.length) throw new Error("Duplicate scene participant");
  if (anchors.length !== playerIds.length || new Set(anchors.map((anchor) => anchor.playerId)).size !== playerIds.length) throw new Error("Scene localization must identify every participant exactly once");
  const labels = new Set<number>();
  for (const anchor of anchors) {
    if (!playerIds.includes(anchor.playerId) || anchor.confidence !== "clear") throw new Error("Unverified scene identity");
    if (!Number.isInteger(anchor.label) || anchor.label < 1 || labels.has(anchor.label)) throw new Error("Invalid scene label");
    labels.add(anchor.label);
    const { x, y, width, height } = anchor.head;
    if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) throw new Error("Head bounds lie outside the scene");
  }
}

/** Rebuild room-local cue context from accepted structured records, never from dialogue. */
export function latestSceneCues(scene: AcceptedVisualScene, records: readonly ScenePerformanceCue[]): ScenePerformanceCue[] {
  const latest = new Map<string, ScenePerformanceCue>();
  for (const record of records) {
    if (record.sceneId === scene.id && scene.participantIds.includes(record.playerId)) latest.set(record.playerId, record);
  }
  return [...latest.values()];
}
