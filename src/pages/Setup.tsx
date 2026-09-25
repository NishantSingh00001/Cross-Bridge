import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Icon, Nav, Panel, TitleBlock } from "../components/ui";
import { api } from "../lib/api";
import { toast } from "../lib/toast";
import { useHealth } from "../lib/config";

function Check({ ok, title, children, action }: { ok: boolean | null; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={`check ${ok === null ? "" : ok ? "ok" : "bad"}`}>
      <span className="check__mark">{ok === null ? "…" : ok ? "✓" : "!"}</span>
      <div><b>{title}</b>{children && <div className="small muted">{children}</div>}</div>
      <div>{action}</div>
    </div>
  );
}

function Copy({ value }: { value: string }) {
  return (
    <div className="copy">
      <input className="input" readOnly value={value} onFocus={(e) => e.target.select()} aria-label="URL" />
      <button className="btn btn--sm" onClick={() => navigator.clipboard?.writeText(value).then(() => toast("Copied"))}><Icon name="copy" size={16} /></button>
    </div>
  );
}

export default function Setup() {
  const { health, reload } = useHealth();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const register = async () => {
    setBusy(true);
    try {
      const r = await api<{ url: string; bot: string }>("/api/setup/telegram", { body: { token } });
      toast(`Webhook set for @${r.bot}`);
      setToken("");
      reload();
    } catch (e) { toast((e as Error).message, "error"); } finally { setBusy(false); }
  };
  return (
    <>
      <Nav />
      <main className="page">
        <span className="label">Sheet 04 · Installation</span>
        <h1 className="h2">Setup checklist</h1>
        <p className="lead2">For the owner of this deployment. Everything is configured with environment variables in Netlify, plus two webhook URLs.</p>

        <div className="checks">
          <Check ok={health ? health.telegram.configured : null} title="Telegram bot token" >
            {health?.telegram.configured ? <>Connected to <b>@{health.telegram.username || "your bot"}</b>.</> : <>Create a bot with <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather</a> (<code>/newbot</code>) and add <code>TELEGRAM_BOT_TOKEN</code> in Netlify.</>}
          </Check>
          <Check ok={health ? Boolean(health.webhook?.set) : null} title="Telegram webhook">
            {health?.webhook?.set ? <>Telegram delivers updates to this site{health.webhook.pending ? ` (${health.webhook.pending} waiting)` : ""}.{health.webhook.lastError && <> Last error: {health.webhook.lastError}</>}</> : <>Paste your bot token below to point the bot at this site. It's checked against the token in Netlify and isn't stored.</>}
          </Check>
          <Check ok={health ? health.whatsapp.configured : null} title="Twilio WhatsApp">
            {health?.whatsapp.configured ? <>Sending from <b>{health.whatsapp.number}</b>{health.whatsapp.keyword ? <> · sandbox keyword <code>join {health.whatsapp.keyword}</code></> : null}.</> : <>Add <code>TWILIO_ACCOUNT_SID</code>, <code>TWILIO_AUTH_TOKEN</code>, <code>TWILIO_WHATSAPP_NUMBER</code> and <code>TWILIO_SANDBOX_KEYWORD</code>.</>}
          </Check>
          <Check ok={health ? health.ai : null} title="Gemini (optional)">
            {health?.ai ? <>Translation and summaries are on{health.model ? ` (${health.model})` : ""}.</> : <>Add <code>GEMINI_API_KEY</code> for translation and <code>/summary</code>.</>}
          </Check>
        </div>

        {health?.telegram.configured && (
          <Panel fig="STEP A · TELEGRAM WEBHOOK" className="panel--pad">
            <p className="muted" style={{ marginTop: 0 }}>Registers <code>{health.urls.telegram}</code> with Telegram, with a secret header, and adds the command menu (/start, /status, /summary…).</p>
            <div className="row">
              <input className="input" style={{ flex: 1, minWidth: 220 }} type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="123456789:AA…  (your bot token)" aria-label="Bot token" />
              <button className="btn btn--amber" disabled={busy || token.length < 20} onClick={register}>{busy ? <span className="spinner" /> : health.webhook?.set ? "Register again" : "Register webhook"}</button>
            </div>
          </Panel>
        )}

        <div style={{ height: 28 }} />
        <Panel fig="STEP B · TWILIO SANDBOX" className="panel--pad">
          <p className="muted" style={{ marginTop: 0 }}>In the Twilio Console open <b>Messaging → Try it out → Send a WhatsApp message → Sandbox settings</b>. Set <b>When a message comes in</b> (method POST) to:</p>
          <Copy value={health?.urls.twilio || "…"} />
          <p className="muted">and <b>Status callback URL</b> to:</p>
          <Copy value={health?.urls.twilioStatus || "…"} />
          <p className="small dim" style={{ marginBottom: 0 }}>Twilio signs every request with your auth token, and CrossBridge rejects anything without a valid signature.</p>
        </Panel>

        <div className="row" style={{ marginTop: 28 }}>
          <Link to="/connect" className="btn btn--solid">Next: connect your chats <Icon name="arrow" /></Link>
          <button className="btn btn--sm" onClick={reload}>Re-check</button>
        </div>
      </main>
      <TitleBlock sheet="04 of 04" />
    </>
  );
}
