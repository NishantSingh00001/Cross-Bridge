import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Icon, Nav, Panel, StatusChip, TitleBlock, time } from "../components/ui";
import { api, ApiError, getSession, setSession } from "../lib/api";
import { toast } from "../lib/toast";
import { useHealth } from "../lib/config";
import { LANGUAGES, SIDE_LABEL, langName, type Bridge, type LogEntry, type Side } from "../../shared/types";

export default function Dashboard() {
  const session = getSession();
  const { health } = useHealth();
  const [bridges, setBridges] = useState<Bridge[] | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(!session);

  const loadList = useCallback(() => {
    api<{ bridges: Bridge[] }>("/api/me")
      .then((r) => { setBridges(r.bridges); setActive((a) => a && r.bridges.some((b) => b.id === a) ? a : r.bridges[0]?.id || null); })
      .catch((e) => { if ((e as ApiError).status === 401) { setSession(null); setSignedOut(true); } else toast(e.message, "error"); });
  }, []);
  useEffect(() => { if (session) loadList(); }, [loadList]); // eslint-disable-line react-hooks/exhaustive-deps

  if (signedOut) {
    return (
      <>
        <Nav />
        <main className="page" style={{ maxWidth: 760 }}>
          <span className="label">Dashboard</span>
          <h1 className="h2">Sign in with Telegram</h1>
          <Panel fig="NO PASSWORDS" className="panel--pad">
            <ol className="muted" style={{ margin: 0, paddingLeft: 20 }}>
              <li>Open {health?.telegram.username ? <a href={`https://t.me/${health.telegram.username}`} target="_blank" rel="noreferrer">@{health.telegram.username}</a> : "the CrossBridge bot"} in a private chat.</li>
              <li>Send <code>/login</code>. The bot replies with a sign-in link that works once, for 10 minutes.</li>
              <li>Open it here to see your bridges, their message log and delivery receipts, and change settings.</li>
            </ol>
          </Panel>
          <p className="small dim" style={{ marginTop: 18 }}>No bridge yet? <Link to="/connect">Connect your chats</Link> or <Link to="/simulator">try the simulator</Link>.</p>
        </main>
        <TitleBlock sheet="Dashboard" />
      </>
    );
  }

  return (
    <>
      <Nav />
      <main className="page" style={{ maxWidth: 1280 }}>
        <div className="row">
          <div>
            <span className="label">Dashboard · signed in as {session?.user.name}</span>
            <h1 className="h2" style={{ margin: "8px 0 0" }}>Your bridges</h1>
          </div>
          <span className="spacer" />
          <button className="btn btn--sm" onClick={() => { setSession(null); setSignedOut(true); }}>Sign out</button>
        </div>
        {bridges === null ? <div className="row" style={{ marginTop: 30 }}><span className="spinner" /> Loading…</div> : bridges.length === 0 ? (
          <Panel fig="EMPTY" className="panel--pad" >
            <p className="muted" style={{ margin: 0 }}>You haven't linked a bridge from Telegram yet. <Link to="/connect">Connect your chats</Link>, then come back.</p>
          </Panel>
        ) : (
          <div className="dash">
            <div className="blist">
              {bridges.map((b) => (
                <button key={b.id} className={`bcard ${active === b.id ? "on" : ""}`} onClick={() => setActive(b.id)}>
                  <b>{b.settings.name || b.telegram?.title || "Bridge"}</b>
                  <div className="small muted">{b.telegram ? b.telegram.title : "Telegram pending"} ⇄ {b.whatsapp ? b.whatsapp.number : "WhatsApp pending"}</div>
                  <div className="row small dim" style={{ marginTop: 6 }}>
                    <span>{b.stats.relayed} relayed</span>
                    {b.settings.paused && <span className="chip st-queued">paused</span>}
                    {(!b.telegram || !b.whatsapp) && <span className="chip st-sent">waiting for {b.telegram ? "WhatsApp" : "Telegram"}</span>}
                  </div>
                </button>
              ))}
            </div>
            {active && <BridgeDetail id={active} onGone={loadList} />}
          </div>
        )}
      </main>
      <TitleBlock sheet="Dashboard" />
    </>
  );
}

