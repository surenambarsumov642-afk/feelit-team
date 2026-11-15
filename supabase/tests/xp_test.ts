// Защита от накрутки: проверка checkStats без сети. Запуск: deno run -A supabase/tests/xp_test.ts
Deno.env.set("SUPABASE_URL", Deno.env.get("SUPABASE_URL") || "http://localhost:1");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "x");
const { checkStats, levelFromXp, badText } = await import("../functions/arise/index.ts");
const day = (n: number) => { const t = new Date(Date.now() + 5 * 3600e3); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
let ok = true;
const eq = (name: string, got: unknown, want: unknown) => { const g = JSON.stringify(got) === JSON.stringify(want); if (!g) ok = false; console.log(`${g ? "OK " : "BAD"} ${name}: ${JSON.stringify(got)}${g ? "" : " ≠ " + JSON.stringify(want)}`); };

eq("level 0 xp", levelFromXp(0), 1);
eq("level 100 xp", levelFromXp(100), 2);
eq("level 225 xp", levelFromXp(225), 3);
// новичок, зарегистрирован сегодня, присылает 1 000 000 XP → режется до дневного лимита
let r = checkStats({ created_at: day(0) + "T10:00:00Z", xp: 0, rank: "E" }, { xp: 1_000_000, rank: "N", streak: 500 });
eq("newbie cheat xp", r.xp, 1500); eq("newbie flag", r.flag, true); eq("newbie rank capped (lv 9 → E)", r.rank, "E"); eq("newbie streak", r.streak, 1);
// повторная синхронизация в тот же день не даёт ещё +1500
r = checkStats({ created_at: day(0), xp: 1500, rank: "D", xp_base: 0, xp_base_day: day(0), xp_span: 1 }, { xp: 3000, rank: "D" });
eq("same-day resync", r.xp, 1500);
// честный игрок: +300 за день
r = checkStats({ created_at: day(-30), xp: 5000, rank: "C", xp_base: 4800, xp_base_day: day(-1), xp_span: 1 }, { xp: 5300, rank: "C", streak: 20 });
eq("honest xp", r.xp, 5300); eq("honest flag", r.flag, false); eq("honest streak", r.streak, 20);
// был офлайн 10 дней — лимит умножается
r = checkStats({ created_at: day(-60), xp: 2000, rank: "D", xp_base: 2000, xp_base_day: day(-10), xp_span: 1 }, { xp: 9000, rank: "D" });
eq("offline 10 days", r.xp, 9000); eq("offline span", r.span, 10);
// ранг не прыгает через ступень и не выше уровня
r = checkStats({ created_at: day(-400), xp: 60000, rank: "C", xp_base: 60000, xp_base_day: day(0) }, { xp: 60000, rank: "S" });
eq("rank +1 step", r.rank, "B");
// штрафы могут уменьшать опыт
r = checkStats({ created_at: day(-5), xp: 300, rank: "E", xp_base: 300, xp_base_day: day(-1) }, { xp: 250, rank: "E" });
eq("penalty down", r.xp, 250);
for (const [t, want] of [["Сурен", false], ["Дильноза", false], ["кефир 2,5% Nestle", false], ["хлеба ржаного", false], ["требую", false], ["рубля", false], ["Basik", false],
  ["Х у й", true], ["пидор", true], ["fuck", true], ["t.me/shop", true], ["mysite.com", true], ["п1здец", true]] as [string, boolean][]) eq(`moderation «${t}»`, badText(t), want);
console.log(ok ? "\nXP: всё OK" : "\nXP: ЕСТЬ ОШИБКИ");
if (!ok) Deno.exit(1);
Deno.exit(0);
