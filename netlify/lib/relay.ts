// The heart of CrossBridge: one pipeline for every inbound message, whichever side it came from.
//
//   inbound → dedupe (done by the webhook) → commands / pairing → media → translate → format → deliver → log
//
// Delivery goes through the Telegram Bot API, the Twilio WhatsApp API, or (for the web
// simulator) straight into the bridge's log, so the simulator runs exactly the same code.

import { attach, appendLog, bridgeByCode, bridgeFor, CODE_RE, countRelay, createPending, getBridge, patchLog, readLog, removeBridge, updateBridge } from "./bridges.ts";
import { aiConfigured, summarize, translate } from "./ai.ts";
import { botUsername, esc, sendMedia, sendText, TelegramError } from "./telegram.ts";
import { sandboxKeyword, sendWhatsApp, TwilioError, waNumber } from "./twilio.ts";
import { putJSON, rateLimit, store } from "./store.ts";
import { randomId, randomToken } from "./crypto.ts";
import { langName, LANGUAGES, other, SIDE_LABEL, type Bridge, type LogEntry, type Side, type Status, type TelegramEnd, type WhatsAppEnd } from "../../shared/types.ts";

export interface Inbound {
  side: Side;
  key: string; // Telegram chat id or WhatsApp number (unused for the simulator)
  bridge?: Bridge; // the simulator passes its bridge directly
  senderId: string;
  senderName: string;
  text: string;
  edited?: boolean;
  media: { type: string; name: string; fetch: () => Promise<{ data: ArrayBuffer; mime: string } | null> } | null;
  chat?: { title: string; kind: "private" | "group" };
  origin: string; // this site's URL, for media, callbacks and login links
}

const now = () => new Date().toISOString();
export const maskNumber = (n: string) => (n.length > 6 ? `${n.slice(0, 3)}•••••${n.slice(-4)}` : n);

function describeEnd(b: Bridge, side: Side): string {
  if (side === "telegram") return b.telegram ? (b.telegram.kind === "sim" ? "Telegram (simulated)" : `Telegram “${b.telegram.title}”`) : "Telegram (not linked yet)";
  return b.whatsapp ? (b.whatsapp.kind === "sim" ? "WhatsApp (simulated)" : `WhatsApp ${maskNumber(b.whatsapp.number)}`) : "WhatsApp (not linked yet)";
}

// ---------------------------------------------------------------- delivery

interface Out { plain: string; html: string }

async function deliver(b: Bridge, to: Side, out: Out, media: { url: string; type: string } | null, origin: string): Promise<{ platformId: string | null; status: Status }> {
  if (b.kind === "sim") return { platformId: `sim-${randomId(8)}`, status: "delivered" };
  if (to === "telegram") {
    if (!b.telegram) throw new Error("Telegram side isn't linked.");
    const id = media ? await sendMedia(b.telegram.chatId, media.url, media.type, out.html) : await sendText(b.telegram.chatId, out.html);
    return { platformId: `tg-${b.telegram.chatId}-${id}`, status: "sent" };
  }
  if (!b.whatsapp) throw new Error("WhatsApp side isn't linked.");
  const r = await sendWhatsApp(b.whatsapp.number, out.plain, { mediaUrl: media?.url, statusCallback: `${origin}/api/webhooks/twilio/status` });
  return { platformId: r.sid, status: r.status === "sent" ? "sent" : "queued" };
}

/** A message from the bot to one side (command replies, pairing, notices). */
async function say(b: Bridge | null, side: Side, key: string, text: string): Promise<LogEntry | null> {
  const plain = `🌉 ${text}`;
  const html = `🌉 ${esc(text).replace(/\*([^*\n]+)\*/g, "<b>$1</b>")}`;
  const entry: LogEntry = { id: randomId(10), at: now(), kind: "system", from: "bot", to: side, sender: "CrossBridge", text: plain, delivered: plain, translated: null, media: null, status: "sent", error: null, platformId: null, trace: [] };
  if (b?.kind === "sim") {
    entry.status = "delivered";
  } else {
    try {
      if (side === "telegram") await sendText(key, html);
      else await sendWhatsApp(key, plain);
    } catch (e) {
      entry.status = "failed";
      entry.error = friendlyError(e);
    }
  }
  if (b) await appendLog(b.id, entry);
  return entry;
}

