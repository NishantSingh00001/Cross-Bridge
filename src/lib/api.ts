// Fetch wrapper for the CrossBridge API.

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers || {}) };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const session = getSession();
  if (session && !headers.authorization) headers.authorization = `Bearer ${session.token}`;
  let res: Response;
  try {
    res = await fetch(path, { method: opts.method || (opts.body !== undefined ? "POST" : "GET"), headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  } catch {
    throw new ApiError(0, "You seem to be offline.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error || `Request failed (${res.status})`);
  return data as T;
}

export interface Session { token: string; user: { id: string; name: string } }
export function getSession(): Session | null {
  try { return JSON.parse(localStorage.getItem("cb.session") || "null"); } catch { return null; }
}
export function setSession(s: Session | null) {
  try { s ? localStorage.setItem("cb.session", JSON.stringify(s)) : localStorage.removeItem("cb.session"); } catch { /* ignore */ }
}
