// Shared types for CrossBridge: used by the API and the web app.

export type Side = "telegram" | "whatsapp";
export const other = (s: Side): Side => (s === "telegram" ? "whatsapp" : "telegram");
export const SIDE_LABEL: Record<Side, string> = { telegram: "Telegram", whatsapp: "WhatsApp" };

export interface TelegramEnd { chatId: string; title: string; kind: "private" | "group" | "sim"; linkedBy: string; linkedAt: string }
export interface WhatsAppEnd { number: string; name: string; kind: "real" | "sim"; linkedAt: string; lastInboundAt: string | null }

export interface BridgeSettings {
  name: string;
  paused: boolean;
  showSender: boolean;
  /** Translate messages going to this side into a language (ISO code), or null. */
  translateTo: Record<Side, string | null>;
}

export interface Bridge {
  id: string;
  kind: "real" | "sim";
  ownerTg: string | null; // Telegram user id of whoever linked the Telegram side
  createdAt: string;
  code: string | null; // pairing code while one side is still missing
  codeExpires: string | null;
  telegram: TelegramEnd | null;
  whatsapp: WhatsAppEnd | null;
  settings: BridgeSettings;
  stats: { relayed: number; failed: number; lastAt: string | null; day: string; today: number };
}

export type Status = "queued" | "sent" | "delivered" | "read" | "failed" | "received";

export interface TraceStep { step: string; ms: number; note?: string }

export interface LogEntry {
  id: string;
  at: string;
  kind: "relay" | "system";
  from: Side | "bot";
  to: Side;
  sender: string;
  text: string;
  delivered: string; // exactly what the other side received
  translated: { lang: string; from: string; text: string } | null;
  media: { url: string; type: string } | null;
  status: Status;
  error: string | null;
  platformId: string | null; // Telegram message_id or Twilio MessageSid of the forwarded copy
  trace: TraceStep[];
}

export const LANGUAGES: [string, string][] = [
  ["en", "English"], ["hi", "Hindi"], ["mr", "Marathi"], ["ta", "Tamil"], ["te", "Telugu"], ["bn", "Bengali"], ["gu", "Gujarati"],
  ["kn", "Kannada"], ["ml", "Malayalam"], ["pa", "Punjabi"], ["ur", "Urdu"], ["es", "Spanish"], ["fr", "French"], ["de", "German"],
  ["ar", "Arabic"], ["pt", "Portuguese"], ["ja", "Japanese"], ["zh", "Chinese"],
];
export const langName = (code: string | null) => LANGUAGES.find(([c]) => c === code)?.[1] || code || "";

export interface PublicConfig {
  telegram: { configured: boolean; username: string | null };
  whatsapp: { configured: boolean; number: string | null; keyword: string | null };
  ai: boolean;
}
