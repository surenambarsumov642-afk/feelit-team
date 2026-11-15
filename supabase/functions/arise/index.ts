// Ingot — серверная функция Supabase.
// Действия: register, sync, leaderboard, restore, analyze, estimate, skill, rename, barcode*, foods_search и др.
// ИИ: бесплатно через Groq (текст: gpt-oss-120b, фото: qwen3.8-27b) с запасным Cloudflare Workers AI для фото.
// Если задан ANTHROPIC_API_KEY — всё идёт через Claude Haiku 5.5.
// Секреты: GROQ_API_KEY, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN (или ANTHROPIC_API_KEY),
// PHOTO_LIMIT (фото в день, 15), TEXT_LIMIT (текстовых расчётов в день, 40), SKILL_LIMIT (запросов к наставнику в день, 40).
import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@1.8.0";
import webpush from "npm:web-push@3.6.7";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const fail = (msg: string, status = 400) => json({ error: msg }, status);

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function newToken() {
  const a = new Uint8Array(18);
  crypto.getRandomValues(a);
  // удобный для ввода код: 18 символов (XXXXXX-XXXXXX-XXXXXX) без похожих букв
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return [...a].map((b) => abc[b % abc.length]).join("").replace(/(.{6})(?!$)/g, "$1-").slice(0, 27);
}
const normToken = (t: unknown) => String(t ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

async function playerByToken(token: unknown) {
  const t = normToken(token);
  if (t.length < 12) return null;
  const { data } = await db.from("players").select("*").eq("token_hash", await sha256(t)).maybeSingle();
  return data;
}
const int = (x: unknown, lo = 0, hi = 1e9) => Math.max(lo, Math.min(hi, Math.round(Number(x) || 0)));
const todayUTC5 = () => new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
const addDaysISO = (d: string, n: number) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const isDay = (d: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(d));
/** Границы сезона (по Ташкенту): неделя с понедельника, месяц, год. back=1 — прошлый сезон. */
function seasonRange(period: string, back = 0): [string, string] {
  const td = todayUTC5();
  if (period === "week") {
    const wd = (new Date(td + "T00:00:00Z").getUTCDay() + 6) % 7;
    const from = addDaysISO(td, -wd - 7 * back);
    return [from, back ? addDaysISO(from, 6) : td];
  }
  if (period === "month") {
    const [y, m] = td.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 - back, 1));
    const from = d.toISOString().slice(0, 10);
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    return [from, back ? end : td];
  }
  const y = Number(td.slice(0, 4)) - back;
  return [`${y}-01-01`, back ? `${y}-12-31` : td];
}
async function seasonXp(from: string, to: string) {
  const { data, error } = await db.rpc("season_board", { p_from: from, p_to: to });
  if (error) throw new Error("Ошибка сезона");
  return new Map<string, number>((data ?? []).map((r: { player_id: string; xp: number }) => [r.player_id, Number(r.xp)]));
}
async function champion(period: string) {
  const [from, to] = seasonRange(period, 1);
  const m = await seasonXp(from, to);
  let best: [string, number] | null = null;
  for (const [id, xp] of m) if (xp > 0 && (!best || xp > best[1])) best = [id, xp];
  if (!best) return null;
  const { data } = await db.from("players").select("id,name").eq("id", best[0]).maybeSingle();
  return data ? { id: data.id, name: data.name, xp: best[1], key: `${period}:${from}` } : null;
}
async function dayStats(ids: string[], from: string, to: string) {
  const { data } = await db.from("player_days").select("player_id,xp,norm,workout").in("player_id", ids).gte("day", from).lte("day", to);
  const out: Record<string, { xp: number; norm: number; workout: number }> = {};
  for (const id of ids) out[id] = { xp: 0, norm: 0, workout: 0 };
  for (const r of data ?? []) { const o = out[r.player_id]; o.xp += r.xp; o.norm += r.norm ? 1 : 0; o.workout += r.workout ? 1 : 0; }
  return out;
}
/* ---------------- уведомления (Web Push) ---------------- */
const APP_URL = "https://surenambarsumov642-afk.github.io/feelit-team/calories/";
async function cfg(key: string) { const { data } = await db.from("app_config").select("value").eq("key", key).maybeSingle(); return data?.value as string | undefined; }
let vapidReady: { pub: string } | null = null;
async function vapid() {
  if (vapidReady) return vapidReady;
  let pub = await cfg("vapid_public"), priv = await cfg("vapid_private");
  if (!pub || !priv) {
    const k = webpush.generateVAPIDKeys();
    await db.from("app_config").upsert([{ key: "vapid_public", value: k.publicKey }, { key: "vapid_private", value: k.privateKey }], { onConflict: "key", ignoreDuplicates: true });
    pub = await cfg("vapid_public"); priv = await cfg("vapid_private");
  }
  webpush.setVapidDetails(APP_URL, pub!, priv!);
  return (vapidReady = { pub: pub! });
}
async function pushTo(playerId: string, title: string, body: string, tag = "arise") {
  const { data: subs } = await db.from("push_subs").select("endpoint,p256dh,auth").eq("player_id", playerId);
  if (!subs?.length) return 0;
  await vapid();
  let sent = 0;
  for (const s of subs) {
    try {
      // библиотека только шифрует (aes128gcm + VAPID), отправка — стандартным fetch
      const d = webpush.generateRequestDetails({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ title, body, tag, url: APP_URL }), { TTL: 6 * 3600 });
      const r = await fetch(d.endpoint, { method: d.method, headers: d.headers as Record<string, string>, body: d.body as unknown as BodyInit });
      if (r.ok) sent++;
      else {
        console.error("push", r.status, (await r.text()).slice(0, 120));
        if (r.status === 404 || r.status === 410) await db.from("push_subs").delete().eq("endpoint", s.endpoint);
      }
    } catch (e) { console.error("push", String((e as Error).message).slice(0, 120)); }
  }
  return sent;
}
const PUSH_MORNING = [
  "Новый день. Ежедневный квест получен.", "Система наблюдает. Покажи, на что ты способен сегодня.",
  "Слабость — не приговор. Это стартовая точка. Квест ждёт.", "Каждый день, который ты не бросил, — уровень, который у тебя не отнять.",
];
const PUSH_EVENING = ["До полуночи 3 часа. Встань и закрой квест.", "Пока ты медлишь, кто-то другой становится сильнее.", "Штраф близко. Система не прощает слабость."];
const pick = (a: string[]) => a[Math.floor(Math.random() * a.length)];

async function postEvent(playerId: string, kind: string, text: string) {
  await db.from("events").insert({ player_id: playerId, kind: kind.slice(0, 20), text: text.slice(0, 160) });
}

/* ---------------- ИИ: еда ---------------- */
const SYSTEM = `You are a professional nutritionist and food-recognition expert inside a calorie-tracking app.
The user sends a photo of food. Identify every distinct food or drink item that is visible and estimate,
as precisely as possible, the portion weight in grams and its calories, protein, fat and carbohydrates.
- Use visual scale cues (plate ~24-27 cm, fork, spoon, hand, cup, packaging) to judge portion size.
- Account for cooking method and hidden calories: oil, butter, sauces, dressings, sugar in drinks, breading.
- If a packaged product with a readable label is visible, prefer the label values.
- Use standard nutrition references (USDA, Russian food composition tables) per 100 g, then scale to the estimated weight.
- Split composite dishes into components only when that improves accuracy; keep well-known dishes (борщ, плов) whole.
- Calories must be consistent with macros (≈ 4·protein + 9·fat + 4·carbs, within ~10%).
- confidence: "high" if item and portion are clear, "medium" if portion is uncertain, "low" if the item itself is uncertain.
Write names, summary and notes in Russian; names short (1-4 words), lower-case.
If there is no food or drink in the image, set is_food=false and return an empty items list.
The user may add a text hint — trust it over your visual guess.`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    is_food: { type: "BOOLEAN" },
    summary: { type: "STRING" },
    notes: { type: "STRING" },
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          grams: { type: "NUMBER" },
          kcal: { type: "NUMBER" },
          protein: { type: "NUMBER" },
          fat: { type: "NUMBER" },
          carbs: { type: "NUMBER" },
          confidence: { type: "STRING", enum: ["high", "medium", "low"] },
        },
        required: ["name", "grams", "kcal", "protein", "fat", "carbs", "confidence"],
      },
    },
  },
  required: ["is_food", "summary", "notes", "items"],
};

