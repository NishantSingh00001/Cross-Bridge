// Daily housekeeping: simulator sessions older than a day, media older than a week,
// and expired dedupe keys, rate-limit windows and sign-in links.

import type { Config } from "@netlify/functions";
import { store } from "../lib/store.ts";
import type { Bridge } from "../../shared/types.ts";

export default async () => {
  const s = store();
  const now = Date.now();
  const counts = { sim: 0, media: 0, seen: 0, limits: 0, logins: 0 };

  for (const { key } of (await s.list({ prefix: "b/" })).blobs) {
    const b = (await s.get(key, { type: "json" })) as Bridge | null;
    if (b?.kind === "sim" && now - Date.parse(b.createdAt) > 86400_000) {
      await Promise.all([s.delete(key), s.delete(`log/${b.id}`), s.delete(`simkey/${b.id}`)]);
      counts.sim++;
    }
  }
  for (const { key } of (await s.list({ prefix: "media/" })).blobs) {
    const meta = (await s.getMetadata(key))?.metadata as { at?: number } | undefined;
    if (!meta?.at || now - meta.at > 7 * 86400_000) { await s.delete(key); counts.media++; }
  }
  for (const { key } of (await s.list({ prefix: "seen/" })).blobs) {
    const v = (await s.get(key, { type: "json" })) as { at?: number } | number | null;
    const at = typeof v === "object" && v ? v.at : undefined;
    if (!at || now - at > 3 * 86400_000) { await s.delete(key); counts.seen++; }
  }
  for (const { key } of (await s.list({ prefix: "limit/" })).blobs) {
    const start = Number(key.split("/").pop());
    if (Number.isFinite(start) && start * 1000 < now - 2 * 86400_000) { await s.delete(key); counts.limits++; }
  }
  for (const { key } of (await s.list({ prefix: "login/" })).blobs) {
    const v = (await s.get(key, { type: "json" })) as { exp?: number } | null;
    if (!v?.exp || v.exp < now) { await s.delete(key); counts.logins++; }
  }
  console.log("cleanup", counts);
};

export const config: Config = { schedule: "@daily" };
