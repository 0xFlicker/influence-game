import type {
  HouseHighlightSceneCard,
  HouseHighlightsResponse,
} from "@/lib/api";

export function sceneForCardImage(
  response: HouseHighlightsResponse,
  sceneId: string,
): HouseHighlightSceneCard | null {
  const decodedSceneId = safeDecode(sceneId);
  return response.highlights.scenes.find((scene) => scene.id === decodedSceneId) ?? null;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
