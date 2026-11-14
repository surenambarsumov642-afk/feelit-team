// Живая проверка новых запросов ИИ: анализ месяца, карта применения, клиент в тренажёре, оценка переговоров.
const { skillAI } = await import("../functions/arise/index.ts");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let ok = true;
async function step(name: string, fn: () => Promise<any>, check: (r: any) => boolean) {
  const t = performance.now();
  try {
    const r = await fn();
    const good = check(r);
    console.log(`\n### ${name} — ${((performance.now() - t) / 1000).toFixed(1)} с ${good ? "OK" : "ПЛОХО"}\n${JSON.stringify(r, null, 1).slice(0, 1800)}`);
    if (!good) ok = false;
    return r;
  } catch (e) { console.log(`\n### ${name}: ошибка ${(e as Error).message}`); ok = false; }
}
await wait(20000); // минутный лимит Groq после прошлых шагов
const prev = { skill: "ИИ-видео", level: 1, goal: "рекламные ролики для кафе", mastery: 72, done: "22/26", missed_days: 2,
  bosses: [{ title: "Страж Промптов", score: 70, weak: ["монтаж под музыку"] }], final_project: "3 ролика для кафе", final_score: 80,
  final_feedback: "Сильные промпты, слабый монтаж", next_advice: "монтаж", weak: ["монтаж"], journal: ["понял, как писать промпт со светом"], gap_days: 2, mode: "upgrade" };
await step("Анализ месяца", () => skillAI("upgrade_analysis", prev), (r) => r.summary && r.gaps?.length >= 1 && r.branches?.length >= 2);
await wait(15000);
const map = await step("Карта применения", () => skillAI("world_map", { skill: "ИИ-видео", level: 2, mastery: 72, projects_done: ["3 ролика для кафе"], city: "Ташкент", device: "Есть компьютер", direction: "money" }),
  (r) => r.who?.length >= 3 && r.services?.length >= 2 && r.messages?.length >= 2);
await wait(15000);
const service = { skill: "ИИ-видео", services: map?.services ?? [] };
const persona = map?.who?.[0] ?? { who: "кофейня", pain: "нет контента" };
const history: { role: string; text: string }[] = [];
const c1 = await step("Клиент: первая реплика", () => skillAI("client_sim", { service, persona, history }), (r) => typeof r.reply === "string" && r.reply.length > 5);
history.push({ role: "client", text: c1?.reply ?? "Здравствуйте" }, { role: "me", text: "Здравствуйте! Ролик 15 секунд для Instagram — 200 тысяч сум, сделаю за 2 дня. Для чего вам ролик?" });
await wait(8000);
const c2 = await step("Клиент: ответ", () => skillAI("client_sim", { service, persona, history }), (r) => typeof r.reply === "string");
history.push({ role: "client", text: c2?.reply ?? "" }, { role: "me", text: "Могу сделать пробный вариант бесплатно, если понравится — оплатите следующий." });
await wait(8000);
await step("Оценка переговоров", () => skillAI("client_grade", { service, persona, history }), (r) => r.score >= 0 && r.score <= 100 && r.feedback);
if (!ok) Deno.exit(1);
console.log("\nworld OK");
Deno.exit(0);
