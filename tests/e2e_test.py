#!/usr/bin/env python3
"""End-to-end test of CrossBridge against mock Telegram, Twilio and Gemini services.

1. python3 tests/mock_services.py &
2. cp tests/e2e.env .env && netlify dev
3. python3 tests/e2e_test.py
"""
import base64, hashlib, hmac, json, re, sys, time, urllib.request
from urllib.parse import urlencode

B = "http://localhost:8888"
MOCK = "http://127.0.0.1:9998"
TG_TOKEN = "123456:TEST-TOKEN"
TW_TOKEN = "test-auth-token"
FAILED = []
# Unique ids per run: the local Blobs store keeps state (seen updates, bridges) between runs.
RUN = int(time.time()) % 100000
UPD = [RUN * 1000]
CHAT = 1_000_000 + RUN
NUM = f"+91{RUN:05d}43210"
USER = 5_000_000 + RUN  # a fresh Telegram user, so the dashboard only shows this run's bridge

def ok(c, msg):
    print(("PASS " if c else "FAIL ") + msg)
    if not c: FAILED.append(msg)

def req(method, url, body=None, headers=None, form=False):
    h = dict(headers or {})
    data = None
    if body is not None:
        if form:
            data = urlencode(body).encode(); h["content-type"] = "application/x-www-form-urlencoded"
        else:
            data = json.dumps(body).encode(); h["content-type"] = "application/json"
    r = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=60) as res:
            raw = res.read(); ct = res.headers.get("content-type", "")
            return res.status, (json.loads(raw) if "json" in ct and raw else raw)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try: return e.code, json.loads(raw)
        except Exception: return e.code, raw

def calls():
    return req("GET", MOCK + "/calls")[1]
def reset():
    req("POST", MOCK + "/reset", {})

secret = base64.urlsafe_b64encode(hmac.new(TG_TOKEN.encode(), b"crossbridge-telegram-webhook", hashlib.sha256).digest()).decode().rstrip("=")[:48]

def tg_update(chat_id, text=None, user=None, chat_type="private", title=None, photo=False, secret_=secret):
    UPD[0] += 1
    user = user or (USER, "Rahul", "K")
    msg = {"message_id": UPD[0], "chat": {"id": chat_id, "type": chat_type, **({"title": title} if title else {})}, "from": {"id": user[0], "first_name": user[1], "last_name": user[2]}}
    if photo: msg["photo"] = [{"file_id": "PHOTO1", "file_size": 70}]; msg["caption"] = text or ""
    else: msg["text"] = text
    return req("POST", B + "/api/webhooks/telegram", {"update_id": UPD[0], "message": msg}, {"x-telegram-bot-api-secret-token": secret_})

def tw_sign(path, params):
    url = B + path
    payload = "".join(k + params[k] for k in sorted(params))
    return base64.b64encode(hmac.new(TW_TOKEN.encode(), (url + payload).encode(), hashlib.sha1).digest()).decode()

SID = [RUN * 1000]
def wa_message(frm, text, name="Priya", media=False, bad_sig=False):
    SID[0] += 1
    p = {"From": f"whatsapp:{frm}", "To": "whatsapp:+14155238886", "Body": text, "ProfileName": name, "MessageSid": f"SMIN{SID[0]:08d}", "NumMedia": "0"}
    if media: p.update({"NumMedia": "1", "MediaUrl0": MOCK + "/tw/media/ME1", "MediaContentType0": "image/png"})
    sig = "bad" if bad_sig else tw_sign("/api/webhooks/twilio", p)
    return req("POST", B + "/api/webhooks/twilio", p, {"x-twilio-signature": sig}, form=True)

def tw_status(sid, status, error=None):
    p = {"MessageSid": sid, "MessageStatus": status, **({"ErrorCode": error} if error else {})}
    return req("POST", B + "/api/webhooks/twilio/status", p, {"x-twilio-signature": tw_sign("/api/webhooks/twilio/status", p)}, form=True)

