// Bridge storage in Netlify Blobs.
//
// Keys
//   b/<id>            the bridge (both ends, settings, counters)
//   idx/tg/<chatId>   → { id }   which bridge a Telegram chat belongs to
//   idx/wa/<digits>   → { id }   which bridge a WhatsApp number belongs to
//   code/<CODE>       → { id }   pairing code while one end is missing (30 min)
//   log/<id>          { entries: LogEntry[] } newest last, capped
//   pid/<platformId>  → { bridge, entry }  for Twilio delivery receipts
//   owner/<tgUserId>  { ids: string[] }  bridges shown in the dashboard
//   stats             global counters for the landing page

import { getJSON, putJSON, store, update } from "./store.ts";
import { randomId } from "./crypto.ts";
import type { Bridge, LogEntry, Side, TelegramEnd, WhatsAppEnd } from "../../shared/types.ts";

const LOG_CAP = 300;
const CODE_ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_RE = /\bCB-([A-HJ-NP-Z2-9]{5})\b/i;

const now = () => new Date().toISOString();
const day = () => new Date().toISOString().slice(0, 10);
const digits = (n: string) => n.replace(/\D/g, "");

export function newBridge(kind: Bridge["kind"]): Bridge {
  return {
    id: randomId(12),
    kind,
    ownerTg: null,
    createdAt: now(),
    code: null,
    codeExpires: null,
    telegram: null,
    whatsapp: null,
    settings: { name: "", paused: false, showSender: true, translateTo: { telegram: null, whatsapp: null } },
    stats: { relayed: 0, failed: 0, lastAt: null, day: day(), today: 0 },
  };
}

export const getBridge = (id: string) => (/^[a-z0-9]{8,16}$/.test(id) ? getJSON<Bridge>(`b/${id}`) : Promise.resolve(null));
export const saveBridge = (b: Bridge) => putJSON(`b/${b.id}`, b);
export const updateBridge = (id: string, fn: (b: Bridge) => Bridge | undefined) => update<Bridge>(`b/${id}`, (b) => (b ? fn(b) : undefined));

export async function bridgeFor(side: Side, key: string): Promise<Bridge | null> {
  const ref = await getJSON<{ id: string }>(side === "telegram" ? `idx/tg/${key}` : `idx/wa/${digits(key)}`);
  return ref ? getBridge(ref.id) : null;
}

/** Creates a bridge with one end attached and a pairing code for the other end. */
export async function createPending(side: Side, end: TelegramEnd | WhatsAppEnd, ownerTg: string | null): Promise<Bridge> {
  const b = newBridge("real");
  b.ownerTg = ownerTg;
  if (side === "telegram") b.telegram = end as TelegramEnd;
  else b.whatsapp = end as WhatsAppEnd;
  for (let i = 0; i < 6; i++) {
    const code = `CB-${randomId(5, CODE_ALPHA)}`;
    const res = await store().setJSON(`code/${code}`, { id: b.id, exp: Date.now() + 30 * 60_000 }, { onlyIfNew: true });
    if (res.modified) { b.code = code; b.codeExpires = new Date(Date.now() + 30 * 60_000).toISOString(); break; }
  }
  await saveBridge(b);
  await index(side, b);
  if (ownerTg) await addOwned(ownerTg, b.id);
  await bumpGlobal({ bridges: 1 });
  return b;
}

export async function bridgeByCode(code: string): Promise<Bridge | null> {
  const ref = await getJSON<{ id: string; exp: number }>(`code/${code.toUpperCase()}`);
  if (!ref || ref.exp < Date.now()) return null;
  return getBridge(ref.id);
}

/** Attaches the missing end using a pairing code. */
export async function attach(b: Bridge, side: Side, end: TelegramEnd | WhatsAppEnd, ownerTg: string | null): Promise<Bridge> {
  const saved = await updateBridge(b.id, (cur) => {
    if (side === "telegram") cur.telegram = end as TelegramEnd;
    else cur.whatsapp = end as WhatsAppEnd;
    if (ownerTg && !cur.ownerTg) cur.ownerTg = ownerTg;
    cur.code = null;
    cur.codeExpires = null;
    return cur;
  });
  if (b.code) await store().delete(`code/${b.code}`);
  if (saved) {
    await index(side, saved);
    if (ownerTg) await addOwned(ownerTg, saved.id);
  }
  return saved || b;
}

