#!/usr/bin/env python3
"""Local stand-ins for the Telegram Bot API, Twilio and Gemini, for end-to-end tests.

    python3 tests/mock_services.py            # listens on 127.0.0.1:9998

Point the app at it with a .env file (see tests/e2e.env), run `netlify dev`, then
`python3 tests/e2e_test.py`. Every outgoing API call is recorded at GET /calls.
"""
import base64, json, re, threading, http.server, itertools
from urllib.parse import parse_qs, urlparse

CALLS = []
LOCK = threading.Lock()
IDS = itertools.count(100)
WEBHOOK = {"url": ""}
# 1x1 PNG
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")


CANNED = {
    ("hi", "Sure, sending them after dinner. The demo is finally working 🎉"): "ज़रूर, डिनर के बाद भेज दूँगा। डेमो आख़िरकार चल गया 🎉",
}
SUMMARY_EN = "• Project review is confirmed for 10 am tomorrow.\n• Rahul will send the slides tonight after dinner.\n• The demo is working now."
SUMMARY_HI = "• प्रोजेक्ट रिव्यू कल सुबह 10 बजे तय है।\n• राहुल आज रात डिनर के बाद स्लाइड्स भेजेंगे।\n• डेमो अब काम कर रहा है।"


class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def body(self):
        n = int(self.headers.get("content-length") or 0)
        return self.rfile.read(n) if n else b""

    def send(self, code, obj=None, raw=None, ctype="application/json"):
        data = raw if raw is not None else json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("content-type", ctype)
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def record(self, service, method, payload):
        with LOCK:
            CALLS.append({"service": service, "method": method, "payload": payload})

    def do_GET(self):
        p = urlparse(self.path).path
        if p == "/calls":
            with LOCK:
                return self.send(200, CALLS)
        if p.startswith("/tg/file/"):
            return self.send(200, raw=PNG, ctype="image/png")
        if p.startswith("/tw/media/"):
            auth = self.headers.get("authorization", "")
            if not auth.startswith("Basic "):
                return self.send(401, {"message": "auth required"})
            return self.send(200, raw=PNG, ctype="image/png")
        self.send(404, {"error": "not found"})

    def do_POST(self):
        p = urlparse(self.path).path
        raw = self.body()
        if p == "/reset":
            with LOCK:
                CALLS.clear()
            return self.send(200, {"ok": True})

        m = re.match(r"^/tg/bot([^/]+)/(\w+)$", p)
        if m:
            method = m.group(2)
            payload = json.loads(raw or b"{}")
            self.record("telegram", method, payload)
            if method == "getMe":
                return self.send(200, {"ok": True, "result": {"id": 777, "is_bot": True, "username": "CrossBridgeTestBot"}})
            if method == "getFile":
                return self.send(200, {"ok": True, "result": {"file_id": payload.get("file_id"), "file_path": "photos/file_1.png", "file_size": len(PNG)}})
            if method == "setWebhook":
                WEBHOOK["url"] = payload.get("url", "")
                return self.send(200, {"ok": True, "result": True})
            if method == "getWebhookInfo":
                return self.send(200, {"ok": True, "result": {"url": WEBHOOK["url"], "pending_update_count": 0}})
            if method in ("setMyCommands",):
                return self.send(200, {"ok": True, "result": True})
            if str(payload.get("chat_id")) == "-4040":
                return self.send(403, {"ok": False, "error_code": 403, "description": "Forbidden: bot was kicked from the group chat"})
            return self.send(200, {"ok": True, "result": {"message_id": next(IDS)}})

        m = re.match(r"^/tw/2010-04-01/Accounts/([^/]+)/Messages\.json$", p)
        if m:
            form = {k: v[0] if len(v) == 1 else v for k, v in parse_qs(raw.decode()).items()}
            self.record("twilio", "Messages", form)
            if str(form.get("To", "")).endswith("63015"):  # numbers ending in 63015 "never joined the sandbox"
                return self.send(400, {"code": 63015, "message": "Channel Sandbox can only send messages to phone numbers that have joined the Sandbox"})
            return self.send(201, {"sid": f"SM{next(IDS):030d}", "status": "queued"})

        m = re.match(r"^/gemini/v1beta/models/([^:]+):generateContent$", p)
        if m:
            body = json.loads(raw)
            prompt = body["contents"][0]["parts"][-1]["text"]
            self.record("gemini", m.group(1), {"prompt": prompt[:200]})
            props = ((body.get("generationConfig") or {}).get("responseSchema") or {}).get("properties", {})
            if "same" in props:
                target = re.search(r"\((\w+)\)", prompt).group(1)
                msg = prompt.split("Message:\n", 1)[1]
                # The simulator's demo line gets a real translation so screenshots look like production.
                text = CANNED.get((target, msg), f"[{target}] {msg}")
                out = json.dumps({"text": text, "source": "English", "same": False}, ensure_ascii=False)
            elif "project review" in prompt:
                out = SUMMARY_HI if "in Hindi" in prompt else SUMMARY_EN
            else:
                out = "• MOCK summary: the team agreed on Friday."
            return self.send(200, {"candidates": [{"content": {"parts": [{"text": out}]}, "finishReason": "STOP"}]})

        self.send(404, {"error": f"no mock for {p}"})


if __name__ == "__main__":
    print("mock services on http://127.0.0.1:9998")
    http.server.ThreadingHTTPServer(("127.0.0.1", 9998), H).serve_forever()
