// Telegram Bot API client and update parsing.
// TELEGRAM_BOT_TOKEN is required. TELEGRAM_API_BASE is only for tests (a local mock server).

import { env, HttpError } from "./env.ts";
import { hmac, b64url } from "./crypto.ts";

const base = () => (env("TELEGRAM_API_BASE") || "https://api.telegram.org").replace(/\/+$/, "");
export const telegramToken = () => env("TELEGRAM_BOT_TOKEN") || null;
export const telegramConfigured = () => Boolean(telegramToken());

export class TelegramError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

export async function tg<T = any>(method: string, params: Record<string, unknown>, timeoutMs = 10000): Promise<T> {
  const token = telegramToken();
  if (!token) throw new HttpError(503, "Telegram isn't configured (TELEGRAM_BOT_TOKEN).");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base()}/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(params), signal: ctrl.signal });
    const data = (await res.json().catch(() => null)) as { ok: boolean; result: T; description?: string; error_code?: number } | null;
    if (!data?.ok) throw new TelegramError(data?.error_code || res.status, data?.description || `Telegram ${method} failed (${res.status})`);
    return data.result;
  } finally {
    clearTimeout(t);
  }
}

/** The secret Telegram sends back in X-Telegram-Bot-Api-Secret-Token, derived from the bot token. */
export async function webhookSecret(): Promise<string> {
  const token = telegramToken();
  if (!token) return "";
  return b64url(await hmac("SHA-256", token, "crossbridge-telegram-webhook")).slice(0, 48);
}

let me: { username: string; id: number; at: number } | null = null;
export async function botUsername(): Promise<string | null> {
  if (!telegramConfigured()) return null;
  if (me && Date.now() - me.at < 3600_000) return me.username;
  try {
    const r = await tg<{ id: number; username: string }>("getMe", {}, 4000);
    me = { username: r.username, id: r.id, at: Date.now() };
    return r.username;
  } catch {
    return me?.username || null;
  }
}

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---------------------------------------------------------------- updates

export interface TgInbound {
  updateId: number;
  chatId: string;
  chatType: "private" | "group" | "supergroup" | "channel";
  chatTitle: string;
  fromId: string;
  fromName: string;
  messageId: number;
  text: string;
  media: { fileId: string; type: "photo" | "document" | "voice" | "audio" | "video"; mime: string; size: number; name: string } | null;
  isBot: boolean;
  edited: boolean;
}

export function parseUpdate(u: any): TgInbound | null {
  const m = u?.message || u?.edited_message;
  if (!m?.chat) return null;
  const from = m.from || {};
  const name = [from.first_name, from.last_name].filter(Boolean).join(" ") || from.username || "Someone";
  let media: TgInbound["media"] = null;
  if (Array.isArray(m.photo) && m.photo.length) {
    const best = [...m.photo].filter((p: any) => !p.file_size || p.file_size <= 5_000_000).pop() || m.photo[0];
    media = { fileId: best.file_id, type: "photo", mime: "image/jpeg", size: best.file_size || 0, name: "photo.jpg" };
  } else if (m.document) {
    media = { fileId: m.document.file_id, type: "document", mime: m.document.mime_type || "application/octet-stream", size: m.document.file_size || 0, name: m.document.file_name || "file" };
  } else if (m.voice) {
    media = { fileId: m.voice.file_id, type: "voice", mime: m.voice.mime_type || "audio/ogg", size: m.voice.file_size || 0, name: "voice.ogg" };
  } else if (m.video) {
    media = { fileId: m.video.file_id, type: "video", mime: m.video.mime_type || "video/mp4", size: m.video.file_size || 0, name: "video.mp4" };
  }
  return {
    updateId: Number(u.update_id),
    chatId: String(m.chat.id),
    chatType: m.chat.type,
    chatTitle: m.chat.title || name,
    fromId: String(from.id ?? ""),
    fromName: name,
    messageId: Number(m.message_id),
    text: String(m.text ?? m.caption ?? ""),
    media,
    isBot: Boolean(from.is_bot),
    edited: Boolean(u?.edited_message),
  };
}

/** Downloads a file the bot received (up to 5 MB). */
export async function downloadFile(fileId: string): Promise<{ data: ArrayBuffer; mime: string } | null> {
  const f = await tg<{ file_path?: string; file_size?: number }>("getFile", { file_id: fileId });
  if (!f.file_path || (f.file_size && f.file_size > 5_000_000)) return null;
  const res = await fetch(`${base()}/file/bot${telegramToken()}/${f.file_path}`);
  if (!res.ok) return null;
  return { data: await res.arrayBuffer(), mime: res.headers.get("content-type") || "application/octet-stream" };
}

export async function sendText(chatId: string, html: string): Promise<number> {
  const r = await tg<{ message_id: number }>("sendMessage", { chat_id: chatId, text: html.slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true });
  return r.message_id;
}

export async function sendMedia(chatId: string, url: string, mime: string, captionHtml: string): Promise<number> {
  const method = mime.startsWith("image/") ? "sendPhoto" : mime.startsWith("audio/ogg") ? "sendVoice" : mime.startsWith("video/") ? "sendVideo" : "sendDocument";
  const field = method === "sendPhoto" ? "photo" : method === "sendVoice" ? "voice" : method === "sendVideo" ? "video" : "document";
  const r = await tg<{ message_id: number }>(method, { chat_id: chatId, [field]: url, caption: captionHtml.slice(0, 1000), parse_mode: "HTML" });
  return r.message_id;
}

export const COMMANDS = [
  { command: "start", description: "Get a code to bridge this chat with WhatsApp" },
  { command: "link", description: "Link with a code from WhatsApp: /link CB-XXXXX" },
  { command: "status", description: "Show this bridge's status" },
  { command: "summary", description: "AI summary of recent messages" },
  { command: "translate", description: "Translate incoming messages: /translate hi (or off)" },
  { command: "pause", description: "Pause forwarding" },
  { command: "resume", description: "Resume forwarding" },
  { command: "login", description: "Get a sign-in link for the web dashboard" },
  { command: "unlink", description: "Disconnect this bridge" },
  { command: "help", description: "How CrossBridge works" },
];
