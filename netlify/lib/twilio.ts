// Twilio WhatsApp: sending messages, verifying webhook signatures, reading media.
// Needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_WHATSAPP_NUMBER (the sandbox or
// business number, e.g. +14155238886). TWILIO_SANDBOX_KEYWORD is shown in instructions.
// TWILIO_API_BASE is only for tests (a local mock server).

import { env, HttpError } from "./env.ts";
import { b64, hmac, safeEqual } from "./crypto.ts";

const base = () => (env("TWILIO_API_BASE") || "https://api.twilio.com").replace(/\/+$/, "");
const sid = () => env("TWILIO_ACCOUNT_SID") || "";
const token = () => env("TWILIO_AUTH_TOKEN") || "";
export const waNumber = () => (env("TWILIO_WHATSAPP_NUMBER") || "").replace(/^whatsapp:/, "").replace(/[^\d+]/g, "") || null;
export const sandboxKeyword = () => (env("TWILIO_SANDBOX_KEYWORD") || "").replace(/^join\s+/i, "").trim() || null;
export const twilioConfigured = () => Boolean(sid() && token() && waNumber());

const auth = () => `Basic ${btoa(`${sid()}:${token()}`)}`;

/** "whatsapp:+919876543210" or "+91 98765 43210" → "+919876543210" */
export const normalizeNumber = (n: string) => {
  const digits = n.replace(/^whatsapp:/, "").replace(/[^\d]/g, "");
  return digits ? `+${digits}` : "";
};

export class TwilioError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

export async function sendWhatsApp(to: string, body: string, opts: { mediaUrl?: string; statusCallback?: string } = {}): Promise<{ sid: string; status: string }> {
  if (!twilioConfigured()) throw new HttpError(503, "WhatsApp isn't configured (Twilio settings).");
  const form = new URLSearchParams({ To: `whatsapp:${normalizeNumber(to)}`, From: `whatsapp:${waNumber()}`, Body: body.slice(0, 1550) });
  if (opts.mediaUrl) form.append("MediaUrl", opts.mediaUrl);
  if (opts.statusCallback) form.set("StatusCallback", opts.statusCallback);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(`${base()}/2010-04-01/Accounts/${sid()}/Messages.json`, {
      method: "POST",
      headers: { authorization: auth(), "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      signal: ctrl.signal,
    });
    const data = (await res.json().catch(() => null)) as { sid?: string; status?: string; code?: number; message?: string } | null;
    if (!res.ok || !data?.sid) throw new TwilioError(data?.code || res.status, data?.message || `Twilio returned ${res.status}`);
    return { sid: data.sid, status: data.status || "queued" };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Twilio signs each webhook: base64(HMAC-SHA1(authToken, url + sorted key/value pairs)).
 * https://www.twilio.com/docs/usage/security#validating-requests
 */
export async function validSignature(signature: string | null, urls: string[], params: URLSearchParams): Promise<boolean> {
  if (!signature || !token()) return false;
  const keys = [...new Set([...params.keys()])].sort();
  const payload = keys.map((k) => params.getAll(k).map((v) => k + v).join("")).join("");
  for (const url of urls) {
    const expected = b64(await hmac("SHA-1", token(), url + payload));
    if (safeEqual(expected, signature)) return true;
  }
  return false;
}

export interface WaInbound {
  sid: string;
  from: string; // +91...
  name: string;
  text: string;
  media: { url: string; type: string } | null;
}

export function parseInbound(p: URLSearchParams): WaInbound | null {
  const from = normalizeNumber(p.get("From") || "");
  const sidValue = p.get("MessageSid") || p.get("SmsMessageSid") || "";
  if (!from || !sidValue) return null;
  const n = Number(p.get("NumMedia") || 0);
  return {
    sid: sidValue,
    from,
    name: p.get("ProfileName") || from,
    text: p.get("Body") || "",
    media: n > 0 && p.get("MediaUrl0") ? { url: p.get("MediaUrl0")!, type: p.get("MediaContentType0") || "application/octet-stream" } : null,
  };
}

/** Twilio media URLs need the account's credentials. Returns null if too big or unavailable. */
export async function downloadMedia(url: string): Promise<{ data: ArrayBuffer; mime: string } | null> {
  const res = await fetch(url, { headers: { authorization: auth() }, redirect: "follow" });
  if (!res.ok) return null;
  const data = await res.arrayBuffer();
  if (data.byteLength > 5_000_000) return null;
  return { data, mime: res.headers.get("content-type") || "application/octet-stream" };
}

export const twiml = (message?: string) =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${message ? `<Message>${message.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</Message>` : ""}</Response>`, { headers: { "content-type": "text/xml" } });
