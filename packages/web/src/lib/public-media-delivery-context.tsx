"use client";

import { createContext, useContext, useMemo } from "react";
import { configuredPublicMediaDelivery, type PublicMediaDelivery } from "./public-media-delivery";

// Undefined means an isolated renderer/test outside the site provider. Null is
// an explicit legacy configuration and must not inherit another environment.
export const PublicMediaDeliveryContext = createContext<PublicMediaDelivery | null | undefined>(undefined);

export function usePublicMediaDelivery(): PublicMediaDelivery | null | undefined {
  const selected = useContext(PublicMediaDeliveryContext);
  return useMemo(() => selected === undefined ? configuredPublicMediaDelivery() : selected, [selected]);
}