function friendlyError(e: unknown): string {
  if (e instanceof TwilioError) {
    if (e.code === 63016 || e.code === 63032) return "WhatsApp only allows replies within 24 hours of the person's last message.";
    if (e.code === 63015 || e.code === 63007) return "This WhatsApp number hasn't joined the Twilio sandbox.";
    if (e.code === 21608 || e.code === 21211) return "Twilio can't message this number from a trial account.";
    return `WhatsApp (Twilio ${e.code}): ${e.message}`;
  }
  if (e instanceof TelegramError) {
    if (e.code === 403) return "The bot was removed from the Telegram chat or blocked.";
    return `Telegram: ${e.message}`;
  }
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------- formatting

function format(b: Bridge, inb: Inbound, to: Side, body: string, translated: LogEntry["translated"]): Out {
  const from = SIDE_LABEL[inb.side];
  const edited = inb.edited ? " (edited)" : "";
  const note = translated ? `🌐 translated from ${translated.from || "another language"}` : "";
  if (to === "whatsapp") {
    const head = b.settings.showSender ? `*${inb.senderName}* · ${from}${edited}\n` : "";
    const plain = `${head}${body}${note ? `\n_${note}_` : ""}`.trim();
    return { plain, html: esc(plain) };
  }
  const headHtml = b.settings.showSender ? `<b>${esc(inb.senderName)}</b> <i>· ${from}${edited}</i>\n` : "";
  const html = `${headHtml}${esc(body)}${note ? `\n<i>${note}</i>` : ""}`.trim();
  const plain = `${b.settings.showSender ? `${inb.senderName} · ${from}${edited}\n` : ""}${body}${note ? `\n${note}` : ""}`.trim();
  return { plain, html };
}

// ---------------------------------------------------------------- relaying

async function relay(b: Bridge, inb: Inbound): Promise<LogEntry> {
  const to = other(inb.side);
  const t0 = Date.now();
  let last = t0;
  const trace: LogEntry["trace"] = [];
  const mark = (step: string, note?: string) => { const t = Date.now(); trace.push({ step, ms: t - last, ...(note ? { note } : {}) }); last = t; };
  const entry: LogEntry = { id: randomId(10), at: now(), kind: "relay", from: inb.side, to, sender: inb.senderName, text: inb.text, delivered: "", translated: null, media: null, status: "queued", error: null, platformId: null, trace };
  mark(`received from ${SIDE_LABEL[inb.side]}`);

  // Media is stored in Blobs and served from /api/media/<id>, so the other platform can fetch it.
  let media: { url: string; type: string } | null = null;
  if (inb.media) {
    try {
      const m = await inb.media.fetch();
      if (m) {
        const id = randomToken(18);
        await store().set(`media/${id}`, new Blob([m.data], { type: m.mime }), { metadata: { mime: m.mime, name: inb.media.name, at: Date.now() } });
        media = { url: `${inb.origin}/api/media/${id}`, type: m.mime };
        entry.media = media;
        mark("media copied", `${(m.data.byteLength / 1024).toFixed(0)} KB ${m.mime}`);
      } else mark("media skipped", "over 5 MB or unavailable");
    } catch (e) {
      mark("media failed", friendlyError(e));
    }
  }

  let body = inb.text;
  const lang = b.settings.translateTo[to];
  if (lang && body.trim()) {
    try {
      const tr = await translate(body, lang);
      if (tr) { body = tr.text; entry.translated = { lang, from: tr.from, text: tr.text }; mark("translated by Gemini", `→ ${langName(lang)}`); }
      else mark("translation skipped", aiConfigured() ? "already in that language" : "AI is off");
    } catch (e) {
      mark("translation failed", e instanceof Error ? e.message : "error");
    }
  }

  const out = format(b, inb, to, body, entry.translated);
  entry.delivered = out.plain;
  mark("formatted");
  let ok = false;
  try {
    const r = await deliver(b, to, out, media, inb.origin);
    entry.platformId = r.platformId;
    entry.status = r.status;
    ok = true;
    mark(`handed to ${SIDE_LABEL[to]}`);
  } catch (e) {
    entry.status = "failed";
    entry.error = friendlyError(e);
    mark("delivery failed", entry.error);
  }
  await appendLog(b.id, entry);
  await countRelay(b, ok);
  if (!ok && b.kind === "real") await say(b, inb.side, inb.side === "telegram" ? b.telegram!.chatId : b.whatsapp!.number, `Couldn't deliver that to ${SIDE_LABEL[to]}: ${entry.error}`);
  return entry;
}

// ---------------------------------------------------------------- commands

const HELP = (b: Bridge | null, side: Side) => [
  "*CrossBridge* forwards messages between this chat and " + (side === "telegram" ? "WhatsApp" : "Telegram") + ".",
  b ? `This chat is bridged with ${describeEnd(b, other(side))}.` : "This chat isn't bridged yet.",
  "Commands:",
  "/status: bridge details",
  "/summary: AI summary of recent messages",
  "/translate hi: translate messages you receive (or /translate off)",
  "/pause and /resume",
  ...(side === "telegram" ? ["/login: open the web dashboard"] : []),
  "/unlink: disconnect",
].join("\n");

async function command(b: Bridge | null, inb: Inbound, cmd: string, arg: string): Promise<boolean> {
  const side = inb.side;
  const key = inb.key;
  switch (cmd) {
    case "help":
      await say(b, side, key, HELP(b, side));
      return true;
    case "status": {
      if (!b) return false;
      const lines = [
        `*${b.settings.name || "Bridge"}* ${b.settings.paused ? "(paused)" : "(active)"}`,
        `${describeEnd(b, "telegram")} ⇄ ${describeEnd(b, "whatsapp")}`,
        `Messages relayed: ${b.stats.relayed}${b.stats.failed ? ` · failed: ${b.stats.failed}` : ""}`,
        `Translation → Telegram: ${b.settings.translateTo.telegram ? langName(b.settings.translateTo.telegram) : "off"} · → WhatsApp: ${b.settings.translateTo.whatsapp ? langName(b.settings.translateTo.whatsapp) : "off"}`,
      ];
      if (b.whatsapp?.kind === "real") {
        const last = b.whatsapp.lastInboundAt ? Date.parse(b.whatsapp.lastInboundAt) : 0;
        const open = Date.now() - last < 24 * 3600_000;
        lines.push(open ? "WhatsApp window: open" : "WhatsApp window: closed. They need to send any message on WhatsApp before replies can be delivered.");
      }
      await say(b, side, key, lines.join("\n"));
      return true;
    }
    case "summary": {
      if (!b) return false;
      if (!aiConfigured()) { await say(b, side, key, "Summaries need AI, which isn't switched on for this deployment."); return true; }
      await rateLimit(`summary:${b.id}`, 10, 3600, "Only 10 summaries an hour, please.");
      const text = await summarize(await readLog(b.id), b.settings.translateTo[side]).catch(() => "The AI didn't respond in time. Try again in a moment.");
      await say(b, side, key, `Summary of recent messages:\n${text}`);
      return true;
    }
    case "translate": {
      if (!b) return false;
      const code = arg.trim().toLowerCase();
      if (!code || code === "off" || code === "none") {
        await updateBridge(b.id, (cur) => { cur.settings.translateTo[side] = null; return cur; });
        await say(b, side, key, "Translation off. You'll get messages as they were written.");
        return true;
      }
      const match = LANGUAGES.find(([c, n]) => c === code || n.toLowerCase() === code);
      if (!match) { await say(b, side, key, `I don't know “${code}”. Try: ${LANGUAGES.slice(0, 8).map(([c]) => c).join(", ")}…`); return true; }
      await updateBridge(b.id, (cur) => { cur.settings.translateTo[side] = match[0]; return cur; });
      await say(b, side, key, `Messages you receive will be translated into ${match[1]}${aiConfigured() ? "." : ", once AI is switched on."}`);
      return true;
    }
    case "pause":
    case "resume": {
      if (!b) return false;
      const paused = cmd === "pause";
      const saved = await updateBridge(b.id, (cur) => { cur.settings.paused = paused; return cur; });
      const msg = paused ? `Forwarding paused by ${inb.senderName}. Send /resume to continue.` : `Forwarding resumed by ${inb.senderName}.`;
      await say(saved, side, key, msg);
      const o = other(side);
      if (saved && (o === "telegram" ? saved.telegram : saved.whatsapp)) await say(saved, o, o === "telegram" ? saved.telegram!.chatId : saved.whatsapp!.number, msg);
      return true;
    }
    case "unlink": {
      if (!b) return false;
      const o = other(side);
      await say(b, side, key, "Bridge removed. Messages here won't be forwarded any more.");
      if (o === "telegram" ? b.telegram : b.whatsapp) await say(b, o, o === "telegram" ? b.telegram!.chatId : b.whatsapp!.number, `The bridge was removed from the ${SIDE_LABEL[side]} side.`);
      if (b.kind === "real") await removeBridge(b);
      return true;
    }
    case "login": {
      if (side !== "telegram") { await say(b, side, key, "The dashboard sign-in works from Telegram: send /login to the bot there."); return true; }
      if (inb.chat?.kind !== "private") { await say(b, side, key, "For your privacy, send /login to me in a private chat."); return true; }
      const token = randomToken(24);
      await putJSON(`login/${token}`, { tg: inb.senderId, name: inb.senderName, exp: Date.now() + 10 * 60_000 });
      await say(b, side, key, `Open your CrossBridge dashboard (link works once, for 10 minutes):\n${inb.origin}/login#${token}`);
      return true;
    }
    default:
      return false;
  }
}

// ---------------------------------------------------------------- pairing

async function instructionsForTelegram(code: string, origin: string): Promise<string> {
  const num = waNumber();
  const kw = sandboxKeyword();
  const wa = num ? `https://wa.me/${num.replace(/\D/g, "")}?text=${encodeURIComponent(code)}` : "";
  return [
    "Let's bridge this chat with WhatsApp.",
    kw && num ? `1. On WhatsApp, send *join ${kw}* to ${num} (the Twilio sandbox).` : num ? `1. Open WhatsApp and message ${num}.` : "1. WhatsApp isn't configured on this deployment yet.",
    `2. Then send this code: *${code}*`,
    wa ? `Shortcut: ${wa}` : "",
    `The code works for 30 minutes. Manage bridges at ${origin}`,
  ].filter(Boolean).join("\n");
}

async function instructionsForWhatsApp(code: string): Promise<string> {
  const bot = await botUsername();
  return [
    "Let's bridge this chat with Telegram.",
    bot ? `Open https://t.me/${bot} and send: /link ${code}` : `On Telegram, send /link ${code} to the CrossBridge bot.`,
    "The code works for 30 minutes.",
  ].join("\n");
}

async function unbridged(inb: Inbound, cmd: string | null, arg: string): Promise<void> {
  const codeMatch = (cmd ? arg : inb.text).match(CODE_RE);
  if (codeMatch) {
    const code = `CB-${codeMatch[1].toUpperCase()}`;
    const target = await bridgeByCode(code);
    const missing = target && (inb.side === "telegram" ? !target.telegram : !target.whatsapp);
    if (!target || !missing) { await say(null, inb.side, inb.key, "That code has expired or was already used. Ask for a new one."); return; }
    const end: TelegramEnd | WhatsAppEnd = inb.side === "telegram"
      ? { chatId: inb.key, title: inb.chat?.title || inb.senderName, kind: inb.chat?.kind === "group" ? "group" : "private", linkedBy: inb.senderId, linkedAt: now() }
      : { number: inb.key, name: inb.senderName, kind: "real", linkedAt: now(), lastInboundAt: now() };
    const b = await attach(target, inb.side, end, inb.side === "telegram" ? inb.senderId : null);
    const msg = `Bridge connected: ${describeEnd(b, "telegram")} ⇄ ${describeEnd(b, "whatsapp")}. Messages now flow both ways. Send /help for commands.`;
    await say(b, "telegram", b.telegram!.chatId, msg);
    await say(b, "whatsapp", b.whatsapp!.number, msg);
    return;
  }
  if (inb.side === "telegram") {
    if (cmd === "start" || cmd === "link") {
      await rateLimit(`pair:${inb.senderId}`, 10, 3600, "Too many codes. Try again later.");
      const b = await createPending("telegram", { chatId: inb.key, title: inb.chat?.title || inb.senderName, kind: inb.chat?.kind === "group" ? "group" : "private", linkedBy: inb.senderId, linkedAt: now() }, inb.senderId);
      await say(b, "telegram", inb.key, await instructionsForTelegram(b.code!, inb.origin));
    } else if (cmd === "help") {
      await say(null, "telegram", inb.key, HELP(null, "telegram"));
    } else if (cmd === "login") {
      await command(null, inb, "login", "");
    } else if (inb.chat?.kind !== "group") {
      await say(null, "telegram", inb.key, "This chat isn't bridged yet. Send /start to get a pairing code.");
    }
    return;
  }
  // WhatsApp
  if (/^\/?link$/i.test(inb.text.trim()) || cmd === "start") {
    await rateLimit(`pair:${inb.key}`, 10, 3600, "Too many codes. Try again later.");
    const b = await createPending("whatsapp", { number: inb.key, name: inb.senderName, kind: "real", linkedAt: now(), lastInboundAt: now() }, null);
    await say(b, "whatsapp", inb.key, await instructionsForWhatsApp(b.code!));
    return;
  }
  const bot = await botUsername();
  await say(null, "whatsapp", inb.key, `Hi ${inb.senderName}! This is CrossBridge. To bridge WhatsApp with a Telegram chat, send /start to ${bot ? `https://t.me/${bot}` : "the bot on Telegram"} and send the code you get here. Or reply *link* to get a code for Telegram.`);
}

// ---------------------------------------------------------------- entry point

export async function handleInbound(inb: Inbound): Promise<{ bridge: Bridge | null; entry: LogEntry | null }> {
  const text = inb.text.trim();
  const m = text.match(/^\/([a-z]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i);
  const cmd = m ? m[1].toLowerCase() : null;
  const arg = m?.[2] || "";

  let b = inb.bridge || (await bridgeFor(inb.side, inb.key));
  // A half-linked bridge (still waiting for the other side) behaves like no bridge, except for its own code.
  const complete = b && b.telegram && b.whatsapp;
  if (!b || !complete) {
    if (b && !complete && (cmd === "start" || cmd === "link") && !arg) {
      await say(b, inb.side, inb.key, inb.side === "telegram" ? await instructionsForTelegram(b.code || "(expired)", inb.origin) : await instructionsForWhatsApp(b.code || "(expired)"));
      return { bridge: b, entry: null };
    }
    await unbridged(inb, cmd, arg);
    return { bridge: null, entry: null };
  }

  if (inb.side === "whatsapp" && b.whatsapp?.kind === "real") {
    b = (await updateBridge(b.id, (cur) => { if (cur.whatsapp) cur.whatsapp.lastInboundAt = now(); return cur; })) || b;
  }

  if (cmd) {
    if (cmd === "start" || cmd === "link") {
      await say(b, inb.side, inb.key, `Already bridged with ${describeEnd(b, other(inb.side))}. Send /status for details.`);
      return { bridge: b, entry: null };
    }
    if (await command(b, inb, cmd, arg)) return { bridge: b, entry: null };
  }

  if (b.settings.paused) {
    const note = await store().setJSON(`seen/pausenote/${b.id}/${Math.floor(Date.now() / 600_000)}`, 1, { onlyIfNew: true });
    if (note.modified) await say(b, inb.side, inb.key, "Forwarding is paused, so this wasn't sent. Send /resume to continue.");
    return { bridge: b, entry: null };
  }
  if (b.kind === "real") await rateLimit(`relay:${b.id}`, 300, 86400, "This bridge reached its daily limit of 300 messages.");
  if (!text && !inb.media) return { bridge: b, entry: null };
  const entry = await relay(b, inb);
  return { bridge: b, entry };
}

/** Twilio delivery receipts: queued → sent → delivered → read, or failed/undelivered. */
export async function deliveryStatus(bridgeId: string, entryId: string, status: string, errorCode: string | null) {
  const map: Record<string, Status> = { queued: "queued", accepted: "queued", sending: "queued", sent: "sent", delivered: "delivered", read: "read", failed: "failed", undelivered: "failed" };
  const s = map[status];
  if (!s) return;
  const rank: Record<Status, number> = { queued: 0, received: 0, sent: 1, delivered: 2, read: 3, failed: 4 };
  const log = await readLog(bridgeId);
  const cur = log.find((e) => e.id === entryId);
  if (!cur || (rank[s] <= rank[cur.status] && s !== "failed")) return;
  const error = s === "failed" ? friendlyError(new TwilioError(Number(errorCode) || 0, `delivery failed (${errorCode || "unknown"})`)) : null;
  await patchLog(bridgeId, entryId, { status: s, error });
  if (s === "failed" && cur.kind === "relay") {
    const b = await getBridge(bridgeId);
    if (b?.telegram && cur.from === "telegram") await say(b, "telegram", b.telegram.chatId, `Couldn't deliver to WhatsApp: ${error}`);
  }
}

