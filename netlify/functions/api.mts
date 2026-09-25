// CrossBridge API: webhooks (Telegram, Twilio), media, setup, dashboard and the simulator.
// A Hono app running inside one Netlify Function.

import type { Config, Context } from "@netlify/functions";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { env, HttpError, siteUrl } from "../lib/env.ts";
import { getJSON, putJSON, firstTime, rateLimit, store } from "../lib/store.ts";
import { randomToken, safeEqual, sha256, signJwt, verifyJwt } from "../lib/crypto.ts";
import { botUsername, COMMANDS, downloadFile, parseUpdate, telegramConfigured, telegramToken, tg, webhookSecret } from "../lib/telegram.ts";
import { downloadMedia, parseInbound, sandboxKeyword, twilioConfigured, twiml, validSignature, waNumber } from "../lib/twilio.ts";
import { aiConfigured, modelChain } from "../lib/gemini.ts";
import { entryByPlatformId, getBridge, newBridge, ownedBridges, readLog, removeBridge, saveBridge, updateBridge, type GlobalStats } from "../lib/bridges.ts";
import { deliveryStatus, handleInbound, maskNumber, type Inbound } from "../lib/relay.ts";
import { LANGUAGES, type Bridge, type PublicConfig, type Side } from "../../shared/types.ts";

type Env = { Variables: { user: { sub: string; name: string } }; Bindings: { context: Context } };
const app = new Hono<Env>().basePath("/api");

app.onError((err, c) => {
  const status = err instanceof HttpError ? err.status : 500;
  if (status >= 500) console.error(err);
  return c.json({ error: status >= 500 && !(err instanceof HttpError) ? "Something went wrong on the server." : err.message }, status as 400);
});
app.notFound((c) => c.json({ error: `Unknown API route: ${c.req.path}` }, 400));

const ip = (c: { env: { context: Context } }) => c.env?.context?.ip || "local";
const ipKey = async (c: { env: { context: Context } }) => (await sha256(`cb:${ip(c)}`)).slice(0, 16);

// ---------------------------------------------------------------- public info

async function publicConfig(): Promise<PublicConfig> {
  return {
    telegram: { configured: telegramConfigured(), username: await botUsername() },
    whatsapp: { configured: twilioConfigured(), number: waNumber(), keyword: sandboxKeyword() },
    ai: aiConfigured(),
  };
}

app.get("/health", async (c) => {
  const cfg = await publicConfig();
  let webhook: { set: boolean; url: string | null; pending: number; lastError: string | null } | null = null;
  if (cfg.telegram.configured) {
    try {
      const info = await tg<{ url: string; pending_update_count: number; last_error_message?: string; last_error_date?: number }>("getWebhookInfo", {}, 4000);
      const expected = `${siteUrl(c.req.raw)}/api/webhooks/telegram`;
      webhook = { set: info.url === expected, url: info.url || null, pending: info.pending_update_count, lastError: info.last_error_date && Date.now() / 1000 - info.last_error_date < 3600 ? info.last_error_message || null : null };
    } catch { webhook = null; }
  }
  return c.json({ ok: true, ...cfg, model: cfg.ai ? modelChain()[0] : null, webhook, urls: { telegram: `${siteUrl(c.req.raw)}/api/webhooks/telegram`, twilio: `${siteUrl(c.req.raw)}/api/webhooks/twilio`, twilioStatus: `${siteUrl(c.req.raw)}/api/webhooks/twilio/status` } });
});

app.get("/stats", async (c) => {
  const s = (await getJSON<GlobalStats>("stats")) || { bridges: 0, messages: 0, simMessages: 0, days: {} };
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.now() - (13 - i) * 86400_000).toISOString().slice(0, 10);
    return { day: d, messages: s.days[d] || 0 };
  });
  return c.json({ bridges: s.bridges, messages: s.messages, simMessages: s.simMessages, days }, 200, { "cache-control": "public, max-age=30" });
});

// ---------------------------------------------------------------- webhooks

