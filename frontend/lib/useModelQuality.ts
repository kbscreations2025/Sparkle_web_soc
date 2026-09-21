"use client";

import { useState } from "react";
import { qualitiesFor } from "@/lib/api";

/**
 * The output size picked for the current model, and a setter for it.
 *
 * Derived rather than reset: what's stored is the user's *preference*, and
 * the size actually in force is that preference only while the selected
 * model offers it, otherwise the model's best. That way switching 3 Pro →
 * 2.5 Flash silently drops 2K (which 2.5 Flash cannot do) and switching back
 * restores it, with no effect to fire and no render where the picker shows a
 * size the model can't produce.
 *
 * Every image tool but cleaning uses this. Cleaning has no picker — it always
 * runs at the model's best.
 */
export function useModelQuality(model: string) {
  const [preferred, setPreferred] = useState<string | null>(null);

  const options = qualitiesFor(model);
  const quality = preferred && options.includes(preferred) ? preferred : options[0];

  return [quality, setPreferred] as const;
}