const TEXT_SYSTEM = `You are a professional nutritionist inside a calorie-tracking app for users in Uzbekistan and the CIS.
The user describes what they ate in Russian (free text, may include weight, cooking method, brand).
Split it into distinct food items and estimate for each: portion weight in grams, calories, protein, fat, carbohydrates.
- If a weight is given, use it exactly. If not, assume a typical single portion and mark confidence "medium".
- Account for cooking method and added fat/sugar ("с маслом", "жареный", "с сахаром").
- Know local dishes well (плов, лагман, самса, манты, шурпа, нарын, лепёшка, шашлык и т.д.) with typical Tashkent recipes.
- Use standard nutrition references per 100 g, then scale. Calories must match macros (≈4P+9F+4C within ~10%).
Names in Russian, short, lower-case. If the text is not food, set is_food=false and return an empty list.`;

function imageParts(image: string, hint: string): Block[] {
  return [
    { image },
    { text: hint ? `Уточнение от пользователя: ${hint}\n\nОпредели продукты на фото и оцени КБЖУ.` : "Определи продукты на фото и оцени КБЖУ." },
  ];
}

/* ---------- штрихкоды: общая база продуктов ---------- */
const LABEL_SYSTEM = `You read nutrition labels of packaged food (any language, often Russian/Uzbek/English).
Return values PER 100 g (or per 100 ml). If the label gives only per-serving values and the serving weight, convert to per 100 g.
If energy is given only in kJ, convert: kcal = kJ / 4.184.
name: short product name in Russian, lower-case, with brand if visible (e.g. "йогурт danone клубника").
serving: grams in one package/serving if printed, else 0.
If no nutrition table is readable, set found=false and zeros.`;
const LABEL_SCHEMA = {
  type: "OBJECT",
  properties: {
    found: { type: "BOOLEAN" }, name: { type: "STRING" },
    kcal: { type: "NUMBER" }, protein: { type: "NUMBER" }, fat: { type: "NUMBER" }, carbs: { type: "NUMBER" }, serving: { type: "NUMBER" },
  },
  required: ["found", "name", "kcal", "protein", "fat", "carbs", "serving"],
};
const validCode = (c: unknown) => { const s = String(c ?? "").replace(/\D/g, ""); return s.length >= 8 && s.length <= 14 ? s : ""; };
const n1 = (x: unknown, max: number) => { const v = Number(x); return Number.isFinite(v) && v >= 0 && v <= max ? Math.round(v * 10) / 10 : null; };
/** Продукт из Open Food Facts → наш формат на 100 г (или null). */
function fromOFF(code: string, pr: any) {
  if (!pr) return null;
  const nu = pr.nutriments ?? {};
  let kcal = Number(nu["energy-kcal_100g"]);
  if (!Number.isFinite(kcal) && Number.isFinite(Number(nu.energy_100g))) kcal = Number(nu.energy_100g) / 4.184;
  if (!Number.isFinite(kcal) || kcal < 0 || kcal > 950) return null;
  const name = String(pr.product_name_ru || pr.product_name || pr.generic_name_ru || pr.generic_name || "").trim();
  if (!name) return null;
  const brand = String(pr.brands ?? "").split(",")[0].trim();
  const sv = Number(pr.serving_quantity);
  return { code, name: name.slice(0, 80), brand: brand.slice(0, 40) || null, kcal: Math.round(kcal),
    p: n1(nu.proteins_100g, 100) ?? 0, f: n1(nu.fat_100g, 100) ?? 0, c: n1(nu.carbohydrates_100g, 100) ?? 0,
    serving: Number.isFinite(sv) && sv > 0 && sv < 3000 ? Math.round(sv) : null, source: "off" };
}
async function offLookup(code: string) {
  try {
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,product_name_ru,generic_name,generic_name_ru,brands,nutriments,serving_quantity`,
      { headers: { "User-Agent": "Ingot-app/1.0" }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const d = await r.json();
    return d.status === 1 ? fromOFF(code, d.product) : null;
  } catch { return null; }
}

const MODEL = "claude-haiku-5-5";
let anthropic: Anthropic | null = null;

/** Схема в стиле OBJECT/STRING → JSON Schema для structured outputs (additionalProperties: false). */
function toJsonSchema(x: any): any {
  if (!x || typeof x !== "object") return x;
  const out: any = { type: String(x.type).toLowerCase() };
  if (x.enum) out.enum = x.enum;
  if (x.description) out.description = x.description;
  if (out.type === "object") {
    out.properties = Object.fromEntries(Object.entries(x.properties ?? {}).map(([k, v]) => [k, toJsonSchema(v)]));
    out.required = x.required ?? Object.keys(out.properties);
    out.additionalProperties = false;
  }
  if (out.type === "array") out.items = toJsonSchema(x.items);
  return out;
}

type Block = { text?: string; image?: string };
type AIOpts = { effort?: "low" | "medium"; maxTokens?: number };
/**
 * Запрос к Claude со строгим JSON-ответом. Экономия токенов: Haiku 5.5, низкий effort (думает мало или не думает),
 * короткие системные промпты, max_tokens по задаче, фото уменьшаются на телефоне.
 */
async function claudeCall(blocks: Block[], system: string, schema: unknown, opts: AIOpts = {}) {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("На сервере не задан ключ ИИ (ANTHROPIC_API_KEY).");
  anthropic ??= new Anthropic({ apiKey: key, maxRetries: 2, timeout: 110_000 });
  const content = blocks.map((b) => b.image
    ? { type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: b.image } }
    : { type: "text" as const, text: b.text ?? "" });
  let res;
  try {
    res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: opts.maxTokens ?? 4000,
      system,
      output_config: { effort: opts.effort ?? "low", format: { type: "json_schema", schema: toJsonSchema(schema) } },
      messages: [{ role: "user", content }],
    });
  } catch (e) {
    console.error("claude", e);
    if (e instanceof Anthropic.AuthenticationError) throw new Error("Ключ ИИ на сервере недействителен.");
    if (e instanceof Anthropic.PermissionDeniedError) throw new Error("Нет доступа к модели ИИ с этим ключом.");
    if (e instanceof Anthropic.RateLimitError) throw new Error("ИИ перегружен или закончился баланс. Попробуй позже.");
    if (e instanceof Anthropic.BadRequestError) {
      const m = String((e as Error).message);
      throw new Error(m.includes("credit balance") ? "На счёте ИИ закончились деньги — владельцу нужно пополнить баланс." : "ИИ отклонил запрос.");
    }
    if (e instanceof Anthropic.APIConnectionError) throw new Error("Нет связи с ИИ. Попробуй позже.");
    if (e instanceof Anthropic.APIError) throw new Error("Сервис ИИ временно недоступен. Попробуй позже.");
    throw e;
  }
  console.log("usage", JSON.stringify(res.usage));
  if (res.stop_reason === "refusal") throw new Error("ИИ отказался обрабатывать этот запрос.");
  if (res.stop_reason === "max_tokens") throw new Error("Ответ ИИ оборвался. Попробуй ещё раз.");
  const text = res.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("");
  try { return JSON.parse(text); } catch { throw new Error("ИИ вернул неразборчивый ответ. Попробуй ещё раз."); }
}

/* ---------- бесплатный ИИ: Groq + Cloudflare ---------- */
const GROQ_TEXT = ["openai/gpt-oss-120b", "qwen/qwen3.8-27b"];
const GROQ_VISION = ["qwen/qwen3.8-27b"];
const CF_VISION = ["@cf/qwen/qwen3.8-27b", "@cf/meta/llama-4-scout-17b-16e-instruct"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Пример JSON по схеме — модель видит, что именно вернуть. */
function exampleOf(x: any): any {
  const t = String(x?.type || "").toUpperCase();
  if (t === "OBJECT") return Object.fromEntries(Object.entries(x.properties ?? {}).map(([k, v]) => [k, exampleOf(v)]));
  if (t === "ARRAY") return [exampleOf(x.items)];
  if (t === "NUMBER") return 0;
  if (t === "BOOLEAN") return false;
  return x?.enum ? x.enum.join("|") : "…";
}
/** Приводит ответ к схеме: недостающие поля — значения по умолчанию, числа — числа. */
function conform(x: any, v: any): any {
  const t = String(x?.type || "").toUpperCase();
  if (t === "OBJECT") {
    const o = v && typeof v === "object" && !Array.isArray(v) ? v : {};
    return Object.fromEntries(Object.entries(x.properties ?? {}).map(([k, sx]) => [k, conform(sx, o[k])]));
  }
  if (t === "ARRAY") return Array.isArray(v) ? v.map((i) => conform(x.items, i)) : [];
  if (t === "NUMBER") { const n = Number(v); return Number.isFinite(n) ? n : 0; }
  if (t === "BOOLEAN") return v === true || v === "true";
  const s = v == null ? "" : typeof v === "string" ? v : JSON.stringify(v);
  return x?.enum && !x.enum.includes(s) ? x.enum[Math.min(1, x.enum.length - 1)] : s;
}
/** Если модель обернула ответ ({"map": {...}}), достаём вложенный объект, где больше всего полей схемы. */
function unwrap(x: any, v: any): any {
  if (String(x?.type || "").toUpperCase() !== "OBJECT" || !v || typeof v !== "object" || Array.isArray(v)) return v;
  const keys = Object.keys(x.properties ?? {}), hits = (o: any) => o && typeof o === "object" && !Array.isArray(o) ? keys.filter((k) => k in o).length : 0;
  let best = v, bestN = hits(v);
  for (const a of Object.values(v)) {
    if (hits(a) > bestN) { best = a; bestN = hits(a); }
    if (a && typeof a === "object") for (const b of Object.values(a as object)) if (hits(b) > bestN) { best = b; bestN = hits(b); }
  }
  return best;
}
/** Ответ «пустой»: все массивы пустые и все строки пустые — значит, модель ответила не по схеме. */
const looksEmpty = (v: any) => v && typeof v === "object" && Object.values(v).every((x) => (Array.isArray(x) ? !x.length : x === "" || x === 0 || x === false));
function parseLoose(text: string) {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try { return JSON.parse(t); } catch { /* ниже */ }
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* ниже */ } }
  throw new Error("bad json");
}
const jsonRule = (schema: unknown) =>
  `\n\nОТВЕТ: только один JSON-объект без пояснений и без markdown, строго такой структуры (все поля обязательны):\n${JSON.stringify(exampleOf(schema))}`;

class Busy extends Error {}

async function groqCall(blocks: Block[], system: string, schema: unknown, opts: AIOpts) {
  const key = Deno.env.get("GROQ_API_KEY");
  if (!key) throw new Busy("нет GROQ_API_KEY");
  const vision = blocks.some((b) => b.image);
  const content = vision
    ? blocks.map((b) => b.image ? { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b.image}` } } : { type: "text", text: b.text ?? "" })
    : blocks.map((b) => b.text ?? "").join("\n");
  let last = "";
  for (const model of vision ? GROQ_VISION : GROQ_TEXT) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const body: Record<string, unknown> = {
        model, max_tokens: opts.maxTokens ?? 3000, response_format: { type: "json_object" },
        messages: [{ role: "system", content: system + jsonRule(schema) }, { role: "user", content }],
      };
      if (model.startsWith("openai/gpt-oss")) body.reasoning_effort = opts.effort ?? "low";
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const txt = await r.text();
      if (r.ok) {
        const d = JSON.parse(txt);
        console.log("groq", model, JSON.stringify(d.usage ?? {}));
        const raw = d.choices?.[0]?.message?.content ?? "";
        try {
          const res = conform(schema, unwrap(schema, parseLoose(raw)));
          if (looksEmpty(res)) { console.error("groq empty", model, raw.slice(0, 400)); last = `${model}: empty`; if (attempt === 0) continue; break; }
          return res;
        } catch { last = `${model}: bad json`; continue; }
      }
      last = `${model}: ${r.status} ${txt.slice(0, 200)}`;
      console.error("groq", last);
      if (r.status === 429) {
        const wait = Number(r.headers.get("retry-after")) || Number((txt.match(/try again in ([\d.]+)s/) || [])[1]) || 0;
        if (attempt === 0 && wait > 0 && wait <= 35) { await sleep(wait * 1000 + 300); continue; }
      }
      break; // к следующей модели
    }
  }
  throw new Busy(last);
}

