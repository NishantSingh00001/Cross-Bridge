import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Icon, Nav, Panel, TitleBlock } from "../components/ui";
import { BridgeDrawing } from "../components/Drawing";
import { api } from "../lib/api";
import { useHealth } from "../lib/config";

interface Stats { bridges: number; messages: number; simMessages: number; days: { day: string; messages: number }[] }

const STAGES: [string, string, string][] = [
  ["key", "Verify", "Telegram secret token or Twilio HMAC signature, and duplicates dropped"],
  ["list", "Route", "Find the bridge for this chat or number, or pair with a code"],
  ["bolt", "Commands", "/status, /summary, /translate, /pause, /login, /unlink"],
  ["image", "Media", "Photos, voice notes and files copied to Blobs and re-served"],
  ["globe", "Translate", "Gemini translates into the receiver's language, if set"],
  ["checks", "Deliver", "Sent through the other API; receipts update the log"],
];

const FEATURES: [string, string, string][] = [
  ["plane", "Both directions", "Messages from a Telegram chat or group appear on WhatsApp with the sender's name, and replies come straight back."],
  ["image", "Photos, voice & files", "Media is downloaded from one platform, stored for a week in Netlify Blobs and handed to the other by URL."],
  ["checks", "Delivery receipts", "Twilio status callbacks move each message from queued to sent, delivered and read. Failures are explained in plain words."],
  ["globe", "AI translation", "Set a language per side with /translate hi and Gemini translates everything that side receives, keeping emojis and names."],
  ["spark", "Summaries", "Send /summary in either chat for a short Gemini recap of decisions and open questions."],
  ["shield", "Secure by default", "Signed webhooks, one-time pairing codes, masked phone numbers, rate limits and a one-time sign-in link for the dashboard."],
];

export default function Landing() {
  const [stats, setStats] = useState<Stats | null>(null);
  const { health } = useHealth();
  useEffect(() => { api<Stats>("/api/stats").then(setStats).catch(() => null); }, []);
  const max = Math.max(1, ...(stats?.days.map((d) => d.messages) || [1]));
  const live = health?.telegram.configured && health.whatsapp.configured;

  return (
    <>
      <Nav />
      <header className="hero">
        <div className="hero__grid">
          <div>
            <motion.span className="label" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>Sheet 01 · General arrangement</motion.span>
            <motion.h1 initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }}>
              Telegram <span className="arrows">⇄</span> WhatsApp, in real time.
            </motion.h1>
            <motion.p className="lead" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.6 }}>
              CrossBridge links a Telegram chat with a WhatsApp number. Text, photos and voice notes cross both ways in about a second, with delivery receipts, AI translation and summaries.
            </motion.p>
            <motion.div className="hero__cta" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
              <Link to="/simulator" className="btn btn--solid"><Icon name="play" /> Try the simulator</Link>
              <Link to="/connect" className="btn">Connect your chats <Icon name="arrow" /></Link>
            </motion.div>
            <div className="spec">
              <span>Telegram <b className={health?.telegram.configured ? "wa" : ""}>{health ? (health.telegram.configured ? "online" : "not set up") : "…"}</b></span>
              <span>WhatsApp <b className={health?.whatsapp.configured ? "wa" : ""}>{health ? (health.whatsapp.configured ? "online" : "not set up") : "…"}</b></span>
              <span>Gemini <b className={health?.ai ? "wa" : ""}>{health ? (health.ai ? "online" : "off") : "…"}</b></span>
            </div>
          </div>
          <BridgeDrawing />
        </div>
      </header>

      <div className="section" style={{ paddingTop: 10, paddingBottom: 10 }}>
        <div className="stats">
          <div><div className="label">Bridges built</div><div className="stat__n">{stats?.bridges ?? "–"}</div></div>
          <div><div className="label">Messages relayed</div><div className="stat__n">{stats?.messages ?? "–"}</div></div>
          <div><div className="label">From the simulator</div><div className="stat__n">{stats?.simMessages ?? "–"}</div></div>
          <div>
            <div className="label">Last 14 days</div>
            <div className="spark" aria-label="Messages per day over the last 14 days">
              {(stats?.days || Array.from({ length: 14 }, () => ({ day: "", messages: 0 }))).map((d, i) => (
                <motion.i key={i} title={`${d.day}: ${d.messages}`} style={{ height: `${Math.max(4, (d.messages / max) * 100)}%` }} initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ delay: 0.3 + i * 0.03, duration: 0.5 }} />
              ))}
            </div>
          </div>
        </div>
      </div>

      <section className="section">
        <span className="label">Sheet 02 · Assembly</span>
        <h2 className="h2">Three steps to a bridge.</h2>
        <p className="lead2">No app to install. The bot does the pairing: a one-time code proves both chats belong together.</p>
        <div className="steps">
          {[
            ["Start on Telegram", "Add the bot to a group or open a chat with it and send /start. You get a code like CB-7K2PQ."],
            ["Send the code on WhatsApp", "Join the Twilio sandbox, then send the code to the same number. Both chats get “Bridge connected”."],
            ["Just talk", "Everything sent on one side now appears on the other. Use /help in either chat for commands."],
          ].map(([t, d], i) => (
            <motion.div key={t} initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-40px" }} transition={{ delay: i * 0.1 }}>
              <Panel fig={`STEP ${i + 1}`} className="step"><div className="step__n">0{i + 1}</div><h3>{t}</h3><p>{d}</p></Panel>
            </motion.div>
          ))}
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <span className="label">Sheet 03 · Section through the pipeline</span>
        <h2 className="h2">One pipeline, both directions.</h2>
        <p className="lead2">Every message, from either platform or from the simulator, goes through the same six stages in a Netlify Function. The simulator shows the timing of each stage.</p>
        <div className="pipeline">
          {STAGES.map(([icon, t, d], i) => (
            <motion.div key={t} className="stage" initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.07 }}>
              <div className="stage__dot"><span><Icon name={icon} size={22} /></span></div>
              <b>{t}</b>
              <span>{d}</span>
            </motion.div>
          ))}
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <span className="label">Sheet 04 · Specification</span>
        <h2 className="h2">What it handles.</h2>
        <div className="features">
          {FEATURES.map(([icon, t, d]) => (
            <div key={t} className="feature"><Icon name={icon} size={26} /><h3>{t}</h3><p>{d}</p></div>
          ))}
        </div>
        <div className="row" style={{ marginTop: 36 }}>
          <Link to="/simulator" className="btn btn--amber"><Icon name="play" /> Open the simulator</Link>
          {live ? <Link to="/connect" className="btn">Bridge your own chats</Link> : <Link to="/setup" className="btn">Deploy your own</Link>}
        </div>
      </section>

      <TitleBlock sheet="01 of 04" />
    </>
  );
}
