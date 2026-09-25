import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Icon, Nav, Panel, StatusChip, TitleBlock, time } from "../components/ui";
import { Wire } from "../components/Drawing";
import { api, ApiError } from "../lib/api";
import { toast } from "../lib/toast";
import { useHealth } from "../lib/config";
import { LANGUAGES, SIDE_LABEL, langName, type Bridge, type LogEntry, type Side } from "../../shared/types";

interface Session { id: string; key: string }
const loadSim = (): Session | null => { try { return JSON.parse(localStorage.getItem("cb.sim") || "null"); } catch { return null; } };
const saveSim = (s: Session | null) => { try { s ? localStorage.setItem("cb.sim", JSON.stringify(s)) : localStorage.removeItem("cb.sim"); } catch { /* ignore */ } };

const NAMES: Record<Side, string> = { telegram: "Rahul", whatsapp: "Priya" };
const DEMO: { side: Side; text: string; translate?: { whatsapp: string | null } }[] = [
  { side: "telegram", text: "Hey Priya! Are we still on for the project review tomorrow? 🙂" },
  { side: "whatsapp", text: "Yes! 10 am works for me. Can you share the slides tonight?" },
  { side: "telegram", text: "Sure, sending them after dinner. The demo is finally working 🎉", translate: { whatsapp: "hi" } },
  { side: "whatsapp", text: "/summary" },
];