async function cfCall(blocks: Block[], system: string, schema: unknown, opts: AIOpts) {
  const id = Deno.env.get("CLOUDFLARE_ACCOUNT_ID"), tok = Deno.env.get("CLOUDFLARE_API_TOKEN");
  if (!id || !tok) throw new Busy("нет Cloudflare");
  const content = blocks.map((b) => b.image ? { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b.image}` } } : { type: "text", text: b.text ?? "" });
  let last = "";
  for (const model of CF_VISION) {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${id}/ai/run/${model}`, {
      method: "POST", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify({ max_tokens: (opts.maxTokens ?? 2000) + 1500, messages: [{ role: "system", content: system + jsonRule(schema) }, { role: "user", content }] }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok) {
      const res = d.result ?? {};
      const text = typeof res.response === "string" ? res.response : res.choices?.[0]?.message?.content ?? "";
      try { return conform(schema, unwrap(schema, parseLoose(text || ""))); } catch { last = `${model}: bad json`; continue; }
    }
    last = `${model}: ${r.status} ${JSON.stringify(d.errors ?? d).slice(0, 200)}`;
    console.error("cf", last);
  }
  throw new Busy(last);
}

/** Единая точка вызова ИИ. */
async function ai(blocks: Block[], system: string, schema: unknown, opts: AIOpts = {}) {
  if (Deno.env.get("ANTHROPIC_API_KEY")) return await claudeCall(blocks, system, schema, opts);
  try { return await groqCall(blocks, system, schema, opts); }
  catch (e) {
    if (!(e instanceof Busy)) throw e;
    if (blocks.some((b) => b.image)) {
      try { return await cfCall(blocks, system, schema, opts); } catch (e2) { if (!(e2 instanceof Busy)) throw e2; }
    }
    throw new Error("Бесплатный ИИ сейчас перегружен или закончился дневной лимит. Попробуй через несколько минут.");
  }
}

/* ---------------- навыки ---------------- */
const S_ = (type: string, extra: Record<string, unknown> = {}) => ({ type, ...extra });
const OBJ = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: "OBJECT", properties, required });
const ARR = (items: unknown) => ({ type: "ARRAY", items });
const STR = S_("STRING"), NUM = S_("NUMBER"), BOOL = S_("BOOLEAN");

const MENTOR = `Ты — «Система»: персональный наставник в приложении Ingot (стиль: путь воина, ранги, квесты), но прежде всего —
опытный практик и преподаватель в теме, которую осваивает человек. Твоя единственная цель — чтобы человек РЕАЛЬНО освоил навык
за месяц и смог применять его в жизни, а не просто «прошёл курс».
Принципы: конкретика вместо общих слов; практика каждый день; маленькие шаги с видимым результатом; обратная связь по делу;
учитывай время, технику, бюджет и язык человека; не предлагай платное, если бюджет 0; не выдумывай ссылки — давай поисковые запросы.
Пиши по-русски, коротко и ясно. Соблюдай тон, который выбрал человек (жёстко / строго с поддержкой / мягко).`;

const RESOURCE = OBJ({ title: STR, kind: S_("STRING", { enum: ["video", "article", "practice", "tool"] }), query: STR });
const DAY = OBJ({
  day: NUM, title: STR, what: STR, resource: RESOURCE, deliverable: STR, why: STR, minutes: NUM, rest: BOOL,
});

