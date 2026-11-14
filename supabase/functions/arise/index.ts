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

const TEXT_SYSTEM = `You are a professional nutritionist inside a calorie-tracking app for users in Uzbekistan and the CIS.
The user describes what they ate in Russian (free text, may include weight, cooking method, brand).
Split it into distinct food items and estimate for each: portion weight in grams, calories, protein, fat, carbohydrates.
- If a weight is given, use it exactly. If not, assume a typical single portion and mark confidence "medium".
- Account for cooking method and added fat/sugar ("с маслом", "жареный", "с сахаром").
- Know local dishes well (плов, лагман, самса, манты, шурпа, нарын, лепёшка, шашлык и т.д.) with typical Tashkent recipes.
- Use standard nutrition references per 100 g, then scale. Calories must match macros (≈4P+9F+4C within ~10%).
Names in Russian, short, lower-case. If the text is not food, set is_food=false and return an empty list.`;

function imageParts(image: string, hint: string) {
  return [
    { inline_data: { mime_type: "image/jpeg", data: image } },
    { text: hint ? `Уточнение от пользователя: ${hint}\n\nОпредели продукты на фото и оцени КБЖУ.` : "Определи продукты на фото и оцени КБЖУ." },
  ];
}

async function gemini(parts: unknown[], system = SYSTEM, schema: unknown = SCHEMA, temperature = 0.2) {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new Error("На сервере не задан GEMINI_API_KEY");
  const models = [Deno.env.get("GEMINI_MODEL"), "gemini-flash-latest", "gemini-2.5-flash", "gemini-flash-lite-latest", "gemini-2.5-flash-lite"]
    .filter(Boolean) as string[];
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts }],
    generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature, maxOutputTokens: 16000 },
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
      const text = (d.candidates?.[0]?.content?.parts ?? []).filter((p: { thought?: boolean }) => !p.thought)
        .map((p: { text?: string }) => p.text ?? "").join("");
      if (!text) { lastErr = "пустой ответ модели"; continue; }
      try { return JSON.parse(text); } catch { lastErr = "ответ модели не JSON"; continue; }
    }
    lastErr = `${model}: ${r.status} ${(await r.text()).slice(0, 200)}`;
    console.error("gemini", lastErr);
    // 404 — модели нет, 429 — исчерпан бесплатный лимит этой модели, 5xx — сбой: пробуем следующую
    if (![404, 429, 500, 503].includes(r.status)) break;
  }
  if (lastErr.includes(" 429 ")) throw new Error("Бесплатный лимит ИИ на сегодня исчерпан. Попробуй позже.");
  throw new Error("Сервис ИИ недоступен. Попробуй позже.");
}

/* ---------------- навыки ---------------- */
const S_ = (type: string, extra: Record<string, unknown> = {}) => ({ type, ...extra });
const OBJ = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: "OBJECT", properties, required });
const ARR = (items: unknown) => ({ type: "ARRAY", items });
const STR = S_("STRING"), NUM = S_("NUMBER"), BOOL = S_("BOOLEAN");

const MENTOR = `Ты — «Система»: персональный наставник в приложении ARISE (стиль: охотники, ранги, квесты), но прежде всего —
опытный практик и преподаватель в теме, которую осваивает человек. Твоя единственная цель — чтобы человек РЕАЛЬНО освоил навык
за месяц и смог применять его в жизни, а не просто «прошёл курс».
Принципы: конкретика вместо общих слов; практика каждый день; маленькие шаги с видимым результатом; обратная связь по делу;
учитывай время, технику, бюджет и язык человека; не предлагай платное, если бюджет 0; не выдумывай ссылки — давай поисковые запросы.
Пиши по-русски, коротко и ясно. Соблюдай тон, который выбрал человек (жёстко / строго с поддержкой / мягко).`;

const RESOURCE = OBJ({ title: STR, kind: S_("STRING", { enum: ["video", "article", "practice", "tool"] }), query: STR });
const DAY = OBJ({
  day: NUM, title: STR, what: STR, resource: RESOURCE, deliverable: STR, why: STR, minutes: NUM, rest: BOOL,
});

const SKILL_KINDS: Record<string, { schema: unknown; prompt: (c: Record<string, unknown>) => string; temp?: number }> = {
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
hint — подсказка, что можно ответить «не знаю», если не знает. Учитывай, что человек может быть полным новичком.`,
  },
  plan: {
    temp: 0.5,
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
- Задания должны усложняться, повторять важное (интервальное повторение) и постоянно работать на финальный проект.`,
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
title — пафосное название босса в стиле подземелий (например «Страж Промптов»). intro — 1 фраза вызова.
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
    schema: OBJ({ note: STR, days: ARR(DAY) }),
    prompt: (c) => `Человек оценил, как идёт обучение. Перестрой следующие дни плана (те же номера дней, что в remaining) под его отзыв.
Данные: ${JSON.stringify(c)}
Если «тяжело» — меньше объём, проще шаги, больше быстрых побед, но не меняй цель. Если «легко» — сложнее и глубже.
Если «норм» — только учти комментарий. Сохрани дни босса (7/14/21/28), день 30 и rest-дни. note — 1 фраза, что изменилось.`,
  },
};

async function skillAI(kind: string, ctx: Record<string, unknown>, image?: string) {
  const k = SKILL_KINDS[kind];
  if (!k) throw new Error("unknown skill kind");
  const parts: unknown[] = [];
  if (image) parts.push({ inline_data: { mime_type: "image/jpeg", data: image } });
  parts.push({ text: k.prompt(ctx) });
  return await gemini(parts, MENTOR, k.schema, k.temp ?? 0.3);
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
        const res = await gemini(imageParts(image, String(b.hint ?? "").slice(0, 300)));
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
        const res = await gemini([{ text: `Что съел пользователь: ${text}` }], TEXT_SYSTEM);
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