app.post("/webhooks/telegram", async (c) => {
  if (!telegramConfigured()) return c.json({ ok: false }, 503);
  const secret = c.req.header("x-telegram-bot-api-secret-token") || "";
  if (!safeEqual(secret, await webhookSecret())) return c.json({ error: "Bad secret" }, 401);
  const update = await c.req.json().catch(() => null);
  const m = parseUpdate(update);
  if (!m || m.isBot) return c.json({ ok: true });
  if (!(await firstTime(`tg/${m.updateId}`))) return c.json({ ok: true, duplicate: true });
  const inb: Inbound = {
    side: "telegram",
    key: m.chatId,
    senderId: m.fromId,
    senderName: m.fromName,
    text: m.text,
    edited: m.edited,
    media: m.media ? { type: m.media.mime, name: m.media.name, fetch: () => downloadFile(m.media!.fileId) } : null,
    chat: { title: m.chatTitle, kind: m.chatType === "private" ? "private" : "group" },
    origin: siteUrl(c.req.raw),
  };
  try {
    await handleInbound(inb);
  } catch (err) {
    if (err instanceof HttpError && err.status === 429) {
      await tg("sendMessage", { chat_id: m.chatId, text: `🌉 ${err.message}` }).catch(() => null);
      return c.json({ ok: true });
    }
    await store().delete(`seen/tg/${m.updateId}`); // let Telegram retry
    throw err;
  }
  return c.json({ ok: true });
});

async function twilioParams(c: { req: { raw: Request; text: () => Promise<string>; header: (n: string) => string | undefined } }, path: string) {
  const body = await c.req.text();
  const params = new URLSearchParams(body);
  const seen = new URL(c.req.raw.url);
  const candidates = [...new Set([
    `${siteUrl(c.req.raw)}${path}`,
    `${seen.origin}${seen.pathname}${seen.search}`,
    `https://${c.req.header("x-forwarded-host") || seen.host}${seen.pathname}${seen.search}`,
  ])];
  const ok = await validSignature(c.req.header("x-twilio-signature") || null, candidates, params);
  return { ok, params };
}

app.post("/webhooks/twilio", async (c) => {
  if (!twilioConfigured()) return twiml();
  const { ok, params } = await twilioParams(c, "/api/webhooks/twilio");
  if (!ok) return c.text("Invalid signature", 401);
  const m = parseInbound(params);
  if (!m) return twiml();
  if (!(await firstTime(`wa/${m.sid}`))) return twiml();
  const inb: Inbound = {
    side: "whatsapp",
    key: m.from,
    senderId: m.from,
    senderName: m.name,
    text: m.text,
    media: m.media ? { type: m.media.type, name: "media", fetch: () => downloadMedia(m.media!.url) } : null,
    origin: siteUrl(c.req.raw),
  };
  try {
    await handleInbound(inb);
  } catch (err) {
    if (err instanceof HttpError && err.status === 429) return twiml(`🌉 ${err.message}`);
    await store().delete(`seen/wa/${m.sid}`);
    throw err;
  }
  return twiml();
});

app.post("/webhooks/twilio/status", async (c) => {
  if (!twilioConfigured()) return c.body(null, 204);
  const { ok, params } = await twilioParams(c, "/api/webhooks/twilio/status");
  if (!ok) return c.text("Invalid signature", 401);
  const sid = params.get("MessageSid") || "";
  const ref = sid ? await entryByPlatformId(sid) : null;
  if (ref) await deliveryStatus(ref.bridge, ref.entry, params.get("MessageStatus") || "", params.get("ErrorCode"));
  return c.body(null, 204);
});

// ---------------------------------------------------------------- media

app.get("/media/:id", async (c) => {
  const id = c.req.param("id");
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(id)) return c.json({ error: "Bad media id" }, 400);
  const res = await store().getWithMetadata(`media/${id}`, { type: "arrayBuffer" });
  if (!res) return c.json({ error: "Media expired" }, 410);
  const mime = String((res.metadata as { mime?: string }).mime || "application/octet-stream");
  const safe = /^(image\/(jpeg|png|gif|webp)|audio\/|video\/mp4|application\/pdf)/.test(mime) ? mime : "application/octet-stream";
  return new Response(res.data, { headers: { "content-type": safe, "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'" } });
});

// ---------------------------------------------------------------- setup

