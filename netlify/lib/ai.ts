// Gemini features: translating relayed messages and summarising a bridge's recent history.

import { aiConfigured, generate } from "./gemini.ts";
import { langName, type LogEntry } from "../../shared/types.ts";

export { aiConfigured };

/** Translates chat text. Returns null when it's already in the target language or AI is off. */
export async function translate(text: string, to: string): Promise<{ text: string; from: string } | null> {
  if (!aiConfigured() || !text.trim()) return null;
  const { data } = await generate<{ text: string; source: string; same: boolean }>({
    system: "You translate chat messages between friends and colleagues. Keep the tone, slang, emojis, names, numbers and links exactly. Return only the translation. If the message is already in the target language, set same = true.",
    prompt: `Target language: ${langName(to)} (${to})\nMessage:\n${text.slice(0, 2000)}`,
    schema: { type: "OBJECT", properties: { text: { type: "STRING" }, source: { type: "STRING", description: "Name of the source language, e.g. English" }, same: { type: "BOOLEAN" } }, required: ["text", "source", "same"] },
    temperature: 0.2,
    maxOutputTokens: 1200,
    deadlineMs: 9000,
  });
  if (!data || data.same || !data.text?.trim()) return null;
  return { text: data.text.trim().slice(0, 3000), from: String(data.source || "").slice(0, 30) };
}

export async function summarize(entries: LogEntry[], lang: string | null): Promise<string> {
  const lines = entries.filter((e) => e.kind === "relay").slice(-40).map((e) => `[${e.at.slice(11, 16)}] ${e.sender} (${e.from}): ${e.text || (e.media ? "[media]" : "")}`);
  if (lines.length < 2) return "Not much to summarise yet.";
  const { text } = await generate({
    system: "You summarise a chat that is bridged between Telegram and WhatsApp. Write 2–5 short bullet lines starting with \"• \": decisions, questions still open, and anything someone needs to do. Plain text, no markdown.",
    prompt: `${lang ? `Write the summary in ${langName(lang)}.\n` : ""}Chat:\n${lines.join("\n")}`,
    temperature: 0.3,
    maxOutputTokens: 700,
    deadlineMs: 9000,
  });
  return (text || "").replace(/\*\*/g, "").slice(0, 1500);
}