tg_msgs = lambda: [c for c in calls() if c["service"] == "telegram" and c["method"] in ("sendMessage", "sendPhoto", "sendDocument", "sendVoice")]
tw_msgs = lambda: [c["payload"] for c in calls() if c["service"] == "twilio"]

# ---- setup
s, h = req("GET", B + "/api/health")
ok(s == 200 and h["telegram"]["username"] == "CrossBridgeTestBot" and h["whatsapp"]["configured"] and h["ai"], f"health: bot @{h['telegram']['username']}, WhatsApp {h['whatsapp']['number']}, AI on")
s, r = req("POST", B + "/api/setup/telegram", {"token": "wrong"}); ok(s == 401, f"setup with the wrong bot token -> {s}")
s, r = req("POST", B + "/api/setup/telegram", {"token": TG_TOKEN}); ok(s == 200 and r["url"].endswith("/api/webhooks/telegram"), f"webhook registered: {r.get('url')}")
s, h = req("GET", B + "/api/health"); ok(h["webhook"]["set"], "health shows the webhook is set")
s, r = tg_update(CHAT, "hi", secret_="nope"); ok(s == 401, f"Telegram webhook without the secret -> {s}")
s, r = wa_message(NUM, "hi", bad_sig=True); ok(s == 401, f"Twilio webhook with a bad signature -> {s}")

# ---- pairing
reset()
tg_update(CHAT, "/start")
m = tg_msgs(); code = re.search(r"CB-[A-Z0-9]{5}", m[-1]["payload"]["text"]).group(0) if m else ""
ok(code and "join happy-tiger" in m[-1]["payload"]["text"], f"/start on Telegram replies with a pairing code {code} and sandbox instructions")
reset(); wa_message(NUM, "hello?")
ok(any("This is CrossBridge" in x["Body"] for x in tw_msgs()), "unknown WhatsApp number gets instructions")
reset(); wa_message(NUM, f"here is my code {code.lower()}")
ok(any("Bridge connected" in c["payload"]["text"] for c in tg_msgs()) and any("Bridge connected" in x["Body"] for x in tw_msgs()), "code sent on WhatsApp connects the bridge; both sides notified")

# ---- relay both ways
reset(); s, _ = tg_update(CHAT, "Hello from Telegram <3")
out = tw_msgs()
ok(len(out) == 1 and out[0]["Body"] == "*Rahul K* · Telegram\nHello from Telegram <3" and out[0]["To"] == f"whatsapp:{NUM}" and out[0]["StatusCallback"].endswith("/api/webhooks/twilio/status"), f"Telegram → WhatsApp: {out[0]['Body']!r}" if out else "Telegram → WhatsApp: nothing sent")
first_sid = None
reset(); UPD[0] -= 1; s, r = tg_update(CHAT, "Hello from Telegram <3"); ok(r.get("duplicate") and not tw_msgs(), "a retried Telegram update is ignored")
reset(); wa_message(NUM, "Hi from WhatsApp & friends")
t = tg_msgs(); ok(t and t[-1]["payload"]["text"] == "<b>Priya</b> <i>· WhatsApp</i>\nHi from WhatsApp &amp; friends" and t[-1]["payload"]["parse_mode"] == "HTML", f"WhatsApp → Telegram (HTML-escaped): {t[-1]['payload']['text']!r}" if t else "WhatsApp → Telegram: nothing sent")

# ---- media
reset(); wa_message(NUM, "photo!", media=True)
ph = [c for c in calls() if c["method"] == "sendPhoto"]
media_url = ph[0]["payload"]["photo"] if ph else ""
ok(ph and "/api/media/" in media_url and "photo!" in ph[0]["payload"]["caption"], "WhatsApp photo → Telegram sendPhoto via /api/media")
s, data = req("GET", media_url.replace("https://", "http://")); ok(s == 200 and isinstance(data, bytes) and data[:4] == b"\x89PNG", "media URL serves the image")
reset(); tg_update(CHAT, "screenshot", photo=True)
tw = tw_msgs(); ok(tw and "/api/media/" in tw[0].get("MediaUrl", "") and any(c["method"] == "getFile" for c in calls()), "Telegram photo → WhatsApp with MediaUrl")