app.post("/setup/telegram", async (c) => {
  await rateLimit(`setup:${await ipKey(c)}`, 10, 3600);
  const { token } = await c.req.json().catch(() => ({ token: "" }));
  const real = telegramToken();
  if (!real) throw new HttpError(503, "Add TELEGRAM_BOT_TOKEN in Netlify first, then redeploy.");
  if (typeof token !== "string" || !safeEqual(token.trim(), real)) throw new HttpError(401, "That isn't this site's bot token.");
  const url = `${siteUrl(c.req.raw)}/api/webhooks/telegram`;
  await tg("setWebhook", { url, secret_token: await webhookSecret(), allowed_updates: ["message", "edited_message"], max_connections: 20 });
  await tg("setMyCommands", { commands: COMMANDS });
  const info = await tg<{ url: string; pending_update_count: number }>("getWebhookInfo", {});
  return c.json({ ok: true, url: info.url, pending: info.pending_update_count, bot: await botUsername() });
});

// ---------------------------------------------------------------- dashboard auth

async function jwtSecret(): Promise<string> {
  const fromEnv = env("JWT_SECRET");
  if (fromEnv && fromEnv.length >= 16) return fromEnv;
  let s = await store().get("cfg/jwt");
  if (!s) {
    await store().set("cfg/jwt", randomToken(48), { onlyIfNew: true });
    s = await store().get("cfg/jwt");
  }
  return String(s);
}

app.post("/auth/exchange", async (c) => {
  await rateLimit(`login:${await ipKey(c)}`, 20, 3600);
  const { token } = await c.req.json().catch(() => ({ token: "" }));
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw new HttpError(400, "That sign-in link isn't valid.");
  const rec = await getJSON<{ tg: string; name: string; exp: number }>(`login/${token}`);
  await store().delete(`login/${token}`);
  if (!rec || rec.exp < Date.now()) throw new HttpError(401, "That sign-in link has expired or was already used. Send /login to the bot again.");
  const session = await signJwt({ sub: rec.tg, name: rec.name }, await jwtSecret(), 7 * 86400);
  return c.json({ token: session, user: { id: rec.tg, name: rec.name } });
});

const requireUser: MiddlewareHandler<Env> = async (c, next) => {
  const h = c.req.header("authorization") || "";
  const user = h.startsWith("Bearer ") ? await verifyJwt<{ sub: string; name: string }>(h.slice(7), await jwtSecret()) : null;
  if (!user) throw new HttpError(401, "Please sign in again.");
  c.set("user", user);
  await next();
};

/** What the dashboard sees: the WhatsApp number is masked. */
function view(b: Bridge) {
  return {
    ...b,
    code: b.code,
    whatsapp: b.whatsapp ? { ...b.whatsapp, number: b.whatsapp.kind === "real" ? maskNumber(b.whatsapp.number) : b.whatsapp.number } : null,
  };
}

async function ownBridge(id: string, user: string): Promise<Bridge> {
  const b = await getBridge(id);
  if (!b || b.kind !== "real") throw new HttpError(410, "This bridge doesn't exist any more.");
  if (b.ownerTg !== user) throw new HttpError(401, "This bridge belongs to someone else.");
  return b;
}

app.get("/me", requireUser, async (c) => {
  const u = c.get("user");
  const bridges = await ownedBridges(u.sub);
  return c.json({ user: { id: u.sub, name: u.name }, bridges: bridges.filter((b) => b.kind === "real").map(view) });
});

app.get("/bridges/:id", requireUser, async (c) => {
  const b = await ownBridge(c.req.param("id"), c.get("user").sub);
  return c.json({ bridge: view(b), log: (await readLog(b.id)).slice(-150) });
});

const lang = z.enum(LANGUAGES.map(([code]) => code) as [string, ...string[]]).nullable();
const Settings = z.object({
  name: z.string().max(60).optional(),
  paused: z.boolean().optional(),
  showSender: z.boolean().optional(),
  translateTo: z.object({ telegram: lang.optional(), whatsapp: lang.optional() }).optional(),
}).strict();

