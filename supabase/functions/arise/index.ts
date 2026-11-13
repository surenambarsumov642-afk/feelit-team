// ARISE — серверная функция Supabase.
// Действия: register, sync, leaderboard, restore, analyze (распознавание еды через Gemini).
// Секреты: GEMINI_API_KEY (обязательно), GEMINI_MODEL (необязательно), PHOTO_LIMIT (фото в день на игрока, по умолчанию 15).
import { createClient } from "npm:@supabase/supabase-js@2";

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

/* ---------------- Gemini ---------------- */
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

async function gemini(image: string, hint: string) {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new Error("На сервере не задан GEMINI_API_KEY");
  const models = [Deno.env.get("GEMINI_MODEL"), "gemini-flash-latest", "gemini-2.5-flash", "gemini-flash-lite-latest", "gemini-2.5-flash-lite"]
    .filter(Boolean) as string[];
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{
      role: "user",
      parts: [
        { inline_data: { mime_type: "image/jpeg", data: image } },
        { text: hint ? `Уточнение от пользователя: ${hint}\n\nОпредели продукты на фото и оцени КБЖУ.` : "Определи продукты на фото и оцени КБЖУ." },
      ],
    }],
    generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0.2 },
  };
  let lastErr = "";
  for (const model of models) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
    });
    if (r.ok) {
      const d = await r.json();
      const text = (d.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
      if (!text) { lastErr = "пустой ответ модели"; continue; }
      return JSON.parse(text);
    }
    lastErr = `${model}: ${r.status} ${(await r.text()).slice(0, 200)}`;
    console.error("gemini", lastErr);
    // 404 — модели нет, 429 — исчерпан бесплатный лимит этой модели, 5xx — сбой: пробуем следующую
    if (![404, 429, 500, 503].includes(r.status)) break;
  }
  if (lastErr.includes(" 429 ")) throw new Error("Бесплатный лимит Gemini на сегодня исчерпан. Используй ручной ввод.");
  throw new Error("Сервис распознавания недоступен. Попробуй позже.");
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
          ...(save ? { save } : {}), updated_at: new Date().toISOString(),
        }).eq("id", p.id);
        if (error) return fail("Ошибка сохранения", 500);
        return json({ ok: true });
      }
      case "leaderboard": {
        const { data, error } = await db.from("players")
          .select("id,name,level,rank,xp,streak,best_streak,perfect_days,workouts,title,today_quests,today_total,stats_date,updated_at")
          .order("xp", { ascending: false }).limit(100);
        if (error) return fail("Ошибка чтения", 500);
        return json({ players: data });
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
        const res = await gemini(image, String(b.hint ?? "").slice(0, 300));
        return json({ ...res, photos_left: limit - used - 1 });
      }
      default:
        return fail("unknown action");
    }
  } catch (e) {
    console.error(e);
    return fail(e instanceof Error ? e.message : "Ошибка сервера", 500);
  }
});