# ---- translation
reset(); wa_message(NUM, "/translate hi")
ok(any("translated into Hindi" in x["Body"] for x in tw_msgs()), "/translate hi on WhatsApp confirmed")
reset(); tg_update(CHAT, "See you Friday")
tw = tw_msgs(); ok(tw and "[hi] See you Friday" in tw[0]["Body"] and "translated from English" in tw[0]["Body"], f"messages to WhatsApp are translated: {tw[0]['Body']!r}" if tw else "no translation sent")
wa_message(NUM, "/translate off")

# ---- commands
reset(); tg_update(CHAT, "/summary")
ok(any("MOCK summary" in c["payload"]["text"] for c in tg_msgs()) and any(c["service"] == "gemini" for c in calls()), "/summary uses Gemini")
reset(); tg_update(CHAT, "/status")
st = tg_msgs(); ok(st and "WhatsApp +91•••••3210" in st[-1]["payload"]["text"] and "window: open" in st[-1]["payload"]["text"], "/status shows the masked number and the 24-hour window")
reset(); tg_update(CHAT, "/pause")
ok(any("paused" in c["payload"]["text"] for c in tg_msgs()) and any("paused" in x["Body"] for x in tw_msgs()), "/pause notifies both sides")
reset(); wa_message(NUM, "are you there?")
ok(not tg_msgs() and any("paused" in x["Body"] for x in tw_msgs()), "while paused, nothing is forwarded and the sender is told once")
reset(); wa_message(NUM, "hello again?"); ok(not tw_msgs() and not tg_msgs(), "…and only once (no spam)")
tg_update(CHAT, "/resume")
reset(); tg_update(-555, "random chatter", chat_type="group", title="Other group"); ok(not tg_msgs(), "unbridged group chatter gets no reply")

# ---- delivery receipts
reset(); tg_update(CHAT, "receipt test")
sid = next((c["payload"] for c in calls() if c["service"] == "twilio"), {})
tw_list = [c for c in calls() if c["service"] == "twilio"]
# the mock returns SM<n>; read it back from the dashboard later
# ---- dashboard
reset(); tg_update(CHAT, "/login")
link = next((c["payload"]["text"] for c in tg_msgs() if "/login#" in c["payload"]["text"]), "")
token = link.split("/login#")[1].split()[0] if link else ""
ok(token, "/login sends a one-time dashboard link")
s, r = req("POST", B + "/api/auth/exchange", {"token": token}); session = r.get("token", "")
ok(s == 200 and session, "sign-in link exchanged for a session")
s, r2 = req("POST", B + "/api/auth/exchange", {"token": token}); ok(s == 401, f"sign-in links work only once -> {s}")
auth = {"authorization": f"Bearer {session}"}
s, me = req("GET", B + "/api/me", headers=auth)
bid = me["bridges"][0]["id"] if me.get("bridges") else ""
ok(s == 200 and len(me["bridges"]) == 1 and me["bridges"][0]["whatsapp"]["number"] == "+91•••••3210", "dashboard lists the bridge with the number masked")
s, d = req("GET", B + f"/api/bridges/{bid}", headers=auth)
relays = [e for e in d["log"] if e["kind"] == "relay"]
last = relays[-1]
ok(last["text"] == "receipt test" and last["status"] == "queued" and last["platformId"].startswith("SM") and len(last["trace"]) >= 3, f"log entry with platform id and pipeline trace: {[t['step'] for t in last['trace']]}")
tw_status(last["platformId"], "sent"); tw_status(last["platformId"], "delivered"); tw_status(last["platformId"], "sent")
s, d = req("GET", B + f"/api/bridges/{bid}", headers=auth)
ok([e for e in d["log"] if e["id"] == last["id"]][0]["status"] == "delivered", "Twilio receipts update the status (and never go backwards)")
reset(); tw_status(last["platformId"], "undelivered", "63016")
s, d = req("GET", B + f"/api/bridges/{bid}", headers=auth)
e = [e for e in d["log"] if e["id"] == last["id"]][0]
ok(e["status"] == "failed" and "24 hours" in (e["error"] or "") and any("24 hours" in c["payload"]["text"] for c in tg_msgs()), "failed delivery (outside 24h window) is explained on Telegram")
s, r = req("PATCH", B + f"/api/bridges/{bid}", {"name": "Family", "translateTo": {"telegram": "en"}}, headers=auth)
ok(s == 200 and r["bridge"]["settings"]["name"] == "Family" and r["bridge"]["settings"]["translateTo"]["telegram"] == "en", "settings saved from the dashboard")
s, r = req("PATCH", B + f"/api/bridges/{bid}", {"translateTo": {"telegram": "klingon"}}, headers=auth); ok(s == 400, f"invalid language rejected -> {s}")
s, r = req("GET", B + f"/api/bridges/{bid}"); ok(s == 401, f"dashboard API needs a session -> {s}")