function applySettings(b: Bridge, s: z.infer<typeof Settings>): Bridge {
  if (s.name !== undefined) b.settings.name = s.name.trim();
  if (s.paused !== undefined) b.settings.paused = s.paused;
  if (s.showSender !== undefined) b.settings.showSender = s.showSender;
  if (s.translateTo?.telegram !== undefined) b.settings.translateTo.telegram = s.translateTo.telegram;
  if (s.translateTo?.whatsapp !== undefined) b.settings.translateTo.whatsapp = s.translateTo.whatsapp;
  return b;
}

async function parseSettings(req: Request) {
  const parsed = Settings.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || "Invalid settings.");
  return parsed.data;
}

app.patch("/bridges/:id", requireUser, async (c) => {
  const b = await ownBridge(c.req.param("id"), c.get("user").sub);
  const s = await parseSettings(c.req.raw);
  const saved = await updateBridge(b.id, (cur) => applySettings(cur, s));
  return c.json({ bridge: saved && view(saved) });
});

app.delete("/bridges/:id", requireUser, async (c) => {
  const b = await ownBridge(c.req.param("id"), c.get("user").sub);
  const notice = { side: "telegram" as Side, key: b.telegram?.chatId || "", senderId: c.get("user").sub, senderName: c.get("user").name, text: "/unlink", media: null, origin: siteUrl(c.req.raw) };
  if (b.telegram && b.whatsapp) await handleInbound({ ...notice, bridge: b, chat: { title: b.telegram.title, kind: b.telegram.kind === "group" ? "group" : "private" } });
  else await removeBridge(b);
  return c.json({ deleted: true });
});

// ---------------------------------------------------------------- simulator

const SimSend = z.object({ side: z.enum(["telegram", "whatsapp"]), sender: z.string().trim().min(1).max(40), text: z.string().trim().min(1).max(1000) });

async function simBridge(c: { req: { param: (k: string) => string; header: (k: string) => string | undefined } }): Promise<Bridge> {
  const b = await getBridge(c.req.param("id"));
  const key = c.req.header("x-sim-key") || "";
  const hash = b ? await getJSON<{ hash: string }>(`simkey/${b.id}`) : null;
  if (!b || b.kind !== "sim" || !hash || !safeEqual(await sha256(key), hash.hash)) throw new HttpError(401, "Simulator session not found. Start a new one.");
  return b;
}

app.post("/sim", async (c) => {
  await rateLimit(`simnew:${await ipKey(c)}`, 15, 3600, "Too many simulator sessions. Try again in a while.");
  const b = newBridge("sim");
  const t = new Date().toISOString();
  b.telegram = { chatId: `sim-${b.id}`, title: "Project group", kind: "sim", linkedBy: "sim", linkedAt: t };
  b.whatsapp = { number: "sim", name: "Priya", kind: "sim", linkedAt: t, lastInboundAt: t };
  b.settings.name = "Simulator";
  await saveBridge(b);
  const key = randomToken(24);
  await putJSON(`simkey/${b.id}`, { hash: await sha256(key) });
  return c.json({ id: b.id, key, bridge: b }, 201);
});

app.get("/sim/:id", async (c) => {
  const b = await simBridge(c);
  return c.json({ bridge: b, log: (await readLog(b.id)).slice(-120) });
});

app.post("/sim/:id/send", async (c) => {
  const b = await simBridge(c);
  await rateLimit(`simmsg:${await ipKey(c)}`, 60, 600, "That's a lot of messages! Wait a few minutes and try again.");
  const parsed = SimSend.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new HttpError(400, "Type a message first.");
  const { side, sender, text } = parsed.data;
  const inb: Inbound = { side, key: "sim", bridge: b, senderId: `sim-${side}`, senderName: sender, text, media: null, chat: { title: b.telegram!.title, kind: "private" }, origin: siteUrl(c.req.raw) };
  const t0 = Date.now();
  await handleInbound(inb);
  const fresh = await getBridge(b.id);
  return c.json({ bridge: fresh || b, log: (await readLog(b.id)).slice(-120), ms: Date.now() - t0 });
});

app.patch("/sim/:id", async (c) => {
  const b = await simBridge(c);
  const s = await parseSettings(c.req.raw);
  const saved = await updateBridge(b.id, (cur) => applySettings(cur, s));
  return c.json({ bridge: saved });
});

export default async (req: Request, context: Context) => app.fetch(req, { context });

export const config: Config = { path: "/api/*" };
