import { motion } from "framer-motion";

// A suspension bridge drawn like a blueprint: Telegram tower on the left, WhatsApp on the right,
// messages travelling both ways along the deck.

const W = 720, DECK = 250, L = 162, R = 558, TOP = 95;
const sag = (x: number) => { const t = (x - L) / (R - L); return TOP + 470 * t * (1 - t); };
const hangers = Array.from({ length: 11 }, (_, i) => L + 36 + i * 32.4);

const draw = (delay: number, duration = 1.2) => ({
  initial: { pathLength: 0, opacity: 0 },
  animate: { pathLength: 1, opacity: 1 },
  transition: { pathLength: { delay, duration, ease: [0.3, 0.7, 0.2, 1] }, opacity: { delay, duration: 0.2 } },
});

/** An annotation: a dot on the drawing, a leader line through `via`, and a label at the end. */
function Callout({ at, via, text, delay, anchor = "start" }: { at: [number, number]; via: [number, number][]; text: string; delay: number; anchor?: "start" | "middle" | "end" }) {
  const [ex, ey] = via[via.length - 1];
  const tx = anchor === "start" ? ex + 6 : anchor === "end" ? ex - 6 : ex;
  const ty = anchor === "middle" ? ey - 6 : ey + 4;
  return (
    <motion.g className="callout" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay, duration: 0.5 }}>
      <circle cx={at[0]} cy={at[1]} r="3" fill="#ffb020" />
      <path d={`M${at[0]} ${at[1]} ${via.map(([x, y]) => `L${x} ${y}`).join(" ")}`} stroke="#ffb020" strokeWidth="1" fill="none" />
      <text x={tx} y={ty} textAnchor={anchor} fill="#ffcf73" fontFamily="Spline Sans Mono, monospace" fontSize="10.5" letterSpacing="1">{text}</text>
    </motion.g>
  );
}

