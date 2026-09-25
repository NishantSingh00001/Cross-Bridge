import { useEffect, useState } from "react";
import { api } from "./api";
import type { PublicConfig } from "../../shared/types";

export interface Health extends PublicConfig {
  model: string | null;
  webhook: { set: boolean; url: string | null; pending: number; lastError: string | null } | null;
  urls: { telegram: string; twilio: string; twilioStatus: string };
}

let cache: Promise<Health> | null = null;
export function loadHealth(force = false): Promise<Health> {
  if (!cache || force) cache = api<Health>("/api/health").catch((e) => { cache = null; throw e; });
  return cache;
}

export function useHealth(): { health: Health | null; error: string | null; reload: () => void } {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    loadHealth(tick > 0).then((h) => live && setHealth(h)).catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [tick]);
  return { health, error, reload: () => setTick((t) => t + 1) };
}