export default function Simulator() {
  const { health } = useHealth();
  const [sess, setSess] = useState<Session | null>(null);
  const [bridge, setBridge] = useState<Bridge | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState<Side | null>(null);
  const [pulse, setPulse] = useState<{ dir: "ltr" | "rtl"; n: number } | null>(null);
  const [lastMs, setLastMs] = useState<number | null>(null);
  const [demo, setDemo] = useState(false);

  const start = useCallback(async () => {
    const r = await api<{ id: string; key: string; bridge: Bridge }>("/api/sim", { body: {} });
    const s = { id: r.id, key: r.key };
    saveSim(s);
    setSess(s);
    setBridge(r.bridge);
    setLog([]);
  }, []);

  useEffect(() => {
    const s = loadSim();
    if (!s) { start().catch((e) => toast(e.message, "error")); return; }
    api<{ bridge: Bridge; log: LogEntry[] }>(`/api/sim/${s.id}`, { headers: { "x-sim-key": s.key } })
      .then((r) => { setSess(s); setBridge(r.bridge); setLog(r.log); })
      .catch(() => start().catch((e) => toast(e.message, "error")));
  }, [start]);

  const send = async (side: Side, text: string) => {
    if (!sess || !text.trim()) return;
    setBusy(side);
    try {
      const r = await api<{ bridge: Bridge; log: LogEntry[]; ms: number }>(`/api/sim/${sess.id}/send`, { body: { side, sender: NAMES[side], text }, headers: { "x-sim-key": sess.key } });
      setBridge(r.bridge);
      setLog(r.log);
      setLastMs(r.ms);
      const last = r.log[r.log.length - 1];
      if (last?.kind === "relay") setPulse((p) => ({ dir: side === "telegram" ? "ltr" : "rtl", n: (p?.n || 0) + 1 }));
    } catch (e) {
      if ((e as ApiError).status === 401) { await start(); toast("Your simulator session expired, so a new one started."); }
      else toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  const settings = async (patch: Record<string, unknown>) => {
    if (!sess) return;
    try {
      const r = await api<{ bridge: Bridge }>(`/api/sim/${sess.id}`, { method: "PATCH", body: patch, headers: { "x-sim-key": sess.key } });
      setBridge(r.bridge);
    } catch (e) { toast((e as Error).message, "error"); }
  };

  const playDemo = async () => {
    setDemo(true);
    try {
      for (const step of DEMO) {
        if (step.translate && health?.ai) await settings({ translateTo: step.translate });
        await send(step.side, step.text);
        await new Promise((r) => setTimeout(r, 900));
      }
    } finally {
      setDemo(false);
    }
  };

  const relays = log.filter((e) => e.kind === "relay").slice(-6).reverse();

  return (
    <>
      <Nav />
      <main className="sim">
        <div className="sim__top">
          <div>
            <span className="label">Sheet 02 · Live test rig</span>
            <h1 className="h2" style={{ margin: "8px 0 6px" }}>The simulator</h1>
            <p className="lead2">Two chats wired together through the real CrossBridge pipeline. Only the last hop is simulated: instead of calling Telegram and Twilio, delivery lands in the other phone.</p>
          </div>
          <div className="row">
            <button className="btn btn--amber" onClick={playDemo} disabled={demo || !bridge}><Icon name="play" /> {demo ? "Playing…" : "Play a demo"}</button>
            <button className="btn btn--sm" onClick={() => start().catch((e) => toast(e.message, "error"))} disabled={demo}><Icon name="reset" size={16} /> New session</button>
          </div>
        </div>

        {bridge && (
          <Panel fig="CONTROLS" className="panel--pad" >
            <div className="row" style={{ gap: 22, alignItems: "flex-end" }}>
              <label className="field" style={{ margin: 0, minWidth: 220 }}>
                <span>Translate into, on Telegram</span>
                <select className="select" value={bridge.settings.translateTo.telegram || ""} onChange={(e) => settings({ translateTo: { telegram: e.target.value || null } })} disabled={!health?.ai}>
                  <option value="">Off</option>
                  {LANGUAGES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
                </select>
              </label>
              <label className="field" style={{ margin: 0, minWidth: 220 }}>
                <span>Translate into, on WhatsApp</span>
                <select className="select" value={bridge.settings.translateTo.whatsapp || ""} onChange={(e) => settings({ translateTo: { whatsapp: e.target.value || null } })} disabled={!health?.ai}>
                  <option value="">Off</option>
                  {LANGUAGES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
                </select>
              </label>
              <label className="toggle"><input type="checkbox" checked={bridge.settings.showSender} onChange={(e) => settings({ showSender: e.target.checked })} /> Show sender names</label>
              <span className="spacer" />
              <span className="mono small dim">{lastMs != null ? `last relay: ${lastMs} ms` : "type in either phone"}</span>
            </div>
            {health && !health.ai && <p className="small dim" style={{ margin: "12px 0 0" }}>Translation and /summary need Gemini, which isn't switched on for this deployment.</p>}
          </Panel>
        )}

        <div className="sim__stage" style={{ marginTop: 30 }}>
          <Phone side="telegram" title="Project group" subtitle={`you are ${NAMES.telegram}`} log={log} busy={busy === "telegram"} onSend={(t) => send("telegram", t)} />
          <Wire pulse={pulse} />
          <Phone side="whatsapp" title="CrossBridge · Project group" subtitle={`you are ${NAMES.whatsapp}`} log={log} busy={busy === "whatsapp"} onSend={(t) => send("whatsapp", t)} />
        </div>

        <Panel fig="FIG. 5 · PIPELINE TRACE" className="trace">
          {relays.length === 0 && <p className="dim center" style={{ padding: 18, margin: 0 }}>Send a message to see each stage of the pipeline and how long it took. Try <code>/help</code>, <code>/status</code> or <code>/translate hi</code> too.</p>}
          {relays.map((e) => (
            <div key={e.id} className="trace__row">
              <span className="mono small dim">{time(e.at)}</span>
              <span className={e.from === "telegram" ? "tg" : "wa"}>{SIDE_LABEL[e.from as Side]} → {SIDE_LABEL[e.to]}</span>
              <div className="trace__steps">
                {e.trace.map((t, i) => <span key={i}>{t.step}{t.note ? ` · ${t.note}` : ""} <em>{t.ms} ms</em></span>)}
              </div>
              <StatusChip status={e.status} />
            </div>
          ))}
        </Panel>
        <p className="small dim" style={{ marginTop: 18 }}>Want the real thing? <Link to="/connect">Bridge your own Telegram and WhatsApp</Link>.</p>
      </main>
      <TitleBlock sheet="02 of 04" />
    </>
  );
}

function Phone({ side, title, subtitle, log, busy, onSend }: { side: Side; title: string; subtitle: string; log: LogEntry[]; busy: boolean; onSend: (t: string) => void }) {
  const [text, setText] = useState("");
  const body = useRef<HTMLDivElement>(null);
  const items = log.filter((e) => (e.kind === "relay" ? e.from === side || e.to === side : e.to === side));
  useLayoutEffect(() => { body.current?.scrollTo({ top: body.current.scrollHeight, behavior: "smooth" }); }, [items.length]);
  const submit = () => { const t = text.trim(); if (!t || busy) return; setText(""); onSend(t); };
  return (
    <section className={`phone phone--${side === "telegram" ? "tg" : "wa"}`} aria-label={`${SIDE_LABEL[side]} chat`}>
      <header className="phone__head">
        <span className="avatar"><Icon name={side === "telegram" ? "plane" : "chat"} size={18} /></span>
        <div><b>{title}</b><small>{SIDE_LABEL[side]} · {subtitle}</small></div>
      </header>
      <div className="phone__body" ref={body}>
        {items.length === 0 && <div className="bubble bot">Say hi from {SIDE_LABEL[side]}. It will appear on the other phone.</div>}
        <AnimatePresence initial={false}>
          {items.map((e) => {
            if (e.kind === "system") return <motion.div key={e.id} className="bubble bot" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>{e.text.replace(/\*([^*]+)\*/g, "$1")}</motion.div>;
            const mine = e.from === side;
            return (
              <motion.div key={e.id} className={`bubble ${mine ? "out" : "in"} ${e.status === "failed" ? "failed" : ""}`} initial={{ opacity: 0, y: 10, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 420, damping: 30 }}>
                {!mine && <span className="who">{e.sender} · {SIDE_LABEL[e.from as Side]}</span>}
                {mine ? e.text : e.translated?.text || e.text}
                {!mine && e.translated && <span className="tr">🌐 translated from {e.translated.from || "another language"} into {langName(e.translated.lang)}</span>}
                <span className="meta">{time(e.at)}{mine && <> · {e.status === "delivered" || e.status === "read" ? "✓✓" : e.status === "failed" ? "failed" : "✓"}</>}</span>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
      <div className="phone__compose">
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder={`Message as ${NAMES[side]}…`} aria-label={`Message from ${SIDE_LABEL[side]}`} maxLength={1000} />
        <button onClick={submit} disabled={busy || !text.trim()} aria-label="Send">{busy ? <span className="spinner" style={{ borderTopColor: "#fff", width: 16, height: 16 }} /> : <Icon name="send" size={18} />}</button>
      </div>
    </section>
  );
}