# ---- a WhatsApp number that never joined the sandbox
reset(); tg_update(CHAT + 1, "/start", user=(USER + 1, "Anu", "S"))
code2 = re.search(r"CB-[A-Z0-9]{5}", tg_msgs()[-1]["payload"]["text"]).group(0)
wa_message(f"+91{RUN:05d}63015", code2, name="Ghost")
reset(); tg_update(CHAT + 1, "anyone?", user=(USER + 1, "Anu", "S"))
ok(any("hasn't joined the Twilio sandbox" in c["payload"]["text"] for c in tg_msgs()), "Twilio error is explained in plain words on Telegram")

# ---- unlink from the dashboard
reset(); s, r = req("DELETE", B + f"/api/bridges/{bid}", headers=auth)
ok(s == 200 and any("removed" in c["payload"]["text"] for c in tg_msgs()) and any("removed" in x["Body"] for x in tw_msgs()), "unlinking from the dashboard notifies both sides")
reset(); wa_message(NUM, "still there?")
ok(not tg_msgs() and any("This is CrossBridge" in x["Body"] for x in tw_msgs()), "after unlinking, messages are no longer forwarded")

# ---- simulator
s, sim = req("POST", B + "/api/sim", {}); sk = {"x-sim-key": sim.get("key", "")}; sid_ = sim.get("id")
ok(s == 201 and sid_, "simulator session created")
reset(); s, r = req("POST", B + f"/api/sim/{sid_}/send", {"side": "telegram", "sender": "Rahul", "text": "Meeting at 5?"}, sk)
e = r["log"][-1]
ok(s == 200 and e["from"] == "telegram" and e["to"] == "whatsapp" and e["status"] == "delivered" and e["delivered"].startswith("*Rahul* · Telegram") and not calls(), "simulator relays through the same pipeline (no real APIs called)")
req("PATCH", B + f"/api/sim/{sid_}", {"translateTo": {"telegram": "hi"}}, sk)
s, r = req("POST", B + f"/api/sim/{sid_}/send", {"side": "whatsapp", "sender": "Priya", "text": "Yes, 5 works"}, sk)
ok(r["log"][-1]["translated"] and "[hi] Yes, 5 works" in r["log"][-1]["delivered"], "simulator translation")
s, r = req("POST", B + f"/api/sim/{sid_}/send", {"side": "whatsapp", "sender": "Priya", "text": "/summary"}, sk)
ok(r["log"][-1]["kind"] == "system" and "MOCK summary" in r["log"][-1]["text"], "simulator commands (/summary)")
s, r = req("GET", B + f"/api/sim/{sid_}", headers={"x-sim-key": "wrong"}); ok(s == 401, f"simulator needs its key -> {s}")

s, st = req("GET", B + "/api/stats"); ok(s == 200 and st["messages"] >= 8 and len(st["days"]) == 14, f"stats: {st['messages']} messages relayed, {st['bridges']} bridges")
print()
print(f"{len(FAILED)} failed" if FAILED else "All end-to-end checks passed.")
sys.exit(1 if FAILED else 0)