async function index(side: Side, b: Bridge) {
  if (side === "telegram" && b.telegram) await putJSON(`idx/tg/${b.telegram.chatId}`, { id: b.id });
  if (side === "whatsapp" && b.whatsapp) await putJSON(`idx/wa/${digits(b.whatsapp.number)}`, { id: b.id });
}

async function addOwned(tgUser: string, id: string) {
  await update<{ ids: string[] }>(`owner/${tgUser}`, (cur) => {
    const ids = cur?.ids || [];
    return ids.includes(id) ? undefined : { ids: [...ids, id].slice(-50) };
  });
}

export async function ownedBridges(tgUser: string): Promise<Bridge[]> {
  const ref = await getJSON<{ ids: string[] }>(`owner/${tgUser}`);
  const list = await Promise.all((ref?.ids || []).map(getBridge));
  return list.filter((b): b is Bridge => Boolean(b));
}

/** Removes a bridge and its indexes. */
export async function removeBridge(b: Bridge) {
  const s = store();
  if (b.telegram && b.telegram.kind !== "sim") {
    const ref = await getJSON<{ id: string }>(`idx/tg/${b.telegram.chatId}`);
    if (ref?.id === b.id) await s.delete(`idx/tg/${b.telegram.chatId}`);
  }
  if (b.whatsapp && b.whatsapp.kind !== "sim") {
    const ref = await getJSON<{ id: string }>(`idx/wa/${digits(b.whatsapp.number)}`);
    if (ref?.id === b.id) await s.delete(`idx/wa/${digits(b.whatsapp.number)}`);
  }
  if (b.code) await s.delete(`code/${b.code}`);
  await s.delete(`b/${b.id}`);
  await s.delete(`log/${b.id}`);
}

// ---------------------------------------------------------------- log

export async function appendLog(bridgeId: string, entry: LogEntry): Promise<void> {
  await update<{ entries: LogEntry[] }>(`log/${bridgeId}`, (cur) => ({ entries: [...(cur?.entries || []), entry].slice(-LOG_CAP) }));
  if (entry.platformId) await putJSON(`pid/${entry.platformId}`, { bridge: bridgeId, entry: entry.id });
}

export async function patchLog(bridgeId: string, entryId: string, patch: Partial<LogEntry>): Promise<LogEntry | null> {
  let out: LogEntry | null = null;
  await update<{ entries: LogEntry[] }>(`log/${bridgeId}`, (cur) => {
    if (!cur) return undefined;
    const i = cur.entries.findIndex((e) => e.id === entryId);
    if (i < 0) return undefined;
    const e = { ...cur.entries[i], ...patch };
    out = e;
    const entries = [...cur.entries];
    entries[i] = e;
    return { entries };
  });
  if (out && patch.platformId) await putJSON(`pid/${patch.platformId}`, { bridge: bridgeId, entry: entryId });
  return out;
}

export async function readLog(bridgeId: string): Promise<LogEntry[]> {
  return (await getJSON<{ entries: LogEntry[] }>(`log/${bridgeId}`))?.entries || [];
}

export const entryByPlatformId = (pid: string) => getJSON<{ bridge: string; entry: string }>(`pid/${pid}`);

export async function countRelay(b: Bridge, ok: boolean) {
  await updateBridge(b.id, (cur) => {
    const d = day();
    if (cur.stats.day !== d) { cur.stats.day = d; cur.stats.today = 0; }
    if (ok) { cur.stats.relayed += 1; cur.stats.today += 1; } else cur.stats.failed += 1;
    cur.stats.lastAt = now();
    return cur;
  });
  if (ok) await bumpGlobal({ messages: 1, sim: b.kind === "sim" });
}

// ---------------------------------------------------------------- global stats

export interface GlobalStats { bridges: number; messages: number; simMessages: number; days: Record<string, number> }

export async function bumpGlobal(d: { bridges?: number; messages?: number; sim?: boolean }) {
  await update<GlobalStats>("stats", (cur) => {
    const s: GlobalStats = cur || { bridges: 0, messages: 0, simMessages: 0, days: {} };
    s.bridges += d.bridges || 0;
    if (d.messages) {
      s.messages += d.messages;
      if (d.sim) s.simMessages += d.messages;
      const k = day();
      s.days[k] = (s.days[k] || 0) + d.messages;
      s.days = Object.fromEntries(Object.entries(s.days).sort().slice(-30));
    }
    return s;
  }).catch(() => null);
}
