import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Icon, Nav, Panel, TitleBlock } from "../components/ui";
import { useHealth } from "../lib/config";

/** A QR code as inline SVG (the library is loaded only on this page). */
function Qr({ text, label }: { text: string; label: string }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    let live = true;
    import("qrcode-generator").then(({ default: qrcode }) => {
      const q = qrcode(0, "M");
      q.addData(text);
      q.make();
      if (live) setSvg(q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }));
    });
    return () => { live = false; };
  }, [text]);
  return <div className="qr" role="img" aria-label={label} dangerouslySetInnerHTML={{ __html: svg }} />;
}

export default function Connect() {
  const { health } = useHealth();
  const bot = health?.telegram.username;
  const num = health?.whatsapp.number;
  const kw = health?.whatsapp.keyword;
  const waJoin = num ? `https://wa.me/${num.replace(/\D/g, "")}?text=${encodeURIComponent(kw ? `join ${kw}` : "hi")}` : "";
  const tgLink = bot ? `https://t.me/${bot}?start=connect` : "";
  const ready = health?.telegram.configured && health?.whatsapp.configured;

  return (
    <>
      <Nav />
      <main className="page">
        <span className="label">Sheet 03 · Connection details</span>
        <h1 className="h2">Bridge your own chats</h1>
        <p className="lead2">Pair a Telegram chat with your WhatsApp in about a minute. Messages you send on one appear on the other.</p>
        {health && !ready && (
          <div className="notice" style={{ marginTop: 24 }}>
            <Icon name="bolt" /> <span>This deployment isn't connected to {!health.telegram.configured ? "Telegram" : ""}{!health.telegram.configured && !health.whatsapp.configured ? " or " : ""}{!health.whatsapp.configured ? "WhatsApp" : ""} yet. You can still <Link to="/simulator">try the simulator</Link>, or see <Link to="/setup">how to set it up</Link>.</span>
          </div>
        )}
        <div className="connect">
          <Panel fig="SIDE A · TELEGRAM">
            <h3 className="tg"><Icon name="plane" size={24} /> Telegram</h3>
            <ol>
              <li>Open {bot ? <a href={tgLink} target="_blank" rel="noreferrer"><b>@{bot}</b></a> : <b>the bot</b>} and press <b>Start</b>. To bridge a group, add the bot to the group and send <code>/start</code> there.</li>
              <li>The bot replies with a code like <code>CB-7K2PQ</code>.</li>
            </ol>
            {bot ? (
              <div className="row" style={{ alignItems: "flex-start", gap: 18 }}>
                <Qr text={tgLink} label="QR code to open the Telegram bot" />
                <div style={{ flex: 1, minWidth: 180 }}>
                  <p className="small muted" style={{ marginTop: 0 }}>Scan with your phone's camera, or:</p>
                  <a className="btn btn--tg btn--sm" href={tgLink} target="_blank" rel="noreferrer">Open @{bot}</a>
                </div>
              </div>
            ) : <p className="dim small">Bot not configured.</p>}
          </Panel>

          <Panel fig="SIDE B · WHATSAPP">
            <h3 className="wa"><Icon name="chat" size={24} /> WhatsApp</h3>
            <ol>
              <li>{kw ? <>Send <code>join {kw}</code> to <b>{num}</b>. This joins the Twilio sandbox that CrossBridge uses (WhatsApp requires it for test numbers).</> : <>Message <b>{num || "the bridge number"}</b> on WhatsApp.</>}</li>
              <li>Then send the code from Telegram to the same number. Both chats will say <b>Bridge connected</b>.</li>
            </ol>
            {num ? (
              <div className="row" style={{ alignItems: "flex-start", gap: 18 }}>
                <Qr text={waJoin} label="QR code to open WhatsApp with the join message" />
                <div style={{ flex: 1, minWidth: 180 }}>
                  <p className="small muted" style={{ marginTop: 0 }}>Scan to open WhatsApp with the message ready, or:</p>
                  <a className="btn btn--wa btn--sm" href={waJoin} target="_blank" rel="noreferrer">Open WhatsApp</a>
                </div>
              </div>
            ) : <p className="dim small">WhatsApp not configured.</p>}
          </Panel>
        </div>

        <Panel fig="NOTES" className="panel--pad" >
          <ul className="muted" style={{ margin: 0, paddingLeft: 20 }}>
            <li>Starting from WhatsApp works too: send <code>link</code> to the number and use <code>/link CB-XXXXX</code> on Telegram.</li>
            <li>WhatsApp only lets businesses reply within 24 hours of your last message there. If a message can't be delivered, the bot tells you on Telegram.</li>
            <li>In groups, the bot only sees all messages if its privacy mode is off (BotFather → <code>/setprivacy</code> → Disable).</li>
            <li>Send <code>/login</code> to the bot in a private chat to manage your bridges on the <Link to="/dashboard">dashboard</Link>.</li>
          </ul>
        </Panel>
      </main>
      <TitleBlock sheet="03 of 04" />
    </>
  );
}