export function BridgeDrawing() {
  const deck = `M40 ${DECK} H${W - 40}`;
  return (
    <svg className="drawing" viewBox={`0 0 ${W} 420`} role="img" aria-label="A blueprint of a bridge between Telegram and WhatsApp with messages crossing both ways">
      <defs>
        <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="#eaf3ff" /></marker>
      </defs>
      {/* dimension line */}
      <motion.path d={`M${L} 52 H${R}`} stroke="#eaf3ff" strokeWidth="1" markerStart="url(#arr)" markerEnd="url(#arr)" fill="none" {...draw(1.4, 0.8)} />
      <motion.path d={`M${L} 44 V70 M${R} 44 V70`} stroke="#eaf3ff" strokeOpacity=".6" strokeWidth="1" {...draw(1.3, 0.4)} />
      <motion.text x={(L + R) / 2} y="44" textAnchor="middle" fill="#bcd0e8" fontFamily="Spline Sans Mono, monospace" fontSize="11" letterSpacing="2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.9 }}>
        SPAN · BOT API ⇄ TWILIO API
      </motion.text>

      {/* water / datum */}
      <motion.path d={`M20 336 H${W - 20}`} stroke="#eaf3ff" strokeOpacity=".35" strokeDasharray="10 6" strokeWidth="1" {...draw(0.1, 1)} />
      {Array.from({ length: 6 }, (_, i) => (
        <motion.path key={i} d={`M${70 + i * 110} 356 q12 -6 24 0 t24 0`} stroke="#eaf3ff" strokeOpacity=".25" fill="none" strokeWidth="1" {...draw(0.3 + i * 0.05, 0.6)} />
      ))}

      {/* towers */}
      {[L, R].map((x, i) => (
        <g key={x}>
          <motion.path d={`M${x - 12} 336 V${TOP - 10} H${x + 12} V336`} stroke="#eaf3ff" strokeWidth="2" fill="rgba(234,243,255,0.04)" {...draw(0.2 + i * 0.1)} />
          <motion.path d={`M${x - 12} 150 H${x + 12} M${x - 12} 205 H${x + 12} M${x - 12} 150 L${x + 12} 205 M${x + 12} 150 L${x - 12} 205`} stroke="#eaf3ff" strokeOpacity=".5" strokeWidth="1" {...draw(0.6 + i * 0.1, 0.8)} />
          <motion.circle cx={x} cy={TOP - 32} r="17" fill={i ? "#25d366" : "#2aabee"} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 1 + i * 0.15, type: "spring", stiffness: 260, damping: 14 }} />
          {i === 0 ? (
            <motion.path d={`M${x - 8} ${TOP - 32} l16 -6 -4 13 -4 -4z`} fill="#fff" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.3 }} />
          ) : (
            <motion.path d={`M${x - 7} ${TOP - 23} l1.6 -4.2 a7.5 7.5 0 1 1 3 3z`} fill="none" stroke="#fff" strokeWidth="2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.45 }} />
          )}
          <motion.text x={x} y="380" textAnchor="middle" fill={i ? "#25d366" : "#2aabee"} fontFamily="Barlow Condensed, sans-serif" fontWeight="700" fontSize="20" letterSpacing="3" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.1 + i * 0.1 }}>
            {i ? "WHATSAPP" : "TELEGRAM"}
          </motion.text>
        </g>
      ))}

      {/* cable and hangers */}
      <motion.path d={`M40 ${DECK - 14} Q100 150 ${L} ${TOP} Q${(L + R) / 2} 330 ${R} ${TOP} Q620 150 ${W - 40} ${DECK - 14}`} stroke="#ffb020" strokeWidth="2.2" fill="none" {...draw(0.6, 1.6)} />
      {hangers.map((x, i) => (
        <motion.path key={x} d={`M${x} ${sag(x)} V${DECK}`} stroke="#eaf3ff" strokeOpacity=".6" strokeWidth="1" {...draw(1.2 + i * 0.04, 0.4)} />
      ))}

      {/* deck */}
      <motion.path d={deck} stroke="#eaf3ff" strokeWidth="2.5" fill="none" {...draw(0.4, 1.2)} />
      <motion.path d={`M40 ${DECK + 10} H${W - 40}`} stroke="#eaf3ff" strokeOpacity=".6" strokeWidth="1" fill="none" {...draw(0.5, 1.2)} />
      <path id="deck-ltr" d={`M40 ${DECK - 8} H${W - 40}`} fill="none" />
      <path id="deck-rtl" d={`M${W - 40} ${DECK + 18} H40`} fill="none" />

      {/* messages crossing */}
      <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2.2, duration: 0.6 }}>
      {[0, 1.6, 3.2].map((b) => (
        <g key={`l${b}`}>
          <rect x="-9" y="-6" width="18" height="12" rx="3" fill="#2aabee">
            <animateMotion dur="4.8s" begin={`${-b}s`} repeatCount="indefinite" rotate="0"><mpath href="#deck-ltr" /></animateMotion>
          </rect>
        </g>
      ))}
      {[0.8, 2.4, 4].map((b) => (
        <g key={`r${b}`}>
          <rect x="-9" y="-6" width="18" height="12" rx="3" fill="#25d366">
            <animateMotion dur="4.8s" begin={`${-b}s`} repeatCount="indefinite" rotate="0"><mpath href="#deck-rtl" /></animateMotion>
          </rect>
        </g>
      ))}
      </motion.g>

      {/* annotations sit in the clear space under the deck and above the cable */}
      <Callout at={[L + 12, 302]} via={[[L + 30, 302]]} text="SECRET-TOKEN WEBHOOK" delay={2.1} />
      <Callout at={[R - 12, 322]} via={[[R - 30, 322]]} text="SIGNED WEBHOOK" delay={2.3} anchor="end" />
      <Callout at={[360, sag(360)]} via={[[360, 150]]} text="GEMINI TRANSLATION" delay={2.5} anchor="middle" />
      <Callout at={[236, DECK + 10]} via={[[236, 284], [246, 284]]} text="NETLIFY BLOBS LOG" delay={2.7} />
    </svg>
  );
}

/** The link between the two phones in the simulator. `pulse` flips direction on each relay. */
export function Wire({ pulse }: { pulse: { dir: "ltr" | "rtl"; n: number } | null }) {
  return (
    <div className="wire" aria-hidden="true">
      <div className="wire__label label">RELAY</div>
      <svg viewBox="0 0 140 300" preserveAspectRatio="none">
        <path d="M0 150 H140" stroke="#eaf3ff" strokeOpacity=".5" strokeDasharray="6 5" />
        <path d="M0 150 Q70 95 140 150" stroke="#ffb020" strokeWidth="1.6" fill="none" />
        {pulse && (
          <motion.circle key={pulse.n} r="6" cy="150" fill={pulse.dir === "ltr" ? "#2aabee" : "#25d366"}
            initial={{ cx: pulse.dir === "ltr" ? 0 : 140, opacity: 1 }} animate={{ cx: pulse.dir === "ltr" ? 140 : 0, opacity: [1, 1, 0] }} transition={{ duration: 0.7, ease: "easeInOut" }} />
        )}
      </svg>
    </div>
  );
}
