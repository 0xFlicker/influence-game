import type {SceneFrame} from "@/app/games/[slug]/components/visual-scene-layout";

/** Reserve text space inside the scene, never a strip outside its backdrop. */
export function layoutThought(width: number, height: number, speech: SceneFrame, head: {x: number; y: number}) {
  const margin = 12, gap = 16;
  const available = Math.max(0, height - margin * 2);
  const thoughtHeight = Math.min(170, Math.max(80, available * .4), available * .5);
  const speechHeight = Math.min(speech.height, Math.max(0, available - thoughtHeight - gap));
  // Speech is measured when it appears. That measurement must not move thinking.
  const top = margin;
  const thought = {left: Math.max(margin, Math.min(width - speech.width - margin, speech.left)), top,
    width: Math.max(0, Math.min(speech.width, width - margin * 2)), height: thoughtHeight};
  const bubble = {...speech, top: Math.max(speech.top, top + thoughtHeight + gap), height: speechHeight};
  bubble.top = Math.min(bubble.top, Math.max(margin, height - margin - bubble.height));
  return {thought, speech: bubble, head: {x: Math.max(margin, Math.min(width - margin, head.x)), y: Math.min(height - margin - 24, Math.max(top + thoughtHeight + 24, head.y))}};
}