const SKILL_KINDS: Record<string, { schema: unknown; prompt: (c: Record<string, unknown>) => string; temp?: number; max?: number }> = {
  clarify: {
    schema: OBJ({ vague: BOOL, questions: ARR(STR), suggestion: STR }),
    prompt: (c) => `Человек хочет освоить навык. Его ответы:
${JSON.stringify(c)}
Оцени, достаточно ли конкретна цель, чтобы построить план на 30 дней с финальным проектом, который можно показать.
Если цель размыта (например «разбираться в ИИ») — vague=true и задай 1–3 коротких уточняющих вопроса (с примерами вариантов в скобках),
которые сделают цель конкретной. Если цель ясна — vague=false, questions пустой.
suggestion — переформулированная конкретная цель одной фразой (что человек сможет сделать через 30 дней).`,
  },
  diag: {
    schema: OBJ({ questions: ARR(OBJ({ q: STR, hint: STR })) }),
    prompt: (c) => `Составь практическую мини-проверку текущего уровня человека по навыку. Данные: ${JSON.stringify(c)}
Нужно 3 задания, на каждое можно ответить текстом с телефона за 1–2 минуты. Не спрашивай «оцени себя» — проверяй реальные знания и умения:
1) базовое понимание; 2) маленькое практическое задание (например, написать промпт/набросать решение/объяснить шаги); 3) вопрос посложнее.
hint — подсказка, что можно ответить «не знаю», если не знает. Учитывай, что человек может быть полным новичком.
Если в данных есть upgrade (это входной тест на следующий уровень после месяца обучения): 1) проверь остаточные знания по ключевым темам прошлого месяца;
2) задание прицельно на слабые места (gaps); 3) задание уровнем выше прошлого финального проекта — чтобы понять потолок.`,
  },
  plan: {
    temp: 0.5,
    max: 16000,
    schema: OBJ({
      skill_name: STR,
      profile: OBJ({ level: STR, level_note: STR, strengths: ARR(STR), weak: ARR(STR), main_risk: STR, motivation: STR }),
      final_project: OBJ({ title: STR, description: STR, criteria: ARR(STR) }),
      weeks: ARR(OBJ({ n: NUM, theme: STR, goal: STR })),
      days: ARR(DAY),
    }),
    prompt: (c) => `Построй персональный план освоения навыка на 30 дней. Все данные человека (интервью + ответы на проверку уровня):
${JSON.stringify(c)}

Требования:
- Определи реальный уровень по ответам на проверку (а не по самооценке): profile.level — одно из «новичок», «начальный», «средний», «продвинутый»;
  strengths/weak — конкретные темы; main_risk — главная причина, по которой человек может бросить (из интервью), и учти её в плане;
  motivation — его «зачем» одной фразой (будет напоминаться в трудные дни).
- final_project: результат, который можно показать через 30 дней, + 3–5 проверяемых критериев.
- 4 недели (weeks) с темами, которые ведут к финальному проекту; неделя 1 — основа и быстрые победы.
- Ровно 30 дней (days, day=1..30). Каждый день: одно конкретное действие (what — пошагово, 2–4 предложения);
  resource — что изучить: название + тип + ТОЧНЫЙ поисковый запрос для YouTube/Google на языке, который выбрал человек (не ссылка!);
  deliverable — что именно сдать как доказательство (текст, скриншот, фото, ссылка); why — как это приближает к цели;
  minutes — укладывается в его время (будни/выходные).
- Дни 7, 14, 21, 28 — дни «босса»: задание лёгкое (повторение недели), т.к. в этот день ещё экзамен.
- День 30 — защита финального проекта (deliverable = сам проект).
- Дни из списка rest_days: rest=true, лёгкое задание на 10 минут (повторение), без нового материала. Остальные rest=false.
- Только бесплатные инструменты, если бюджет 0. Учитывай устройство (телефон/компьютер).
- Задания должны усложняться, повторять важное (интервальное повторение) и постоянно работать на финальный проект.
Если есть upgrade (не первый месяц, level — номер уровня):
- skill_name — то же название навыка (без номера уровня), при новой ветке — «навык: ветка».
- Не повторяй пройденное: опирайся на previous (итоги прошлого месяца, слабые места, отзыв о финальном проекте, дневник) и входной тест.
- mode="upgrade": новый уровень. direction: «deeper» — глубже в том же; «branch» — новая ветка (branch); «money» — навык как источник дохода
  (портфолио, упаковка услуги, первые клиенты — без обещаний дохода и спама).
- mode="consolidate": месяц закрепления — те же цели прошлого уровня, упор на слабые места и практику, без нового материала сверху.
- mode="recover": месяц восстановления после перерыва — мягкий вход (первая неделя — повторение), потом рост.
- final_project ЗАМЕТНО сложнее previous.final_project (кроме consolidate/recover) и, если указан external_result, — с внешним результатом
  (для другого человека/бизнеса, публикация, заказ). Критерии строже.
- Учти, что изменилось в жизни (life) и новое время.`,
  },
  regen_day: {
    temp: 0.5,
    schema: DAY,
    prompt: (c) => `Перепиши задание одного дня плана по просьбе человека. Контекст навыка и плана: ${JSON.stringify(c)}
Сохрани номер дня, место в логике недели и связь с финальным проектом. Учти комментарий человека.`,
  },
  review: {
    schema: OBJ({ passed: BOOL, score: NUM, feedback: STR, improve: STR, recall: ARR(OBJ({ q: STR, a: STR })) }),
    prompt: (c) => `Проверь работу, которую человек сдал по заданию дня. Контекст: ${JSON.stringify(c)}
passed=true, если работа честно выполняет задание (не идеально, но по сути). Если отписка/не по теме — passed=false и объясни, что доделать.
score 0–100. feedback — что получилось хорошо (конкретно, 1–2 предложения). improve — главное, что улучшить, и как (1–2 предложения).
recall — 2 коротких вопроса с ответами по ключевой идее сегодняшнего дня, для повторения через несколько дней.`,
  },
  boss: {
    temp: 0.4,
    schema: OBJ({ title: STR, intro: STR, questions: ARR(STR), practical: STR }),
    prompt: (c) => `Составь недельный экзамен-«босс» по навыку. Контекст (темы недели, выполненные задания, слабые места): ${JSON.stringify(c)}
title — пафосное название босса в эпичном стиле (например «Страж Промптов»). intro — 1 фраза вызова.
questions — 4 вопроса на понимание (не на память дословно), с упором на слабые места. practical — 1 практическое задание на 10–20 минут,
результат которого можно сдать текстом/скриншотом. Сложность — по уровню человека, но чтобы пришлось подумать.`,
  },
  boss_grade: {
    schema: OBJ({ score: NUM, passed: BOOL, feedback: STR, per: ARR(OBJ({ ok: BOOL, comment: STR })), weak: ARR(STR) }),
    prompt: (c) => `Оцени ответы на недельный экзамен-«босс». Данные: ${JSON.stringify(c)}
per — по каждому вопросу и практике (в том же порядке: сначала вопросы, потом практика) ok + короткий комментарий.
score 0–100 (практика весит 40%). passed=true при score>=60. feedback — общий вывод 2–3 предложения. weak — темы, которые надо подтянуть.
Будь честным: пустые и «не знаю» ответы — неверно.`,
  },
  final_grade: {
    schema: OBJ({ score: NUM, passed: BOOL, feedback: STR, criteria: ARR(OBJ({ name: STR, ok: BOOL, comment: STR })), next: STR }),
    prompt: (c) => `Оцени финальный проект месяца по критериям. Данные: ${JSON.stringify(c)}
criteria — по каждому критерию плана ok + комментарий. score 0–100, passed при score>=60. feedback — честный итог.
next — что развивать дальше (1–2 предложения), это пойдёт в план следующего уровня.`,
  },
  adapt: {
    temp: 0.5,
    max: 6000,
    schema: OBJ({ note: STR, days: ARR(DAY) }),
    prompt: (c) => `Человек оценил, как идёт обучение. Перестрой следующие дни плана (те же номера дней, что в remaining) под его отзыв.
Данные: ${JSON.stringify(c)}
Если «тяжело» — меньше объём, проще шаги, больше быстрых побед, но не меняй цель. Если «легко» — сложнее и глубже.
Если «норм» — только учти комментарий. Сохрани дни босса (7/14/21/28), день 30 и rest-дни. note — 1 фраза, что изменилось.`,
  },
  upgrade_analysis: {
    max: 1500,
    temp: 0.4,
    schema: OBJ({ summary: STR, wins: ARR(STR), gaps: ARR(STR), branches: ARR(STR), advice: STR }),
    prompt: (c) => `Ты — «Система» в приложении саморазвития. Человек закончил месяц обучения навыку и хочет перейти дальше.
Данные прошлого месяца (освоение, выполненные дни, боссы со слабыми темами, финальный проект и отзыв, дневник, перерыв, режим допуска): ${JSON.stringify(c)}
summary — честный разбор месяца в 2–3 предложениях, обращаясь на «ты», в тоне Системы (строго, по делу, без лести).
wins — 2–3 конкретных достижения. gaps — 2–4 конкретных слабых места (темы/умения), а не общие слова.
branches — 3 возможные ветки развития навыка (коротко, 2–5 слов каждая). advice — одна фраза: что главное на следующий месяц.
Если mode="consolidate" — объясни, что освоение ниже 60%, поэтому сначала месяц закрепления. Если "recover" — что был долгий перерыв.`,
  },
  world_map: {
    temp: 0.5,
    max: 7000,
    schema: OBJ({
      who: ARR(OBJ({ who: STR, pain: STR, where: STR })),
      services: ARR(OBJ({ name: STR, price: STR, time: STR })),
      portfolio: ARR(STR), offer: STR,
      messages: ARR(OBJ({ to: STR, text: STR })),
      first_steps: ARR(STR), warning: STR,
    }),
    prompt: (c) => `Составь «карту применения» навыка: как человеку начать применять его для других людей и зарабатывать. Данные: ${JSON.stringify(c)}
Рынок по умолчанию: город человека (обычно Ташкент) + удалёнка в русскоязычном интернете. Будь конкретным и реалистичным для его уровня.
who — 4–6 типов клиентов: кто (конкретно: «кофейни у дома», «мастера маникюра в Instagram»), их боль, где их искать (Instagram, Telegram-чаты, OLX, знакомые и т.д.).
services — 3–4 услуги, которые он уже может делать на своём уровне, ориентир цены (в сумах и/или $, честно для новичка) и сколько времени занимает.
portfolio — 3 конкретные работы для портфолио, которые можно сделать без клиента. offer — короткое предложение услуги (3–4 предложения) от первого лица.
messages — 3 готовых первых сообщения разным типам клиентов: вежливо, коротко, с конкретной пользой и без навязывания (человек отправляет сам).
first_steps — 3–5 шагов на ближайшую неделю. warning — одна фраза: никаких обещаний дохода, никакого спама, честно о своём уровне.
Всё на русском.`,
  },
  client_sim: {
    max: 500,
    temp: 0.8,
    schema: OBJ({ reply: STR, done: BOOL }),
    prompt: (c) => `Ты играешь роль потенциального клиента в тренажёре переговоров. Навык и услуга человека: ${JSON.stringify(c.service)}.
Твой персонаж: ${JSON.stringify(c.persona)}. Это реалистичный клиент из Ташкента: немного сомневается, спрашивает цену и сроки, может торговаться,
просит примеры работ, иногда возражает («дорого», «а гарантии?», «мне племянник сделает»). Не будь слишком лёгким, но и не грубым.
История диалога (client — ты, me — человек): ${JSON.stringify(c.history)}
Напиши следующую реплику клиента (1–3 предложения, разговорный русский). done=true, если разговор логически закончен (договорились или ты окончательно отказался)
или если в истории уже 7+ реплик человека.`,
  },
  client_grade: {
    max: 1000,
    schema: OBJ({ score: NUM, deal: BOOL, feedback: STR, better: ARR(STR) }),
    prompt: (c) => `Оцени, как человек провёл переговоры с клиентом в тренажёре. Данные: ${JSON.stringify(c)}
score 0–100: вежливость и уверенность, выяснил ли задачу клиента, назвал ли цену и сроки ясно, работал ли с возражениями, предложил ли следующий шаг.
deal — договорились ли. feedback — 2–3 предложения честно. better — 2–3 конкретные фразы/приёма, которые стоило использовать.`,
  },
  debrief: {
    max: 900,
    schema: OBJ({ feedback: STR, lessons: ARR(STR), price_tip: STR }),
    prompt: (c) => `Человек выполнил работу для клиента и делает разбор. Данные: ${JSON.stringify(c)}
feedback — 2–3 предложения: что получилось, что важно исправить. lessons — 2–3 урока на следующий заказ. price_tip — стоит ли поднять цену и как (1 фраза, честно).`,
  },
};