function BridgeDetail({ id, onGone }: { id: string; onGone: () => void }) {
  const [bridge, setBridge] = useState<Bridge | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [name, setName] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(() => api<{ bridge: Bridge; log: LogEntry[] }>(`/api/bridges/${id}`).then((r) => { setBridge(r.bridge); setLog(r.log); return r; }), [id]);
  useEffect(() => {
    load().then((r) => setName(r.bridge.settings.name)).catch((e) => toast(e.message, "error"));
    const t = setInterval(() => { if (!document.hidden) load().catch(() => null); }, 5000);
    return () => clearInterval(t);
  }, [load]);

  const save = async (patch: Record<string, unknown>) => {
    try {
      const r = await api<{ bridge: Bridge }>(`/api/bridges/${id}`, { method: "PATCH", body: patch });
      setBridge(r.bridge);
      toast("Saved");
    } catch (e) { toast((e as Error).message, "error"); }
  };
  const unlink = async () => {
    try { await api(`/api/bridges/${id}`, { method: "DELETE" }); toast("Bridge removed. Both chats were told."); onGone(); } catch (e) { toast((e as Error).message, "error"); }
  };

  if (!bridge) return <div className="row"><span className="spinner" /> Loading…</div>;
  const wa = bridge.whatsapp;
  const windowOpen = wa?.lastInboundAt ? Date.now() - Date.parse(wa.lastInboundAt) < 24 * 3600_000 : false;
  const entries = [...log].reverse();

  return (
    <motion.div key={id} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }}>
      <div className="ends">
        <div className="end tg"><span className="label">Telegram</span><b>{bridge.telegram?.title || "Not linked yet"}</b><span className="small dim">{bridge.telegram?.kind}</span></div>
        <Icon name="bridge" size={34} />
        <div className="end wa"><span className="label">WhatsApp</span><b>{wa?.number || "Not linked yet"}</b><span className="small dim">{wa ? (windowOpen ? "24-hour window open" : "window closed: they must message first") : ""}</span></div>
      </div>
      {bridge.code && <div className="notice" style={{ marginBottom: 18 }}>Waiting for the other side. Pairing code: <code>{bridge.code}</code> (expires {bridge.codeExpires ? time(bridge.codeExpires) : "soon"}).</div>}

      <Panel fig="SETTINGS" className="panel--pad">
        <div className="row" style={{ gap: 18, alignItems: "flex-end" }}>
          <label className="field" style={{ margin: 0, flex: "1 1 180px" }}><span>Name</span>
            <input className="input" value={name} maxLength={60} placeholder={bridge.telegram?.title || "Name this bridge"} onChange={(e) => setName(e.target.value)} onBlur={() => name !== bridge.settings.name && save({ name })} />
          </label>
          {(["telegram", "whatsapp"] as Side[]).map((s) => (
            <label key={s} className="field" style={{ margin: 0, flex: "1 1 160px" }}><span>Translate into, on {SIDE_LABEL[s]}</span>
              <select className="select" value={bridge.settings.translateTo[s] || ""} onChange={(e) => save({ translateTo: { [s]: e.target.value || null } })}>
                <option value="">Off</option>
                {LANGUAGES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
              </select>
            </label>
          ))}
        </div>
        <div className="row" style={{ marginTop: 16, gap: 22 }}>
          <label className="toggle"><input type="checkbox" checked={!bridge.settings.paused} onChange={(e) => save({ paused: !e.target.checked })} /> Forwarding on</label>
          <label className="toggle"><input type="checkbox" checked={bridge.settings.showSender} onChange={(e) => save({ showSender: e.target.checked })} /> Show sender names</label>
          <span className="spacer" />
          <span className="small dim mono">{bridge.stats.relayed} relayed · {bridge.stats.failed} failed · {bridge.stats.today} today</span>
          {confirm
            ? <><button className="btn btn--xs btn--danger" onClick={unlink}>Remove for good</button><button className="btn btn--xs" onClick={() => setConfirm(false)}>Cancel</button></>
            : <button className="btn btn--xs btn--danger" onClick={() => setConfirm(true)}>Unlink</button>}
        </div>
      </Panel>

      <div className="row" style={{ margin: "26px 0 10px" }}><span className="label">Message log · updates every 5 s</span></div>
      <div className="log">
        {entries.length === 0 && <p className="dim center" style={{ padding: 16, margin: 0 }}>No messages yet.</p>}
        {entries.map((e) => (
          <div key={e.id} className={`log__row ${e.kind}`} onClick={() => setOpen(open === e.id ? null : e.id)} style={{ cursor: "pointer" }}>
            <span className="mono small dim">{time(e.at)}</span>
            <span className={e.from === "telegram" ? "tg" : e.from === "whatsapp" ? "wa" : "dim"} title={`${e.from} → ${e.to}`}>{e.kind === "system" ? "◆" : e.from === "telegram" ? "→" : "←"}</span>
            <div>
              <div className="log__text">{e.kind === "relay" ? <><b>{e.sender}</b> · {e.text || (e.media ? "[media]" : "")}</> : <><span className="log__to">bot → {SIDE_LABEL[e.to]}</span>{e.text}</>}</div>
              {e.translated && <div className="small dim">🌐 {langName(e.translated.lang)}: {e.translated.text}</div>}
              {e.media && <div className="small"><a href={e.media.url} target="_blank" rel="noreferrer">{e.media.type}</a></div>}
              {e.error && <div className="log__err">{e.error}</div>}
              {open === e.id && e.trace.length > 0 && <div className="trace__steps" style={{ marginTop: 6 }}>{e.trace.map((t, i) => <span key={i}>{t.step} <em>{t.ms} ms</em></span>)}</div>}
            </div>
            <StatusChip status={e.status} />
          </div>
        ))}
      </div>
    </motion.div>
  );
}
