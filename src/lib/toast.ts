import { useSyncExternalStore } from "react";

export interface Toast { id: number; text: string; kind: "info" | "error" }
let list: Toast[] = [];
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
let n = 0;
export function toast(text: string, kind: Toast["kind"] = "info") {
  const id = ++n;
  list = [...list, { id, text, kind }].slice(-3);
  emit();
  setTimeout(() => { list = list.filter((t) => t.id !== id); emit(); }, kind === "error" ? 5000 : 2600);
}
export const useToasts = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => list);
