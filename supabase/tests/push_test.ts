// Проверка web-push в Deno: шифрование и VAPID на тестовый локальный адрес (как браузерная подписка).
import webpush from "npm:web-push@3.6.7";
import { encodeBase64Url } from "jsr:@std/encoding/base64url";

const keys = webpush.generateVAPIDKeys();
webpush.setVapidDetails("https://surenambarsumov642-afk.github.io/feelit-team/calories/", keys.publicKey, keys.privateKey);
// «браузер»: пара ключей P-256 и секрет auth
const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
const p256dh = encodeBase64Url(new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey)));
const auth = encodeBase64Url(crypto.getRandomValues(new Uint8Array(16)));

let got: { headers: Record<string, string>; size: number } | null = null;
const srv = Deno.serve({ port: 8787, onListen() {} }, async (req) => {
  const body = new Uint8Array(await req.arrayBuffer());
  got = { headers: Object.fromEntries(req.headers), size: body.length };
  return new Response(null, { status: 201 });
});
const d = webpush.generateRequestDetails({ endpoint: "http://localhost:8787/push/abc", keys: { p256dh, auth } },
  JSON.stringify({ title: "[СИСТЕМА]", body: "тест" }), { TTL: 60 });
const r = await fetch(d.endpoint, { method: d.method, headers: d.headers as Record<string, string>, body: d.body as unknown as BodyInit });
const res = { statusCode: r.status };
console.log("status:", res.statusCode);
console.log("encoding:", got?.headers["content-encoding"], "| auth:", (got?.headers["authorization"] || "").slice(0, 12), "| bytes:", got?.size, "| ttl:", got?.headers["ttl"]);
await srv.shutdown();
if (res.statusCode !== 201 || got?.headers["content-encoding"] !== "aes128gcm" || !got?.headers["authorization"]?.startsWith("vapid")) Deno.exit(1);
console.log("web-push OK");
