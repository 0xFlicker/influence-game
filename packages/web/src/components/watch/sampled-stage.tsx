import { createContext, useContext, type ReactNode } from "react";
import type { AcceptedVisualScene } from "@influence/engine/visual-mode";

export interface SampledStage {
  pages?: Record<string, string[]>;
  capturePages?: (key: string, pages: string[]) => void;
  layouts?: Record<string, import("./bubble-typography").BubbleTypography>;
  captureLayout?: (
    key: string,
    value: import("./bubble-typography").BubbleTypography,
  ) => void;
  images: Record<string, { width: number; height: number }>;
  previousScene: AcceptedVisualScene | null;
  previousSpeaker: string | null;
  firstInScene: boolean;
  speech?: {
    text: string;
    elapsedMs: number;
    alignment: import("./speech-alignment").AlignedSpan[];
  };
}
const SampledStageContext = createContext<SampledStage | null>(null);
/** An offline traversal supplies its predecessor instead of relying on render history. */
export function SampledStageProvider({
  value,
  children,
}: {
  value: SampledStage;
  children: ReactNode;
}) {
  return (
    <SampledStageContext.Provider value={value}>
      {children}
    </SampledStageContext.Provider>
  );
}
export const useSampledStage = () => useContext(SampledStageContext);
