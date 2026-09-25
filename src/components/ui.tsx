import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Link, NavLink } from "react-router-dom";
import { useToasts } from "../lib/toast";
import { getSession } from "../lib/api";

const P: Record<string, ReactNode> = {
  plane: <path d="M21 4 3 11l6.5 2.5L18 7l-7 8 .5 5.5 3-4 4 3z" />,
  chat: <><path d="M4 19.5 5.4 15A8 8 0 1 1 9 18.6Z" /><path d="M9.5 9.5c.3 1.6 1.9 3.4 3.8 4.1l1.2-1.1 1.8.8-.4 1.5c-3.4.2-7.3-3.2-7.4-6.5l1.5-.5.9 1.6Z" /></>,
  bridge: <><path d="M2 16h20M4 16V8M20 16V8M4 8q8 9 16 0M8 16v-3.6M12 16v-2.6M16 16v-3.6" /></>,
  spark: <path d="M12 3c.6 4.2 2.8 6.4 7 7-4.2.6-6.4 2.8-7 7-.6-4.2-2.8-6.4-7-7 4.2-.6 6.4-2.8 7-7Z" />,
  shield: <path d="M12 3 5 6v5c0 4.5 3 8.2 7 10 4-1.8 7-5.5 7-10V6z" />,
  image: <><rect x="3.5" y="4.5" width="17" height="15" /><circle cx="9" cy="10" r="1.8" /><path d="m4 18 5.5-5 3.5 3 2.5-2 4.5 4" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  checks: <path d="m2 12.5 4.5 4.5L16 7.5M10 16l1 1 9.5-9.5" />,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  globe: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.6 3.5 5.5 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.5-3.5-8.5s1-5.9 3.5-8.5" /></>,
  pause: <path d="M8 5v14M16 5v14" />,
  send: <path d="M4 12 20 4l-4 16-4-6.5z M12 13.5 20 4" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  arrow: <path d="M5 12h14m0 0-5-5m5 5-5 5" />,
  copy: <><rect x="8" y="8" width="12" height="12" /><path d="M16 8V4H4v12h4" /></>,
  db: <><ellipse cx="12" cy="6" rx="7" ry="2.8" /><path d="M5 6v12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8" /></>,
  key: <><circle cx="8" cy="12" r="3.5" /><path d="M11.5 12H21m-3 0v3m-3-3v2" /></>,
  bolt: <path d="M13 3 5 13.5h6L10 21l8-10.5h-6Z" />,
  list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  play: <path d="M7 5v14l11-7z" />,
  reset: <path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v5h5" />,
};

export function Icon({ name, size = 18, stroke = 1.7 }: { name: string; size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {P[name]}
    </svg>
  );
}

export function Logo() {
  return (
    <Link to="/" className="logo" aria-label="CrossBridge home">
      <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true" fill="none" strokeLinecap="round">
        <path d="M3 22h26" stroke="#eaf3ff" strokeWidth="2" />
        <path d="M7 22V9M25 22V9" stroke="#eaf3ff" strokeWidth="2" />
        <path d="M7 9q9 11 18 0" stroke="#ffb020" strokeWidth="2" />
        <circle cx="7" cy="9" r="2.4" fill="#2aabee" />
        <circle cx="25" cy="9" r="2.4" fill="#25d366" />
      </svg>
      CrossBridge
    </Link>
  );
}

export function Nav() {
  const signedIn = Boolean(getSession());
  return (
    <nav className="nav">
      <Logo />
      <div className="nav__links">
        <NavLink to="/simulator">Simulator</NavLink>
        <NavLink to="/connect" className="hide-sm">Connect</NavLink>
        <NavLink to="/setup" className="hide-sm">Setup</NavLink>
        <NavLink to="/dashboard">{signedIn ? "Dashboard" : "Sign in"}</NavLink>
      </div>
    </nav>
  );
}

export function TitleBlock({ sheet }: { sheet: string }) {
  return (
    <>
      <div className="titleblock" aria-label="Project information">
        <div>Project<b>CrossBridge · Telegram ⇄ WhatsApp</b></div>
        <div>Drawn by<b><a href="https://nishant-singhaa0240274.netlify.app" target="_blank" rel="noreferrer">Nishant Singh</a></b></div>
        <div>Sheet<b>{sheet}</b></div>
        <div>Source<b><a href="https://github.com/NishantSingh00001/crossbridge" target="_blank" rel="noreferrer">GitHub</a></b></div>
      </div>
      <footer className="footer"><span>Hono · TypeScript · Netlify Functions · Blobs · Telegram Bot API · Twilio · Gemini</span><span>© 2026</span></footer>
    </>
  );
}

export function Panel({ fig, className = "", children }: { fig?: string; className?: string; children: ReactNode }) {
  return (
    <div className={`panel corners ${className}`} data-fig={fig || undefined}>
      <span className="c tl" /><span className="c tr" /><span className="c bl" /><span className="c br" />
      {children}
    </div>
  );
}

export function Toasts() {
  const list = useToasts();
  return createPortal(
    <div className="toasts" role="status" aria-live="polite">
      <AnimatePresence>
        {list.map((t) => (
          <motion.div key={t.id} className={`toast ${t.kind === "error" ? "toast--error" : ""}`} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}>
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>,
    document.body,
  );
}

export const StatusChip = ({ status }: { status: string }) => (
  <span className={`chip st-${status}`} title={`Status: ${status}`}><i />{status}</span>
);

export const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
