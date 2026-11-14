// Живая проверка ИИ (Groq/Cloudflare) без базы данных. Запуск: deno run -A supabase/tests/ai_test.ts food.jpg
const { ai, skillAI, SCHEMA, SYSTEM, TEXT_SYSTEM, imageParts } = await import("../functions/arise/index.ts");
const t0 = () => performance.now();
const show = (name: string, ms: number, v: unknown) => console.log(`\n### ${name} — ${(ms / 1000).toFixed(1)} с\n${JSON.stringify(v, null, 1).slice(0, 2500)}`);
async function step(name: string, fn: () => Promise<unknown>) {
  const s = t0();
  try { const v = await fn(); show(name, t0() - s, v); return v as any; }
  catch (e) { console.log(`\n### ${name} — ОШИБКА: ${(e as Error).message}`); return null; }
}
const { encodeBase64 } = await import("jsr:@std/encoding/base64");
const img = Deno.args[0] ? encodeBase64(await Deno.readFile(Deno.args[0])) : "";
if (img) await step("Фото еды", () => ai(imageParts(img, ""), SYSTEM, SCHEMA, { maxTokens: 2000 }));
await step("Текст: плов 300 г и чай с сахаром", () => ai([{ text: "Что съел пользователь: плов 300 г и чай с сахаром" }], TEXT_SYSTEM, SCHEMA, { maxTokens: 1500 }));
const base = { skill: "ИИ-видео", result: "делать короткие рекламные ролики для кафе с помощью ИИ", why: "хочу зарабатывать", success: "сделаю 3 ролика и продам один" };
await step("Навык: уточнение цели", () => skillAI("clarify", base));
await step("Навык: проверка уровня", () => skillAI("diag", { ...base, tried: "пару раз пробовал Pika", device: "Только телефон" }));
const plan = await step("Навык: план на 30 дней", () => skillAI("plan", { ...base, goal_30_days: base.result, tried: "пару раз пробовал Pika",
  hardest: ["Бросаю через неделю"], minutes_weekday: "45", minutes_weekend: "90", free_time: "после 21:00", device: "Только телефон", budget: "$0",
  materials_language: "английский с субтитрами", city: "Ташкент", formats: ["Сразу пробовать руками"], tone: "Жёстко, без жалости", rest_days: [7, 14],
  start_weekday: "пн", diagnostic: [{ q: "Какие сервисы знаешь?", answer: "Pika, Runway" }, { q: "Промпт для сцены", answer: "кот пьёт кофе" }, { q: "text-to-video vs image-to-video", answer: "не знаю" }] }));
if (plan) console.log(`\nДней в плане: ${plan.days.length}; дни: ${plan.days.map((d: any) => d.day).join(",")}`);
if (plan) await step("Навык: проверка работы", () => skillAI("review", { skill: "ИИ-видео", level: plan.profile.level, tone: "строго", task: plan.days[0], submission: "Сделал промпт: cinematic close-up of a latte in a cozy Tashkent cafe, warm morning light, slow dolly-in, 5 seconds" }));
Deno.exit(0);
