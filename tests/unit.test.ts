// Unit tests for the pure parts: webhook signatures, parsing and JWTs. Run: npm test
export {};
process.env.TWILIO_AUTH_TOKEN = "12345";
process.env.TWILIO_ACCOUNT_SID = "ACtest";
process.env.TWILIO_WHATSAPP_NUMBER = "whatsapp:+14155238886";

const { validSignature, parseInbound, normalizeNumber } = await import("../netlify/lib/twilio.ts");
const { parseUpdate } = await import("../netlify/lib/telegram.ts");
const { signJwt, verifyJwt, safeEqual } = await import("../netlify/lib/crypto.ts");
const { CODE_RE } = await import("../netlify/lib/bridges.ts");

let failed = 0;
const ok = (c: unknown, msg: string) => { console.log(`${c ? "PASS" : "FAIL"} ${msg}`); if (!c) failed++; };

// Twilio's documented example (https://www.twilio.com/docs/usage/security)
const params = new URLSearchParams({ CallSid: "CA1234567890ABCDE", Caller: "+12349013030", Digits: "1234", From: "+12349013030", To: "+18005551212" });
const url = "https://mycompany.com/myapp.php?foo=1&bar=2";
ok(await validSignature("0/KCTR6DLpKmkAf8muzZqo1nDgQ=", [url], params), "Twilio signature matches the documented example");
ok(!(await validSignature("0/KCTR6DLpKmkAf8muzZqo1nDgQ=", ["https://evil.example/x"], params)), "signature rejected for a different URL");
params.set("Digits", "9999");
ok(!(await validSignature("0/KCTR6DLpKmkAf8muzZqo1nDgQ=", [url], params)), "signature rejected for tampered params");

const wa = parseInbound(new URLSearchParams({ From: "whatsapp:+919876543210", MessageSid: "SM1", Body: "hi", ProfileName: "Priya", NumMedia: "1", MediaUrl0: "https://api.twilio.com/m/1", MediaContentType0: "image/jpeg" }));
ok(wa?.from === "+919876543210" && wa.name === "Priya" && wa.media?.type === "image/jpeg", "Twilio inbound parsed (number, name, media)");
ok(normalizeNumber("whatsapp:+91 98765-43210") === "+919876543210", "numbers normalised");

const up = parseUpdate({ update_id: 5, message: { message_id: 9, chat: { id: -100123, type: "supergroup", title: "Team" }, from: { id: 42, first_name: "Rahul", last_name: "K" }, caption: "look", photo: [{ file_id: "small", file_size: 1000 }, { file_id: "big", file_size: 4_000_000 }, { file_id: "huge", file_size: 9_000_000 }] } });
ok(up?.chatId === "-100123" && up.fromName === "Rahul K" && up.text === "look" && up.media?.fileId === "big", "Telegram photo update: largest photo under 5 MB, caption as text");
ok(parseUpdate({ update_id: 6, edited_message: { message_id: 1, chat: { id: 1, type: "private" }, from: { id: 1, first_name: "A" }, text: "x" } })?.edited === true, "edited messages flagged");
ok(parseUpdate({ update_id: 7, my_chat_member: {} }) === null, "non-message updates ignored");

const t = await signJwt({ sub: "42" }, "secret-secret-secret", 60);
ok((await verifyJwt<{ sub: string }>(t, "secret-secret-secret"))?.sub === "42", "JWT round trip");
ok((await verifyJwt(t, "another-secret-value")) === null, "JWT with wrong secret rejected");
ok((await verifyJwt(await signJwt({ sub: "42" }, "secret-secret-secret", -5), "secret-secret-secret")) === null, "expired JWT rejected");
ok(safeEqual("abc", "abc") && !safeEqual("abc", "abd") && !safeEqual("abc", "abcd"), "constant-time compare");
ok(CODE_RE.test("my code is cb-7k2pq") && !CODE_RE.test("CB-O0IL1"), "pairing codes (no look-alike characters)");

console.log(failed ? `\n${failed} failed` : "\nAll unit tests passed.");
process.exit(failed ? 1 : 0);