async function skillAI(kind: string, ctx: Record<string, unknown>, image?: string) {
  const k = SKILL_KINDS[kind];
  if (!k) throw new Error("unknown skill kind");
  const parts: Block[] = [];
  if (image) parts.push({ image });
  parts.push({ text: k.prompt(ctx) });
  const opts: AIOpts = { effort: kind === "plan" ? "medium" : "low", maxTokens: k.max ?? 3000 };
  // Бесплатный Groq ограничен по токенам в минуту — план на 30 дней собираем из двух половин.
  if (kind === "plan" && !Deno.env.get("ANTHROPIC_API_KEY")) {
    const first = await ai([{ text: k.prompt(ctx) + "\n\nСЕЙЧАС: верни профиль, финальный проект, 4 недели и ТОЛЬКО дни 1–15 (days = 15 элементов)." }],
      MENTOR, k.schema, { effort: "medium", maxTokens: 9000 });
    const rest = await ai([{ text: k.prompt(ctx) + `\n\nУже готово: ${JSON.stringify({ skill_name: first.skill_name, final_project: first.final_project, weeks: first.weeks,
      days_1_15: (first.days || []).map((d: any) => d.title) })}\nСЕЙЧАС: верни ТОЛЬКО дни 16–30 (15 элементов), продолжая логику недель 3–4 и подводя к финальному проекту.` }],
      MENTOR, OBJ({ days: ARR(DAY) }), { effort: "medium", maxTokens: 9000 });
    first.days = [...(first.days || []).slice(0, 15), ...(rest.days || [])];
    return first;
  }
  return await ai(parts, MENTOR, k.schema, opts);
}

