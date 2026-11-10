import {createContext} from "react";
import type {PresentationDirector, WatchCue} from "./watch-director";

/** Optional interactive transport owner; offline rendering has no page commands. */
export const WatchPageContext = createContext<Pick<PresentationDirector<WatchCue>, "getActiveCue" | "getSpeechElapsedBaseMs" | "getTimelineElapsedBaseMs" | "registerPages"> | null>(null);