/* ---------------- обработчик ---------------- */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return fail("POST only", 405);
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return fail("bad json"); }

  try {
    switch (b.action) {
      case "register": {
        const name = String(b.name ?? "").trim().replace(/\s+/g, " ").slice(0, 24);
        if (name.length < 2) return fail("Имя слишком короткое");
        const token = newToken();
        const { data, error } = await db.from("players")
          .insert({ name, token_hash: await sha256(normToken(token)) }).select("id").single();
        if (error) return fail(error.code === "23505" ? "Это имя уже занято" : "Не удалось зарегистрироваться");
        return json({ id: data.id, name, token });
      }
      case "sync": {
        const p = await playerByToken(b.token);
        if (!p) return fail("Неверный код игрока", 401);
        const s = (b.stats ?? {}) as Record<string, unknown>;
        const save = b.save ?? null;
        if (save && JSON.stringify(save).length > 1_500_000) return fail("Слишком большая копия данных");
        const { error } = await db.from("players").update({
          level: int(s.level, 1, 999), rank: String(s.rank ?? "E").slice(0, 1), xp: int(s.xp),
          streak: int(s.streak, 0, 100000), best_streak: int(s.best_streak, 0, 100000),
          perfect_days: int(s.perfect_days, 0, 100000), workouts: int(s.workouts, 0, 100000),
          title: s.title ? String(s.title).slice(0, 40) : null,
          today_quests: int(s.today_quests, 0, 10), today_total: int(s.today_total, 1, 10),
          stats_date: /^\d{4}-\d{2}-\d{2}$/.test(String(s.stats_date)) ? s.stats_date : null,
          skill_state: ["none", "todo", "done", "rest"].includes(String(s.skill_state)) ? String(s.skill_state) : "none",
          skill_date: isDay(s.stats_date) ? s.stats_date : null,
          ...(save ? { save } : {}), updated_at: new Date().toISOString(),
        }).eq("id", p.id);
        if (error) return fail("Ошибка сохранения", 500);
        if (Array.isArray(b.days)) {
          const rows = (b.days as Record<string, unknown>[]).filter((d) => isDay(d.day)).slice(-400).map((d) => ({
            player_id: p.id, day: d.day, xp: int(d.xp, -100000, 100000), norm: !!d.norm, workout: !!d.workout, quests: int(d.quests, 0, 10),
          }));
          if (rows.length) await db.from("player_days").upsert(rows, { onConflict: "player_id,day" });
        }
        return json({ ok: true });
      }
      case "leaderboard": {
        const { data, error } = await db.from("players")
          .select("id,name,level,rank,xp,streak,best_streak,perfect_days,workouts,title,today_quests,today_total,stats_date,updated_at")
          .order("xp", { ascending: false }).limit(200);
        if (error) return fail("Ошибка чтения", 500);
        const period = String(b.period ?? "all");
        let players = data ?? [];
        let range: [string, string] | null = null;
        if (["week", "month", "year"].includes(period)) {
          range = seasonRange(period);
          const m = await seasonXp(range[0], range[1]);
          players = players.map((x) => ({ ...x, season_xp: m.get(x.id) ?? 0 })).sort((a, b2) => b2.season_xp - a.season_xp || b2.xp - a.xp);
        }
        const champions = { week: await champion("week"), month: await champion("month"), year: await champion("year") };
        return json({ players: players.slice(0, 100), period, range, champions });
      }
      case "event": {
        const p = await playerByToken(b.token);
        if (!p) return fail("Неверный код игрока", 401);
        const since = new Date(Date.now() - 864e5).toISOString();
        const { count } = await db.from("events").select("id", { count: "exact", head: true }).eq("player_id", p.id).gte("created_at", since);
        if ((count ?? 0) >= 40) return json({ ok: false });
        await postEvent(p.id, String(b.kind ?? "info"), String(b.text ?? ""));
        return json({ ok: true });
      }
      case "feed": {
        const { data, error } = await db.from("events").select("id,kind,text,created_at,player_id,players(name,rank)")
          .order("created_at", { ascending: false }).limit(60);
        if (error) return fail("Ошибка ленты", 500);
        return json({ events: data });
      }
      case "duel_create": {
        const p = await playerByToken(b.token);
        if (!p) return fail("Неверный код игрока", 401);
        const opp = String(b.opponent ?? ""), metric = String(b.metric ?? "xp");
        if (!["xp", "norm", "workout"].includes(metric)) return fail("Неизвестный тип дуэли");
        if (opp === p.id) return fail("Нельзя вызвать самого себя");
        const stake = int(b.stake ?? 100, 50, 500);
        const { data: o } = await db.from("players").select("id,name").eq("id", opp).maybeSingle();
        if (!o) return fail("Соперник не найден");
        const { data: ex } = await db.from("duels").select("id").in("status", ["pending", "active"])
          .or(`and(a.eq.${p.id},b.eq.${opp}),and(a.eq.${opp},b.eq.${p.id})`);
        if (ex && ex.length) return fail("С этим игроком уже есть дуэль");
        const { error } = await db.from("duels").insert({ a: p.id, b: opp, metric, stake });
        if (error) return fail("Не удалось создать дуэль", 500);
        await postEvent(p.id, "duel", `вызвал ${o.name} на дуэль`);
        pushTo(opp, "⚔ Вызов на дуэль", `${p.name} вызывает тебя на дуэль на 7 дней. Ставка: ${stake} XP.`, "duel").catch(() => {});
        return json({ ok: true });
      }
      case "duel_respond": {
        const p = await playerByToken(b.token);
        if (!p) return fail("Неверный код игрока", 401);
        const { data: d } = await db.from("duels").select("*").eq("id", String(b.id ?? "")).maybeSingle();
        if (!d || d.b !== p.id || d.status !== "pending") return fail("Дуэль не найдена");
        if (b.accept) {
          const start = addDaysISO(todayUTC5(), 1);
          await db.from("duels").update({ status: "active", start_day: start, end_day: addDaysISO(start, 6) }).eq("id", d.id);
          await postEvent(p.id, "duel", "принял вызов на дуэль");
        } else await db.from("duels").update({ status: "declined" }).eq("id", d.id);
        return json({ ok: true });
      }
      case "duels": {
        const p = await playerByToken(b.token);
        if (!p) return fail("Неверный код игрока", 401);
        const { data: list } = await db.from("duels").select("*").or(`a.eq.${p.id},b.eq.${p.id}`)
          .neq("status", "declined").order("created_at", { ascending: false }).limit(20);
        const ids = [...new Set((list ?? []).flatMap((d) => [d.a, d.b]))];
        const { data: names } = ids.length ? await db.from("players").select("id,name,rank").in("id", ids) : { data: [] };
        const nm = Object.fromEntries((names ?? []).map((x) => [x.id, x]));
        const td = todayUTC5(), out = [];
        for (const d of list ?? []) {
          let score: Record<string, number> = {};
          if (d.status !== "pending" && d.start_day) {
            const st = await dayStats([d.a, d.b], d.start_day, d.end_day < td ? d.end_day : td);
            score = { [d.a]: st[d.a][d.metric as "xp"], [d.b]: st[d.b][d.metric as "xp"] };
            if (d.status === "active" && td > d.end_day) {
              const winner = score[d.a] === score[d.b] ? null : score[d.a] > score[d.b] ? d.a : d.b;
              await db.from("duels").update({ status: "done", winner }).eq("id", d.id);
              d.status = "done"; d.winner = winner;
              if (winner) await postEvent(winner, "duel", `победил в дуэли против ${nm[winner === d.a ? d.b : d.a]?.name ?? "соперника"}`);
            }
          }
          out.push({ ...d, a_name: nm[d.a]?.name, b_name: nm[d.b]?.name, score });
        }
        return json({ duels: out, today: td });
      }
      case "gate_join": case "gate_update": {
        const p = await playerByToken(b.token);
        if (!p) return fail("Неверный код игрока", 401);
        const key = String(b.key ?? "").slice(0, 60);
        if (!key) return fail("Нет испытания");
        const status = ["active", "done", "failed"].includes(String(b.status)) ? String(b.status) : "active";
        await db.from("gate_runs").upsert({ gate_key: key, player_id: p.id, status, progress: int(b.progress, 0, 100), updated_at: new Date().toISOString() },
          { onConflict: "gate_key,player_id" });
        return json({ ok: true });
      }
      case "gate_runs": {
        const keys = (Array.isArray(b.keys) ? b.keys : []).map(String).slice(0, 10);
        if (!keys.length) return json({ runs: [] });
        const { data } = await db.from("gate_runs").select("gate_key,player_id,status,progress,players(name)").in("gate_key", keys);
        return json({ runs: data ?? [] });
      }
      case "restore": {
        const p = await playerByToken(b.token);
        if (!p) return fail("Код не найден", 401);
        return json({ id: p.id, name: p.name, save: p.save });
      }
      case "analyze": {
        const p = await playerByToken(b.token);
        if (!p) return fail("Неверный код игрока", 401);
        const image = String(b.image ?? "");
        if (!image || image.length > 4_000_000) return fail("Фото не получено или слишком большое");
        const limit = int(Deno.env.get("PHOTO_LIMIT") ?? 15, 1, 1000);
        const day = todayUTC5();
        const used = p.photo_day === day ? p.photo_count : 0;
        if (used >= limit) return fail(`Лимит ${limit} фото в день исчерпан. Используй ручной ввод.`, 429);
        await db.from("players").update({ photo_day: day, photo_count: used + 1 }).eq("id", p.id);
        const res = await ai(imageParts(image, String(b.hint ?? "").slice(0, 300)), SYSTEM, SCHEMA, { maxTokens: 2000 });
        return json({ ...res, photos_left: limit - used - 1 });
      }
      case "estimate": {
        const p = await playerByToken(b.token);
        if (!p) return fail("Неверный код игрока", 401);
        const text = String(b.text ?? "").trim().slice(0, 300);
        if (text.length < 2) return fail("Опиши, что ты съел");
        const limit = int(Deno.env.get("TEXT_LIMIT") ?? 40, 1, 1000);
        const day = todayUTC5();
        const used = p.text_day === day ? p.text_count : 0;
        if (used >= limit) return fail(`Лимит ${limit} расчётов в день исчерпан. Введи КБЖУ вручную.`, 429);
        await db.from("players").update({ text_day: day, text_count: used + 1 }).eq("id", p.id);
        const res = await ai([{ text: `Что съел пользователь: ${text}` }], TEXT_SYSTEM, SCHEMA, { maxTokens: 1500 });
        return json(res);
      }
      case "skill": {
        const p = await playerByToken(b.token);
        if (!p) return fail("Неверный код игрока", 401);
        const kind = String(b.kind ?? "");
        if (!SKILL_KINDS[kind]) return fail("Неизвестный запрос");
        const ctx = (b.ctx ?? {}) as Record<string, unknown>;
        if (JSON.stringify(ctx).length > 60_000) return fail("Слишком большой запрос");
        const image = b.image ? String(b.image) : undefined;
        if (image && image.length > 4_000_000) return fail("Фото слишком большое");
        const limit = int(Deno.env.get("SKILL_LIMIT") ?? 40, 1, 1000);
        const day = todayUTC5();
        const used = p.skill_day === day ? p.skill_count : 0;
        if (used >= limit) return fail(`Лимит ${limit} запросов к наставнику в день исчерпан. Продолжим завтра.`, 429);
        await db.from("players").update({ skill_day: day, skill_count: used + 1 }).eq("id", p.id);
        return json(await skillAI(kind, ctx, image));
      }
      case "push_key": return json({ key: (await vapid()).pub });
      case "push_sub": {
        const p = await playerByToken(b.token);
        if (!p) return fail("Неверный код игрока", 401);
        const sub = (b.sub ?? {}) as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
        if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth || !/^https:\/\//.test(sub.endpoint)) return fail("Неверная подписка");
        await db.from("push_subs").upsert({ endpoint: sub.endpoint, player_id: p.id, p256dh: sub.keys.p256dh, auth: sub.keys.auth }, { onConflict: "endpoint" });
        if (b.test) await pushTo(p.id, "[СИСТЕМА]", "Уведомления включены. Система будет напоминать о квестах.", "hello");
        return json({ ok: true });
      }
      case "push_unsub": {
        const p = await playerByToken(b.token);
        if (!p) return fail("Неверный код игрока", 401);
        await db.from("push_subs").delete().eq("player_id", p.id);
        return json({ ok: true });
      }
      case "push_tick": {
        if (!b.secret || b.secret !== (await cfg("cron_secret"))) return fail("forbidden", 403);
        const slot = String(b.slot), td = todayUTC5();
        const { data: subs } = await db.from("push_subs").select("player_id");
        const ids = [...new Set((subs ?? []).map((x) => x.player_id))];
        if (!ids.length) return json({ sent: 0 });
        const { data: ps } = await db.from("players").select("id,name,today_quests,today_total,stats_date,skill_state,skill_date,streak").in("id", ids);
        let sent = 0;
        for (const pl of ps ?? []) {
          const fresh = pl.stats_date === td, q = fresh ? pl.today_quests : 0, total = pl.today_total || 3;
          const skillTodo = pl.skill_date === td ? pl.skill_state === "todo" : pl.skill_state !== "none" && pl.skill_state !== "rest";
          let title = "", body = "";
          if (slot === "morning") {
            title = "[СИСТЕМА] Новый день"; body = `${pl.name}, ${pick(PUSH_MORNING)}${skillTodo ? " Задание навыка тоже ждёт." : ""}`;
          } else if (slot === "day") {
            if (!fresh || q === 0) { title = "[СИСТЕМА] Ты ещё не начал"; body = "Сегодня нет ни одной записи. Запиши, что съел, — это займёт минуту."; }
          } else {
            if (q < total || skillTodo) {
              title = "[ВНИМАНИЕ] Квест не выполнен";
              body = `${q < total ? `Квесты: ${q}/${total}. ` : ""}${skillTodo ? "Задание навыка не сдано. " : ""}${pick(PUSH_EVENING)}${pl.streak > 2 ? ` Серия ${pl.streak} дн. под угрозой.` : ""}`;
            }
          }
          if (title) sent += await pushTo(pl.id, title, body, slot);
        }
        return json({ sent });
      }
      case "live_create": {
        const p = await playerByToken(b.token);
        if (!p) return fail("Неверный код игрока", 401);
        const opp = String(b.opponent ?? ""), exercise = String(b.exercise ?? "push");
        if (!["push", "squat", "abs"].includes(exercise)) return fail("Неизвестное упражнение");
        if (opp === p.id) return fail("Нельзя вызвать самого себя");
        const { data: o } = await db.from("players").select("id,name").eq("id", opp).maybeSingle();
        if (!o) return fail("Соперник не найден");
        const since = new Date(Date.now() - 10 * 60e3).toISOString();
        const { data: ex } = await db.from("live_duels").select("id").in("status", ["pending", "active"]).gte("created_at", since)
          .or(`and(a.eq.${p.id},b.eq.${opp}),and(a.eq.${opp},b.eq.${p.id})`);
        if (ex && ex.length) return fail("Живая дуэль с этим игроком уже идёт");
        const { data: d, error } = await db.from("live_duels").insert({ a: p.id, b: opp, exercise }).select("id").single();
        if (error) return fail("Не удалось создать дуэль", 500);
        const exn = { push: "отжимания", squat: "приседания", abs: "скручивания" }[exercise];
        pushTo(opp, "⚡ Живая дуэль", `${p.name} вызывает тебя: ${exn} на 60 секунд. Открой Ingot → Рейтинг → Дуэли.`, "live").catch(() => {});
        return json({ id: d.id });
      }
      case "live_respond": {
        const p = await playerByToken(b.token);
        if (!p) return fail("Неверный код игрока", 401);
        const { data: d } = await db.from("live_duels").select("*").eq("id", String(b.id ?? "")).maybeSingle();
        if (!d || d.b !== p.id || d.status !== "pending") return fail("Вызов не найден");
        if (Date.now() - new Date(d.created_at).getTime() > 10 * 60e3) { await db.from("live_duels").update({ status: "expired" }).eq("id", d.id); return fail("Вызов устарел"); }
        if (b.accept) await db.from("live_duels").update({ status: "active", start_at: new Date(Date.now() + 30e3).toISOString() }).eq("id", d.id);
        else await db.from("live_duels").update({ status: "declined" }).eq("id", d.id);
        return json({ ok: true });
      }
      case "live_update": case "live_state": {
        const p = await playerByToken(b.token);
        if (!p) return fail("Неверный код игрока", 401);
        const { data: d } = await db.from("live_duels").select("*").eq("id", String(b.id ?? "")).maybeSingle();
        if (!d || (d.a !== p.id && d.b !== p.id)) return fail("Дуэль не найдена");
        const now = Date.now(), end = d.start_at ? new Date(d.start_at).getTime() + d.seconds * 1000 : 0;
        if (b.action === "live_update" && d.status === "active" && now >= new Date(d.start_at).getTime() && now <= end + 5000) {
          const col = d.a === p.id ? "a_reps" : "b_reps", reps = int(b.reps, 0, 300);
          if (reps > d[col]) { await db.from("live_duels").update({ [col]: reps }).eq("id", d.id); d[col] = reps; }
        }
        if (d.status === "active" && now > end + 4000) {
          const winner = d.a_reps === d.b_reps ? null : d.a_reps > d.b_reps ? d.a : d.b;
          await db.from("live_duels").update({ status: "done", winner }).eq("id", d.id);
          d.status = "done"; d.winner = winner;
          if (winner) await postEvent(winner, "duel", `победил в живой дуэли: ${Math.max(d.a_reps, d.b_reps)} против ${Math.min(d.a_reps, d.b_reps)}`);
        }
        if (d.status === "pending" && now - new Date(d.created_at).getTime() > 10 * 60e3) { d.status = "expired"; await db.from("live_duels").update({ status: "expired" }).eq("id", d.id); }
        const { data: ns } = await db.from("players").select("id,name").in("id", [d.a, d.b]);
        const nm = Object.fromEntries((ns ?? []).map((x) => [x.id, x.name]));
        return json({ duel: { ...d, a_name: nm[d.a], b_name: nm[d.b] }, server_now: now });
      }
      case "live_list": {
        const p = await playerByToken(b.token);
        if (!p) return fail("Неверный код игрока", 401);
        const since = new Date(Date.now() - 24 * 3600e3).toISOString();
        const { data: list } = await db.from("live_duels").select("*").or(`a.eq.${p.id},b.eq.${p.id}`).gte("created_at", since)
          .not("status", "in", "(declined,expired)").order("created_at", { ascending: false }).limit(10);
        const ids = [...new Set((list ?? []).flatMap((d) => [d.a, d.b]))];
        const { data: ns } = ids.length ? await db.from("players").select("id,name").in("id", ids) : { data: [] };
        const nm = Object.fromEntries((ns ?? []).map((x) => [x.id, x.name]));
        const now = Date.now();
        return json({ live: (list ?? []).filter((d) => !(d.status === "pending" && now - new Date(d.created_at).getTime() > 10 * 60e3))
          .map((d) => ({ ...d, a_name: nm[d.a], b_name: nm[d.b] })), server_now: now });
      }
      case "barcode": {
        const p = await playerByToken(b.token);
        if (!p) return fail("Неверный код игрока", 401);
        const code = validCode(b.code);
        if (!code) return fail("Неверный штрихкод");
        let { data: f } = await db.from("foods").select("*").eq("code", code).maybeSingle();
        if (!f) {
          const off = await offLookup(code);
          if (off) { await db.from("foods").upsert(off, { onConflict: "code" }); f = { ...off, uses: 0, added_by: null }; }
        }
        if (!f) return json({ product: null, code });
        await db.from("foods").update({ uses: (f.uses ?? 0) + 1 }).eq("code", code);
        let by: string | null = null;
        if (f.added_by) { const { data: a } = await db.from("players").select("name").eq("id", f.added_by).maybeSingle(); by = a?.name ?? null; }
        return json({ product: { code, name: f.name, brand: f.brand, kcal: Number(f.kcal), p: Number(f.p), f: Number(f.f), c: Number(f.c),
          serving: f.serving ? Number(f.serving) : null, source: f.source, by, mine: f.added_by === p.id, uses: (f.uses ?? 0) + 1 } });
      }
      case "barcode_add": {
        const p = await playerByToken(b.token);
        if (!p) return fail("Неверный код игрока", 401);
        const code = validCode(b.code);
        if (!code) return fail("Неверный штрихкод");
        const name = String(b.name ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
        if (name.length < 2) return fail("Укажи название продукта");
        const kcal = n1(b.kcal, 950), pp = n1(b.p, 100), ff = n1(b.f, 100), cc = n1(b.c, 100);
        if (kcal == null || pp == null || ff == null || cc == null) return fail("Проверь КБЖУ: значения на 100 г");
        if (pp + ff + cc > 101) return fail("Белки + жиры + углеводы не могут быть больше 100 г на 100 г");
        const est = 4 * pp + 9 * ff + 4 * cc;
        if (kcal > 20 && est > 0 && Math.abs(est - kcal) / kcal > 0.35) return fail(`Калории не сходятся с БЖУ (по БЖУ выходит ~${Math.round(est)} ккал). Проверь этикетку.`);
        const today0 = new Date(); today0.setUTCHours(0, 0, 0, 0);
        const { count } = await db.from("foods").select("code", { count: "exact", head: true }).eq("added_by", p.id).gte("created_at", today0.toISOString());
        if ((count ?? 0) >= 20) return fail("Сегодня ты уже добавил 20 продуктов. Продолжим завтра.", 429);
        const { data: ex } = await db.from("foods").select("code,added_by").eq("code", code).maybeSingle();
        if (ex && ex.added_by !== p.id) return fail("Этот продукт уже есть в базе");
        const sv = n1(b.serving, 3000);
        await db.from("foods").upsert({ code, name, brand: String(b.brand ?? "").trim().slice(0, 40) || null, kcal, p: pp, f: ff, c: cc,
          serving: sv && sv > 0 ? sv : null, source: "player", added_by: p.id }, { onConflict: "code" });
        await db.from("food_reports").delete().eq("code", code);
        if (!ex) await postEvent(p.id, "food", `добавил в общую базу: ${name}`);
        return json({ ok: true, first: !ex });
      }
      case "barcode_report": {
        const p = await playerByToken(b.token);
        if (!p) return fail("Неверный код игрока", 401);
        const code = validCode(b.code);
        if (!code) return fail("Неверный штрихкод");
        await db.from("food_reports").upsert({ code, player_id: p.id }, { onConflict: "code,player_id" });
        const { count } = await db.from("food_reports").select("code", { count: "exact", head: true }).eq("code", code);
        const { data: f } = await db.from("foods").select("added_by").eq("code", code).maybeSingle();
        // 2 жалобы (или жалоба автора) — продукт убирается, следующий игрок добавит верные данные
        if (f && ((count ?? 0) >= 2 || f.added_by === p.id)) { await db.from("foods").delete().eq("code", code); return json({ ok: true, removed: true }); }
        return json({ ok: true, removed: false });
      }
      case "barcode_label": {
        const p = await playerByToken(b.token);
        if (!p) return fail("Неверный код игрока", 401);
        const image = String(b.image ?? "").replace(/^data:[^,]*,/, "");
        if (!image || image.length > 4_000_000) return fail("Фото не получено или слишком большое");
        const limit = int(Deno.env.get("PHOTO_LIMIT") ?? 15, 1, 1000);
        const day = todayUTC5();
        const used = p.photo_day === day ? p.photo_count : 0;
        if (used >= limit) return fail(`Лимит ${limit} фото в день исчерпан. Введи данные с этикетки вручную.`, 429);
        await db.from("players").update({ photo_day: day, photo_count: used + 1 }).eq("id", p.id);
        return json(await ai([{ image }, { text: "Прочитай таблицу пищевой ценности на этикетке." }], LABEL_SYSTEM, LABEL_SCHEMA, { maxTokens: 800 }));
      }
      case "foods_search": {
        const q = String(b.q ?? "").trim().toLowerCase().replace(/[%_,()]/g, " ").replace(/\s+/g, " ").slice(0, 40);
        if (q.length < 3) return json({ foods: [] });
        let req = db.from("foods").select("code,name,brand,kcal,p,f,c,serving,source");
        for (const w of q.split(" ").slice(0, 3)) req = req.ilike("name", `%${w}%`);
        const { data } = await req.order("uses", { ascending: false }).limit(6);
        return json({ foods: (data ?? []).map((f) => ({ ...f, kcal: Number(f.kcal), p: Number(f.p), f: Number(f.f), c: Number(f.c), serving: f.serving ? Number(f.serving) : null })) });
      }
      case "rename": {
        const p = await playerByToken(b.token);
        if (!p) return fail("Неверный код игрока", 401);
        const name = String(b.name ?? "").trim().replace(/\s+/g, " ").slice(0, 24);
        if (name.length < 2) return fail("Имя слишком короткое");
        if (name === p.name) return json({ name });
        const { error } = await db.from("players").update({ name, updated_at: new Date().toISOString() }).eq("id", p.id);
        if (error) return fail(error.code === "23505" ? "Это имя уже занято" : "Не удалось сменить имя");
        return json({ name });
      }
      default:
        return fail("unknown action");
    }
  } catch (e) {
    console.error(e);
    return fail(e instanceof Error ? e.message : "Ошибка сервера", 500);
  }
});

// для проверки в CI (.github/workflows/test-ai.yml)
export { ai, skillAI, SCHEMA, SYSTEM, TEXT_SYSTEM, imageParts, LABEL_SYSTEM, LABEL_SCHEMA, fromOFF, offLookup };
