// Ingot — учёт калорий в стиле «Системы». Данные на устройстве + синхронизация с сервером (рейтинг, резервная копия).
import { API_URL } from "./config.js";
import { searchFoods, gramsFromText } from "./foods.js";
import { initSkills, renderSkills, statusCard, skillXpByDate, shameTitle, finishedSkills, masteryRank, skillTodayState, openWorldView } from "./skills.js";
import { initGates, gatesWin, bindGates, settleGates } from "./gates.js";
import { initExams, effectiveRank, exMult, examWin, bindExam, settleExam, rankIdx, RANK_TITLE, RANKS, RANK_LV, rankName, rankMono, rankLabel, rankGlyph } from "./exams.js";
import { phrase, sfx, dailyPhrase, RARITY } from "./phrases.js";
import { showIntro } from "./intro.js";
import { initWorld, renderWorld, worldDue } from "./world.js";
const CAM = ["push", "squat", "abs"]; // упражнения, которые считает камера (бег — вручную)
const loadPose = () => import("./pose.js");
const loadScanner = () => import("./scanner.js");
const STORE_KEY = "arise-calories-v1";
/** Функции второй версии (дуэли, сезоны, испытания недели) спрятаны до роста базы. Включить для теста: localStorage["ingot-v2"]="1". */
const V2 = (() => { try { return localStorage.getItem("ingot-v2") === "1"; } catch { return false; } })();
const $app = document.getElementById("app");

/* ============================ утилиты ============================ */
const pad = n => String(n).padStart(2, "0");
const dstr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => dstr(new Date());
const parseD = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return dstr(d); };
const nowTime = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const num = v => { const x = parseFloat(String(v ?? "").replace(",", ".")); return isFinite(x) ? x : 0; };
const r0 = x => Math.round(x);
const r1 = x => Math.round(x * 10) / 10;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const WD = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
function humanDate(s) {
  if (s === today()) return "Сегодня";
  if (s === addDays(today(), -1)) return "Вчера";
  const d = parseD(s); return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${WD[d.getDay()]}`;
}
function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many; if (b > 1 && b < 5) return few; if (b === 1) return one; return many;
}

const MEALS = [
  { id: "breakfast", name: "Завтрак" },
  { id: "lunch", name: "Обед" },
  { id: "dinner", name: "Ужин" },
  { id: "snack", name: "Перекус" },
];
const mealName = id => (MEALS.find(m => m.id === id) || MEALS[3]).name;
function mealByTime() {
  const h = new Date().getHours();
  if (h >= 4 && h < 11) return "breakfast";
  if (h >= 11 && h < 16) return "lunch";
  if (h >= 16 && h < 21) return "dinner";
  return "snack";
}

const ACTIVITY = [
  { v: 1.2, n: "Минимальная — сидячая работа, без спорта" },
  { v: 1.375, n: "Лёгкая — 1–3 тренировки в неделю" },
  { v: 1.55, n: "Средняя — 3–5 тренировок в неделю" },
  { v: 1.725, n: "Высокая — 6–7 тренировок в неделю" },
  { v: 1.9, n: "Очень высокая — физ. работа + спорт" },
];

/* ============================ хранилище ============================ */
function defaultState() {
  return {
    v: 1, profile: null, player: null,
    entries: [], weights: [], workouts: {}, verified: {}, skills: [], gates: {}, adj: [], extraTitles: [], duelsApplied: {}, title: null,
    seen: { level: 1, ach: [], quests: {}, penalties: [] },
  };
}
let S = load();
function load() {
  try { const s = JSON.parse(localStorage.getItem(STORE_KEY)); if (s && s.v) return Object.assign(defaultState(), s); } catch {}
  return defaultState();
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); }
  catch (e) { toast("Память переполнена: удалите старые фото-записи или сделайте экспорт", true); }
  scheduleSync();
}

/* ============================ сервер ============================ */
async function api(action, body = {}) {
  if (!API_URL) throw new Error("Сервер ещё не подключён");
  let r;
  try {
    r = await fetch(API_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...body }) });
  } catch { throw new Error("Нет связи с сервером. Проверь интернет."); }
  let d = {};
  try { d = await r.json(); } catch {}
  if (!r.ok || d.error) throw new Error(d.error || `Ошибка сервера (${r.status})`);
  return d;
}
let syncT = null, syncing = false;
function scheduleSync(delay = 2500) {
  if (!API_URL || !S.player || !S.profile) return;
  clearTimeout(syncT); syncT = setTimeout(syncNow, delay);
}
async function syncNow() {
  if (!API_URL || !S.player || !S.profile || syncing) return;
  syncing = true;
  try {
    const P = computeProgress(), d = P.days[today()];
    const t = titleById(S.title);
    const backup = Object.assign({}, S, { player: null, entries: S.entries.map(e => Object.assign({}, e, { thumb: null })) });
    await api("sync", {
      token: S.player.token,
      stats: { level: P.level, rank: P.rank, xp: P.xp, streak: P.streak, best_streak: P.longest, perfect_days: P.perfectDays,
        workouts: P.workoutDays, skill_state: skillTodayState(), title: shameTitle() || (t ? t.n : null), today_quests: d ? d.doneCount : 0, today_total: QUESTS.length, stats_date: today() },
      save: backup,
      days: Object.entries(P.days).slice(-400).map(([day, x]) => ({ day, xp: x.xp, norm: !!x.q.norm.done, workout: !!x.q.workout.done, quests: x.doneCount })),
    });
  } catch (e) { /* офлайн — попробуем позже */ }
  finally { syncing = false; }
}

/** Событие в общую ленту друзей (тихо, без ошибок). */
function postEvent(kind, text) {
  if (!API_URL || !S.player) return;
  api("event", { token: S.player.token, kind, text }).catch(() => {});
}
/** Все титулы: достижения + особые (Врата, сезоны). */
function titleById(id) { return id ? (ACH.find(a => a.id === id) || (S.extraTitles || []).find(t => t.id === id) || null) : null; }

/* ============================ нормы и план ============================ */
function goalOf(p) {
  const tw = +p.targetWeight || p.weight;
  if (tw < p.weight - 0.5) return "lose";
  if (tw > p.weight + 0.5) return "gain";
  return "keep";
}
function calcTargets(p) {
  const goal = goalOf(p);
  const tw = +p.targetWeight || p.weight;
  const bmr = 10 * p.weight + 6.25 * p.height - 5 * p.age + (p.sex === "m" ? 5 : -161);
  const tdee = bmr * p.activity;
  const floor = Math.max(p.sex === "m" ? 1500 : 1200, Math.round(bmr * 0.95));
  let rate = 0, kcal = tdee; // rate — кг в неделю
  if (goal === "lose") {
    rate = Math.min(0.9, Math.max(0.3, p.weight * 0.0075));          // ~0.75% веса в неделю
    kcal = tdee - rate * 7700 / 7;
    if (kcal < floor) { kcal = floor; rate = Math.max(0.1, (tdee - floor) * 7 / 7700); }
  } else if (goal === "gain") {
    rate = 0.25; kcal = tdee + rate * 7700 / 7;
  }
  kcal = Math.round(kcal / 10) * 10;
  const protBase = goal === "lose" ? Math.min(p.weight, tw + 5) : p.weight;
  const prot = Math.round(protBase * (goal === "lose" ? 2.0 : goal === "gain" ? 1.8 : 1.6));
  const fat = Math.round(Math.max(kcal * 0.25, p.weight * 0.7) / 9);
  const carbs = Math.max(0, Math.round((kcal - prot * 4 - fat * 9) / 4));
  const diff = Math.abs(tw - p.weight);
  const weeks = rate > 0 ? Math.ceil(diff / rate) : 0;
  const steps = goal === "lose" ? (p.activity <= 1.2 ? 8000 : 10000) : goal === "gain" ? 7000 : 8000;
  return { kcal, p: prot, f: fat, c: carbs, bmr: Math.round(bmr), tdee: Math.round(tdee), goal, rate: r1(rate), weeks,
    steps, water: Math.round(p.weight * 30 / 100) / 10, target: tw, diff: r1(diff) };
}
const targets = () => (S.profile.customTargets && S.profile.targets) ? Object.assign(calcTargets(S.profile), S.profile.targets) : calcTargets(S.profile);
function planText(t) {
  if (t.goal === "keep") return `Цель — держать вес ${t.target} кг.`;
  const verb = t.goal === "lose" ? "сбросить" : "набрать";
  return `Нужно ${verb} ${t.diff} кг (до ${t.target} кг).\nТемп: ~${t.rate} кг в неделю → примерно ${t.weeks} ${plural(t.weeks, "неделя", "недели", "недель")} (к ${monthName(t.weeks)}).`;
}
function monthName(weeks) {
  const d = new Date(); d.setDate(d.getDate() + weeks * 7);
  const M = ["январю", "февралю", "марту", "апрелю", "маю", "июню", "июлю", "августу", "сентябрю", "октябрю", "ноябрю", "декабрю"];
  return `${M[d.getMonth()]} ${d.getFullYear()}`;
}

/* ============================ тренировка (квест «Система») ============================ */
const EX = [
  { id: "push", n: "Отжимания", base: 20, step: 4, max: 100, unit: "", inc: 10 },
  { id: "squat", n: "Приседания", base: 30, step: 4, max: 100, unit: "", inc: 10 },
  { id: "abs", n: "Скручивания", base: 20, step: 4, max: 100, unit: "", inc: 10 },
  { id: "run", n: "Бег / быстрая ходьба", base: 2, step: 0.4, max: 10, unit: " км", inc: 1 },
];
const exTarget = (ex, lvl, d) => {
  let v = Math.min(ex.max, ex.base + (lvl - 1) * ex.step);
  const m = d ? exMult(d) : 1;
  if (m === "max") v = ex.max;
  else if (m === 3) v = Math.min(ex.max * 2, v * 3);
  else if (m !== 1) v = Math.min(ex.max, v * m);
  return ex.id === "run" ? r1(v) : Math.round(v);
};
const wDay = d => S.workouts[d] || {};
const vDay = d => (S.verified || {})[d] || {};
/** Во время экзамена отжимания/приседания/скручивания засчитываются только с камеры. */
function workoutDone(d, lvl) {
  const w = wDay(d), v = vDay(d), exam = exMult(d) !== 1;
  return EX.every(ex => ((exam && CAM.includes(ex.id) ? v[ex.id] : w[ex.id]) || 0) >= exTarget(ex, lvl, d));
}
/** Тренировка подтверждена камерой: все «камерные» упражнения набраны по камере. */
function workoutVerified(d, lvl) { const v = vDay(d); return EX.filter(ex => CAM.includes(ex.id)).every(ex => (v[ex.id] || 0) >= exTarget(ex, lvl, d)); }

/* ============================ прогресс «Системы» ============================ */
const XP = { entry: 5, entryCap: 10, log: 30, protein: 40, norm: 60, workout: 80, allBonus: 50 };
const SHIELD_MAX = 3;
const QUESTS = [
  { id: "workout", name: "Тренировка Системы", xp: XP.workout },
  { id: "log", name: "Вести учёт питания", xp: XP.log },
  { id: "norm", name: "Уложиться в норму калорий", xp: XP.norm },
];
const xpNeed = lvl => 100 + 25 * (lvl - 1);
const RANK_NAMES = RANK_TITLE;

function daySums(date) {
  const s = { kcal: 0, p: 0, f: 0, c: 0, count: 0, photos: 0, meals: 0 };
  const meals = new Set();
  for (const e of S.entries) if (e.date === date) {
    s.kcal += e.kcal; s.p += e.p; s.f += e.f; s.c += e.c; s.count++; meals.add(e.meal); if (e.source === "photo") s.photos++;
  }
  s.meals = meals.size;
  return s;
}
function normRange(t) {
  const hi = t.goal === "gain" ? 1.10 : 1.05;
  return [Math.round(t.kcal * 0.85), Math.round(t.kcal * hi)];
}
function evalQuests(s, t, d, lvl) {
  const [lo, hi] = normRange(t);
  const w = wDay(d), parts = EX.filter(ex => (w[ex.id] || 0) >= exTarget(ex, lvl, d)).length;
  return {
    workout: { done: workoutDone(d, lvl), verified: workoutVerified(d, lvl), prog: `${parts}/${EX.length} упражнений${workoutVerified(d, lvl) ? " · ✓ камера" : ""}` },
    log: { done: s.count >= 1, prog: s.count ? `записей: ${s.count}` : "запиши всё, что ешь сегодня" },
    protein: { done: s.p >= t.p * 0.9, prog: `${r0(s.p)}/${r0(t.p * 0.9)} г` },
    norm: { done: s.kcal >= lo && s.kcal <= hi, over: s.kcal > hi, prog: `${lo}–${hi} ккал` },
  };
}

function computeProgress() {
  const t = targets();
  const start = S.profile.createdAt, td = today();
  const byDate = {};
  for (const e of S.entries) (byDate[e.date] ||= []).push(e);
  let xp = 0, cur = 0, longest = 0, proteinDays = 0, normDays = 0, perfectDays = 0, photos = 0, entries = S.entries.length, workoutDays = 0;
  let lvl = 1, lvlRest = 0, shields = 1, run = 0;
  const skXP = skillXpByDate();
  for (const a of S.adj || []) skXP[a.date] = (skXP[a.date] || 0) + a.xp;
  const days = {};
  const first = [start, ...Object.keys(byDate), ...Object.keys(S.workouts)].sort()[0];
  // корректировки XP за даты раньше первого дня учитываем в первом дне
  for (const d of Object.keys(skXP)) if (d < first) { skXP[first] = (skXP[first] || 0) + skXP[d]; delete skXP[d]; }
  for (let d = first; d <= td; d = addDays(d, 1)) {
    const s = daySums(d);
    photos += s.photos;
    const dayLvl = lvl;
    const q = evalQuests(s, t, d, dayLvl);
    const closed = d < td;
    let dx = XP.entry * Math.min(s.count, XP.entryCap) + (skXP[d] || 0);
    const doneIds = QUESTS.filter(x => q[x.id].done).map(x => x.id);
    for (const id of doneIds) dx += id === "workout" && !q.workout.verified ? Math.round(XP.workout / 2) : QUESTS.find(x => x.id === id).xp;
    const all = doneIds.length === QUESTS.length;
    if (all) { dx += XP.allBonus; perfectDays++; }
    if (q.protein.done) proteinDays++;
    if (q.workout.done) workoutDays++;
    if (q.norm.done) normDays++;
    // Штрафов XP больше нет: пропуск не отнимает опыт, а серию спасает щит (см. ниже).
    const penalty = null;
    xp = Math.max(0, xp + dx);
    lvl = 1; lvlRest = xp; while (lvlRest >= xpNeed(lvl)) { lvlRest -= xpNeed(lvl); lvl++; }
    const active = s.count > 0 || q.workout.done || (skXP[d] || 0) > 0;
    // Щиты серии: 1 в подарок, +1 за каждые 7 активных дней подряд (максимум 3). Пропущенный день съедает щит, серия не обнуляется.
    let shielded = false;
    if (active) { cur++; run++; longest = Math.max(longest, cur); if (run % 7 === 0) shields = Math.min(SHIELD_MAX, shields + 1); }
    else if (closed) { if (shields > 0 && cur > 0) { shields--; shielded = true; } else { cur = 0; } run = 0; }
    days[d] = { s, q, xp: dx, penalty, all, lvl: dayLvl, doneCount: doneIds.length, shielded };
  }
  let level = 1, rest = xp;
  while (rest >= xpNeed(level)) { rest -= xpNeed(level); level++; }
  const rank = effectiveRank(level);
  const stats = {
    str: 10 + workoutDays,
    hp: 10 + proteinDays,
    vit: 10 + longest,
    dis: 10 + normDays,
    per: 10 + Math.floor(photos / 3),
  };
  return { xp, level, into: rest, need: xpNeed(level), rank, stats, streak: cur, shields, longest, proteinDays, normDays, perfectDays, photos, entries, days, weights: S.weights.length, workoutDays, mapped: S.mapped || 0 };
}

/* ============================ достижения ============================ */
// r — редкость: 1 обычный, 2 редкий, 3 эпический, 4 легендарный, 5 мифический
const ACH = [
  { id: "awaken", r: 1, ic: "⚡", n: "Первый шаг", d: "Сделать первую запись", ok: P => P.entries >= 1 },
  { id: "eye", r: 1, ic: "👁", n: "Око Системы", d: "Распознать еду по фото", ok: P => P.photos >= 1 },
  { id: "train1", r: 1, ic: "🩸", n: "Первая кровь", d: "Выполнить тренировку Системы", ok: P => P.workoutDays >= 1 },
  { id: "perfect1", r: 1, ic: "✦", n: "Безупречный день", d: "Выполнить все квесты за день", ok: P => P.perfectDays >= 1 },
  { id: "streak3", r: 1, ic: "🔥", n: "Разгорелся", d: "3 дня подряд с записями", ok: P => P.longest >= 3 },
  { id: "weigh", r: 1, ic: "⚙", n: "Взгляд в зеркало", d: "Записать вес 5 раз", ok: P => P.weights >= 5 },
  { id: "mapper1", r: 1, ic: "▦", n: "Первооткрыватель", d: "Добавить продукт в общую базу", ok: P => P.mapped >= 1 },
  { id: "streak7", r: 2, ic: "🗡", n: "Неделя без слабости", d: "7 дней подряд с записями", ok: P => P.longest >= 7 },
  { id: "train10", r: 2, ic: "⚔", n: "Закалённый в бою", d: "10 тренировок Системы", ok: P => P.workoutDays >= 10 },
  { id: "protein10", r: 2, ic: "💪", n: "Железная плоть", d: "10 дней с нормой белка", ok: P => P.proteinDays >= 10 },
  { id: "streak14", r: 2, ic: "☄", n: "Пламя не гаснет", d: "14 дней подряд с записями", ok: P => P.longest >= 14 },
  { id: "lvl25", r: 2, ic: "⬆", n: "Восходящий", d: "Достичь 25 уровня", ok: P => P.level >= 25 },
  { id: "scribe", r: 2, ic: "📜", n: "Летописец Системы", d: "100 записей", ok: P => P.entries >= 100 },
  { id: "rankD", r: 2, ic: "Б", n: "Боец", d: "Получить ранг «Боец»", ok: P => rankIdx(P.rank) >= 1 },
  { id: "norm14", r: 3, ic: "⚖", n: "Мастер баланса", d: "14 дней в норме калорий", ok: P => P.normDays >= 14 },
  { id: "perfect7", r: 3, ic: "♛", n: "Безупречный", d: "7 идеальных дней", ok: P => P.perfectDays >= 7 },
  { id: "perfect14", r: 3, ic: "🌙", n: "Дисциплина клинка", d: "14 идеальных дней", ok: P => P.perfectDays >= 14 },
  { id: "train50", r: 3, ic: "🛡", n: "Стальное тело", d: "50 тренировок Системы", ok: P => P.workoutDays >= 50 },
  { id: "eye50", r: 3, ic: "◎", n: "Всевидящее Око", d: "50 распознанных фото", ok: P => P.photos >= 50 },
  { id: "mapper10", r: 3, ic: "🗺", n: "Картограф", d: "Добавить 10 продуктов в общую базу", ok: P => P.mapped >= 10 },
  { id: "entries500", r: 3, ic: "📖", n: "Хранитель хроник", d: "500 записей", ok: P => P.entries >= 500 },
  { id: "rankC", r: 3, ic: "В", n: "Воин", d: "Получить ранг «Воин»", ok: P => rankIdx(P.rank) >= 2 },
  { id: "rankB", r: 3, ic: "М", n: "Мастер", d: "Получить ранг «Мастер»", ok: P => rankIdx(P.rank) >= 3 },
  { id: "streak30", r: 4, ic: "⛓", n: "Несломленный", d: "30 дней подряд с записями", ok: P => P.longest >= 30 },
  { id: "streak60", r: 4, ic: "🜂", n: "Воля из стали", d: "60 дней подряд с записями", ok: P => P.longest >= 60 },
  { id: "train100", r: 4, ic: "⚚", n: "Армия одного", d: "100 тренировок Системы", ok: P => P.workoutDays >= 100 },
  { id: "lvl50", r: 4, ic: "✷", n: "За пределом человека", d: "Достичь 50 уровня", ok: P => P.level >= 50 },
  { id: "rankA", r: 4, ic: "Ч", n: "Чемпион", d: "Получить ранг «Чемпион»", ok: P => rankIdx(P.rank) >= 4 },
  { id: "monarch", r: 5, ic: "♛", n: "Несгибаемый", d: "30 идеальных дней", ok: P => P.perfectDays >= 30 },
  { id: "streak100", r: 5, ic: "∞", n: "Бессмертный", d: "100 дней подряд с записями", ok: P => P.longest >= 100 },
  { id: "perfect100", r: 5, ic: "👑", n: "Абсолют", d: "100 идеальных дней", ok: P => P.perfectDays >= 100 },
  { id: "lvl100", r: 5, ic: "✹", n: "Тот, кто превзошёл Систему", d: "Достичь 100 уровня", ok: P => P.level >= 100 },
  { id: "rankS", r: 5, ic: "Т", n: "Титан", d: "Получить ранг «Титан»", ok: P => rankIdx(P.rank) >= 5 },
  { id: "rankN", r: 5, ic: "Л", n: "Легенда", d: "Пройти последний экзамен и стать Легендой", ok: P => rankIdx(P.rank) >= 6 },
];

/* ============================ окна «Системы» ============================ */
const sysQueue = [];
let sysOpen = false;
let introOn = false;
function system(o) { sysQueue.push(o); if (!sysOpen && !introOn) nextSystem(); }
function nextSystem() {
  const o = sysQueue.shift(); if (!o) { sysOpen = false; return; }
  sysOpen = true;
  if (S.sound !== false) try { sfx(o.kind || "info", o.rarity); } catch {}
  const rar = o.kind === "achv" && o.rarity ? RARITY[o.rarity] : null;
  const big = o.kind === "levelup" || o.kind === "rank" || (rar && o.rarity >= 3);
  const col = o.kind === "rank" ? "#ffc24a" : rar ? rar.c : o.kind === "penalty" ? "#ff4d6d" : "#7f9cff";
  const bg = document.createElement("div");
  bg.className = `sys-bg fx-${o.kind || "info"}${big ? " big" : ""}`;
  bg.style.setProperty("--fx", col);
  const n = big ? 26 : 14;
  const parts = big || o.kind === "all" ? Array.from({ length: n }, (_, i) =>
    `<i style="--a:${Math.round(i * 360 / n + Math.random() * 10)}deg;--d:${(90 + Math.random() * 120) | 0}px;--t:${(0.7 + Math.random() * 0.6).toFixed(2)}s"></i>`).join("") : "";
  bg.innerHTML = `${big ? '<div class="fx-rays"></div>' : ""}<div class="fx-flash"></div><div class="fx-parts">${parts}</div>
    <div class="sys ${o.kind || ""} ${rar ? "rar-" + rar.id : ""}">
    <div class="tag">${esc(o.tag || "СИСТЕМА")}${rar ? ` · ${rar.n.toUpperCase()}` : ""}</div>
    ${o.icon ? `<div class="sys-ic">${esc(o.icon)}</div>` : ""}
    <div class="head">${esc(o.head)}</div>${o.sub ? `<div class="sys-sub">${esc(o.sub)}</div>` : ""}
    ${o.body ? `<div class="body">${o.body.split("\n\n").map((p, i) => `<p style="animation-delay:${0.3 + i * 0.3}s">${esc(p)}</p>`).join("")}</div>` : ""}
    <button class="btn ${o.kind === "achv" ? "violet" : o.kind === "penalty" ? "danger" : ""}">${esc(o.btn || "Принять")}</button>
  </div>`;
  if (o.kind === "rank" || o.kind === "penalty") { document.body.classList.remove("shake"); void document.body.offsetWidth; document.body.classList.add("shake"); setTimeout(() => document.body.classList.remove("shake"), 700); }
  if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) try { navigator.vibrate(o.kind === "rank" ? [80, 60, 160] : big ? [40, 40, 90] : o.kind === "penalty" ? [200] : 25); } catch {}
  bg.querySelector("button").onclick = () => { bg.classList.add("out"); setTimeout(() => { bg.remove(); nextSystem(); }, 180); };
  document.body.appendChild(bg);
}

function checkEvents(P) {
  const seen = S.seen; const td = today(); let changed = false;
  const day = P.days[td];
  if (day) {
    const got = seen.quests[td] || [];
    for (const q of QUESTS) if (day.q[q.id].done && !got.includes(q.id)) {
      got.push(q.id); changed = true;
      system({ kind: "quest", tag: "КВЕСТ ВЫПОЛНЕН", head: q.name, body: `Награда: +${q.xp} XP\n\n${phrase("quest")}` });
    }
    if (day.all && !got.includes("all")) {
      got.push("all"); changed = true;
      postEvent("quests", "выполнил все ежедневные квесты");
      system({ kind: "all", tag: "ЕЖЕДНЕВНЫЙ КВЕСТ", head: "Все задания выполнены", body: `Бонус: +${XP.allBonus} XP\n\n${phrase("allQuests")}` });
    }
    seen.quests[td] = got;
    // чистим старые отметки
    for (const k of Object.keys(seen.quests)) if (k < addDays(td, -14)) delete seen.quests[k];
  }
  for (let i = 1; i <= 3; i++) {
    const d = addDays(td, -i), dd = P.days[d];
    if (dd && dd.shielded && !seen.penalties.includes(d)) {
      seen.penalties.push(d); changed = true;
      system({ kind: "info", tag: "ЩИТ СРАБОТАЛ", head: "🛡 Серия спасена", body: `${humanDate(d)} ты пропустил, но щит удержал серию: ${P.streak} дн.\nОсталось щитов: ${P.shields}.\n\nЩиты копятся за каждые 7 дней подряд. Не пропускай два дня — щит может закончиться.`, btn: "Продолжить" });
    }
  }
  seen.penalties = seen.penalties.filter(d => d >= addDays(td, -10));
  if (P.level > seen.level) {
    const oldRank = seen.rank || "E";
    system({ kind: "levelup", tag: "УРОВЕНЬ ПОВЫШЕН", head: `${P.level}`, sub: `LV ${seen.level} → LV ${P.level}`,
      body: phrase("levelup") + "\n\nНовые требования Системы. Новая сила." });
    postEvent("level", P.rank !== oldRank ? `достиг ${P.level} уровня и ранга «${rankName(P.rank)}»` : `достиг ${P.level} уровня`);
    seen.level = P.level; seen.rank = P.rank; changed = true;
  } else if (P.level < seen.level) { seen.level = P.level; changed = true; }
  if (P.rank !== (seen.rank || "E")) { seen.rank = P.rank; changed = true; }
  for (const a of ACH) if (a.ok(P) && !seen.ach.includes(a.id)) {
    seen.ach.push(a.id); changed = true;
    system({ kind: "achv", rarity: a.r, icon: a.ic, tag: "НОВЫЙ ТИТУЛ", head: a.n, body: `${a.d}\n\n${phrase("achv")}`, btn: "Принять титул" });
    postEvent("ach", `получил титул «${a.n}»`);
  }
  if (changed) save();
}

function greet(P) {
  const td = today();
  if (S.seen.greet === td || !S.profile || S.profile.createdAt === td) { if (!S.seen.greet) { S.seen.greet = td; save(); } return; }
  const y = P.days[addDays(td, -1)], missed = y && y.s.count === 0 && !y.q.workout.done;
  S.seen.greet = td; save();
  const sk = skillTodayState();
  system({ kind: missed ? "info" : "quest", tag: "СИСТЕМА", head: missed ? "Ты вернулся" : "Новый день",
    body: `${missed ? phrase("comeback") : phrase("morning")}\n\n[ЕЖЕДНЕВНЫЙ КВЕСТ]\n${QUESTS.map(q => "◇ " + q.name).join("\n")}${sk === "todo" ? "\n◇ Задание навыка" : ""}${S.exam && S.exam.status === "active" ? "\n\n⚔ Идёт экзамен на ранг «" + rankName(S.exam.to) + "». Ни одной ошибки." : ""}`, btn: "Принять" });
}

function syncSeenSilently() {
  const P = computeProgress();
  S.seen.level = P.level;
  S.seen.ach = ACH.filter(a => a.ok(P)).map(a => a.id);
  S.seen.penalties = Object.keys(P.days).filter(d => P.days[d].shielded);
  save();
}

/* ============================ toast ============================ */
let toastT;
function toast(msg, err) {
  document.querySelectorAll(".toast").forEach(t => t.remove());
  const t = document.createElement("div"); t.className = "toast" + (err ? " err" : ""); t.textContent = msg;
  document.body.appendChild(t); clearTimeout(toastT); toastT = setTimeout(() => t.remove(), 2600);
}

/* ============================ навигация ============================ */
let tab = "status";
let diaryDate = today();
const svgI = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const ICONS = {
  status: svgI('<path d="M12 2.8 19.6 7.2v9.6L12 21.2 4.4 16.8V7.2Z"/><path d="M12 8.2 15.3 12 12 15.8 8.7 12Z"/>'),
  diary: svgI('<rect x="5" y="3.5" width="14" height="17" rx="3.2"/><path d="M8.8 8.5h6.4M8.8 12h6.4M8.8 15.5h3.8"/>'),
  skills: svgI('<path d="M12 3.2c.6 4.4 2.4 6.2 6.8 6.8-4.4.6-6.2 2.4-6.8 6.8-.6-4.4-2.4-6.2-6.8-6.8 4.4-.6 6.2-2.4 6.8-6.8Z"/><path d="M18.4 15.6c.25 1.6.9 2.25 2.5 2.5-1.6.25-2.25.9-2.5 2.5-.25-1.6-.9-2.25-2.5-2.5 1.6-.25 2.25-.9 2.5-2.5Z"/>'),
  rating: svgI('<path d="M4 20.2V13.6h4.6v6.6M8.6 20.2V8.4h6.8v11.8M15.4 20.2v-9h4.6v9M3 20.2h18"/>'),
  player: svgI('<circle cx="12" cy="8.2" r="3.8"/><path d="M4.6 20.4c.9-3.9 3.8-6 7.4-6s6.5 2.1 7.4 6"/>'),
  hunter: svgI('<path d="M12 2.8 21.2 12 12 21.2 2.8 12Z"/><path d="M12 9 15 12 12 15 9 12Z"/>'),
  settings: svgI('<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>'),
  plus: svgI('<path d="M12 5v14M5 12h14"/>'),
  camera: svgI('<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.6l1.4-2h5l1.4 2h1.6A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5Z"/><circle cx="12" cy="12.4" r="3.4"/>'),
  pencil: svgI('<path d="M4.5 19.5 5.4 15.6 15.6 5.4a2 2 0 0 1 2.9 0l.1.1a2 2 0 0 1 0 2.9L8.4 18.6Z"/><path d="M13.8 7.2l3 3"/>'),
  barcode: svgI('<path d="M4 7V5.5A1.5 1.5 0 0 1 5.5 4H7M17 4h1.5A1.5 1.5 0 0 1 20 5.5V7M20 17v1.5a1.5 1.5 0 0 1-1.5 1.5H17M7 20H5.5A1.5 1.5 0 0 1 4 18.5V17"/><path d="M8 8v8M11 8v8M13.5 8v8M16 8v8"/>'),
  swords: svgI('<path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2"/><path d="M9.5 6.5 13 3h3v3l-3.5 3.5M5 14l-1 1 4 4 1-1"/>'),
  flame: svgI('<path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.4 2.4-5.4 3.6-8.3.5 2 1.6 3 2.8 3.4C12 6.8 13.3 4.4 15.6 3c-.5 3.2 2.9 5.7 2.9 10.4 0 4.6-2.7 7.6-6.5 7.6Z"/>'),
};
function renderTabbar() {
  let bar = document.querySelector(".tabbar");
  if (!S.profile) { bar && bar.remove(); return; }
  if (!bar) { bar = document.createElement("nav"); bar.className = "tabbar"; document.body.appendChild(bar); }
  const b = (id, label) => `<button class="tab ${tab === id ? "on" : ""}" data-tab="${id}">${ICONS[id]}<span>${label}</span></button>`;
  bar.innerHTML = `<div class="in">${b("status", "Статус")}${b("diary", "Дневник")}${b("skills", "Навыки")}${b("rating", "Рейтинг")}${b("player", "Игрок")}</div>
    <button class="tab-add fab" data-act="add" aria-label="Добавить еду">${ICONS.plus}</button>`;
  bar.querySelectorAll("[data-tab]").forEach(x => x.onclick = () => { if (tab !== x.dataset.tab && S.sound !== false) sfx("tab"); tab = x.dataset.tab; render(); window.scrollTo(0, 0); $app.classList.remove("enter"); void $app.offsetWidth; $app.classList.add("enter"); });
  bar.querySelector("[data-act=add]").onclick = () => openAddSheet();
}

const BG = { status: "status", diary: "nebula", skills: "skill", rating: "rating", player: "profile", hunter: "profile", settings: "profile" };
function setBg(name) {
  const el = document.getElementById("bgart"); if (!el) return;
  const url = `url("art/${name}.jpg")`;
  if (el.dataset.bg !== name) { el.dataset.bg = name; el.style.backgroundImage = url; }
}
function render() {
  if (!S.profile) { setBg("awaken"); renderOnboarding(); renderTabbar(); return; }
  setBg(BG[tab] || "nebula");
  const P = computeProgress();
  if (tab === "status") renderStatus(P);
  else if (tab === "diary") renderDiary(P);
  else if (tab === "player" || tab === "hunter" || tab === "settings") renderPlayer(P);
  else if (tab === "rating") renderRating(P);
  else if (tab === "skills") renderSkills($app);
  else renderSettings();
  renderTabbar();
  checkEvents(P);
  if (V2) settleGates(P).then(() => { /* изменения подхватит следующий render */ });
  settleExam(P);
  greet(P);
}

/* ============================ общие куски ============================ */
const fmtN = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, "\u2009");
/** Верх «Статуса»: слово Системы, сцена с охотником (фон), имя, уровень, ранг, титул, опыт. */
function statusTop(P) {
  const t = titleById(S.title), td = today(), shame = shameTitle();
  const rar = t && t.r ? RARITY[t.r] : null;
  return `<div class="st-top">
    <div class="daily-word"><span class="tag-sys">Слово Системы</span><div>«${esc(dailyPhrase(td))}»</div></div>
    <div class="st-hero" data-hunter></div>
    <div class="st-name" data-hunter><span class="n">${esc(S.profile.name)}</span><span class="lv"><small>LV</small>${P.level}</span></div>
    <div class="st-chips" data-hunter><span class="chip-g rkc rank-${P.rank}">${rankGlyph(P.rank, 18)}${esc(rankLabel(P.rank, P.level))}</span>
      ${shame ? `<span class="chip-g" style="color:#ff9aaa"><span class="dm" style="background:#ff4d6d"></span>«${esc(shame)}»</span>` :
        t ? `<span class="chip-g ${rar && rar.id === "legend" ? "gold" : ""}"><span class="dm" ${rar ? `style="background:${rar.c}"` : ""}></span>«${esc(t.n)}»</span>` : ""}</div>
    <div class="st-xp"><div class="bar"><i style="width:${(P.into / P.need * 100).toFixed(1)}%"></i></div><span><b>${fmtN(P.into)}</b> / ${fmtN(P.need)} XP</span></div>
  </div>`;
}
const RANK_ORDER_ALL = ["E", "D", "C", "B", "A", "S", "N"];
/** Эмблема ранга: пламя ранга в шестиграннике, кольцо из 7 рангов и прогресс до следующего экзамена. */
function rankEmblem(P) {
  const i = RANK_ORDER_ALL.indexOf(P.rank), R = 70, cx = 84, cy = 84, RK = RANKS[P.rank];
  const nextLv = RANK_LV[i + 1] || 999, prevLv = RANK_LV[i] || 0;
  const frac = Math.max(0, Math.min(1, (P.level - prevLv) / Math.max(1, nextLv - prevLv)));
  const a0 = -Math.PI / 2 + i / 7 * Math.PI * 2, a1 = a0 + frac / 7 * Math.PI * 2;
  const pt = k => { const a = -Math.PI / 2 + k / 7 * Math.PI * 2; return [cx + R * Math.cos(a), cy + R * Math.sin(a)]; };
  const arc = `M${cx + R * Math.cos(a0)} ${cy + R * Math.sin(a0)} A${R} ${R} 0 0 1 ${cx + R * Math.cos(a1)} ${cy + R * Math.sin(a1)}`;
  const hex = [0, 1, 2, 3, 4, 5].map(k => { const a = -Math.PI / 2 + k * Math.PI / 3; return `${cx + 40 * Math.cos(a)},${cy + 40 * Math.sin(a)}`; }).join(" ");
  const tier = rankLabel(P.rank, P.level).split(" ")[1] || "";
  const nx = RANK_ORDER_ALL[i + 1];
  return `<svg class="emblem" viewBox="0 0 168 168"><defs>
      <linearGradient id="emg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${RK.c1}" stop-opacity=".38"/><stop offset="1" stop-color="${RK.c2}" stop-opacity=".42"/></linearGradient>
      <linearGradient id="emf" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${RK.c2}"/><stop offset="1" stop-color="${RK.c1}"/></linearGradient></defs>
    <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="rgba(255,255,255,.10)" stroke-width="1.5"/>
    <path d="${arc}" fill="none" stroke="${RK.c1}" stroke-width="2.5" stroke-linecap="round" style="filter:drop-shadow(0 0 5px ${RK.c2})"/>
    ${RANK_ORDER_ALL.map((r, k) => { const [x, y] = pt(k), c = RANKS[r]; return `<circle cx="${x}" cy="${y}" r="${k === i ? 7 : 5}" fill="${k <= i ? c.c1 : "rgba(10,12,30,.9)"}" stroke="${k <= i ? c.c2 : "rgba(255,255,255,.22)"}" stroke-width="1.5" ${k === i ? `style="filter:drop-shadow(0 0 6px ${c.c1})"` : ""}/>`; }).join("")}
    <polygon points="${hex}" fill="url(#emg)" stroke="${RK.c1}" stroke-opacity=".7" stroke-width="1.2" style="filter:drop-shadow(0 0 14px ${RK.c2})"/>
    <g transform="translate(${cx - 19} ${cy - 27}) scale(1.6)"><path fill="url(#emf)" d="M12 2c1 3.2 4.6 5.4 4.6 10.2A4.6 4.6 0 0 1 12 17a4.6 4.6 0 0 1-4.6-4.8c0-2 1-3.4 2.2-4.6.2 1.6 1 2.6 2 3C11 8.2 11.2 4.8 12 2Z"/><path fill="${RK.c1}" opacity=".6" d="M12 22c-4.4 0-7-2.6-7-5.6 0-.9.2-1.7.6-2.5.6 2.9 3.3 4.9 6.4 4.9s5.8-2 6.4-4.9c.4.8.6 1.6.6 2.5C19 19.4 16.4 22 12 22Z"/></g>
    ${tier ? `<text x="${cx}" y="${cy + 33}" text-anchor="middle" font-size="11" font-weight="700" letter-spacing="2" fill="#fff" opacity=".85">${tier}</text>` : ""}</svg>
    <div class="emb-rank" style="color:${RK.c1}">${esc(rankLabel(P.rank, P.level)).toUpperCase()}</div>
    <div class="emb-n">${i >= 6 ? "вершина пути" : frac >= 1 ? `доступен экзамен на «${rankName(nx)}»` : `${Math.round(frac * 100)}% до ранга «${rankName(nx)}»`}</div>`;
}
function hunterCard(P, full) {
  const t = titleById(S.title);
  return `<div class="win" ${full ? "" : 'data-hunter style="cursor:pointer"'}>${full ? "" : '<span class="hunter-more">профиль ›</span>'}
    <div class="hunter">
      ${full ? `<div class="emb-w">${rankEmblem(P)}</div>` : `<div class="rank-badge rank-${P.rank}">${rankGlyph(P.rank, 40)}</div>`}
      <div class="grow">
        <div class="name">${esc(S.profile.name)}</div>
        <div class="title">${shameTitle() ? '<span class="bad">«Беглец»</span>' : t ? "«" + esc(t.n) + "»" : esc(rankLabel(P.rank, P.level))}</div>
        <div class="row mt" style="margin-top:8px"><span class="lvl">LV. ${P.level}</span>
          <span class="tiny muted" style="margin-left:auto">${P.into} / ${P.need} XP</span></div>
        <div class="bar" style="margin-top:5px"><i style="width:${(P.into / P.need * 100).toFixed(1)}%"></i></div>
      </div>
    </div>
    ${full ? `<div class="grid3 mt center small">
      <div><div class="sys-font" style="font-size:18px;color:#fff">${P.streak} <span style="font-size:13px;opacity:.8">🛡${P.shields}</span></div><div class="muted tiny">серия · щиты</div></div>
      <div><div class="sys-font" style="font-size:18px;color:#fff">${P.perfectDays}</div><div class="muted tiny">идеальных дней</div></div>
      <div><div class="sys-font" style="font-size:18px;color:#fff">${P.xp}</div><div class="muted tiny">всего XP</div></div>
    </div>` : ""}
  </div>`;
}

function ring(eaten, goal) {
  const R = 64, C = 2 * Math.PI * R, frac = clamp(eaten / (goal || 1), 0, 1);
  const over = eaten > goal * 1.05;
  return `<div class="ring ${over ? "over" : ""}">
    <svg viewBox="0 0 150 150"><defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#b9cdff"/><stop offset=".5" stop-color="#5b7cff"/><stop offset="1" stop-color="#9a6bff"/></linearGradient></defs>
      <circle class="c-bg" cx="75" cy="75" r="${R}"/>
      <circle class="c-fg" cx="75" cy="75" r="${R}" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - frac)}"/></svg>
    <div class="mid"><div class="big">${over ? "+" + r0(eaten - goal) : r0(Math.max(0, goal - eaten))}</div>
      <div class="lbl">${over ? "сверх нормы" : "осталось"}</div></div>
  </div>`;
}
function macroBar(name, val, goal) {
  const pct = goal ? val / goal * 100 : 0;
  return `<div class="macro"><div class="t"><span>${name}</span><b>${r0(val)}<span class="dim">/${r0(goal)}</span></b></div>
    <div class="bar ${pct > 115 ? "over" : ""}"><i style="width:${clamp(pct, 0, 100)}%"></i></div></div>`;
}
function bindQuests(P) {
  $app.querySelectorAll("[data-workout]").forEach(x => x.onclick = () => openWorkout(x.dataset.workout, P.days[x.dataset.workout].lvl));
}
function questsWin(P, date) {
  const d = P.days[date]; if (!d) return "";
  const rows = QUESTS.map(q => {
    const st = d.q[q.id];
    const cls = st.done ? "done" : (q.id === "norm" && st.over) ? "fail" : "";
    return `<div class="quest ${cls}" ${q.id === "workout" ? `data-workout="${date}" style="cursor:pointer"` : ""}><div class="box">${st.done ? "✓" : cls === "fail" ? "✕" : ""}</div>
      <div class="grow"><div class="qt">${q.name}${q.id === "workout" ? ` <span class="tiny" style="color:var(--blue2)">открыть ›</span>` : ""}</div><div class="qp">${st.prog}${q.id === "norm" && st.over ? " · превышено" : ""}</div></div>
      <div class="xp">${q.id === "workout" ? (st.done && !st.verified ? "+40" : "+80") : "+" + q.xp}</div></div>`;
  }).join("");
  return `<div class="win"><div class="win-h">Ежедневный квест<span class="right">бонус за все: +${XP.allBonus} XP</span></div>
    <div class="tiny muted mb">[Подготовка к укреплению тела]</div>${rows}</div>`;
}

/* ============================ экран: Статус ============================ */
function renderStatus(P) {
  const t = targets(), td = today(), d = P.days[td], s = d.s;
  const y = P.days[addDays(td, -1)];
  $app.innerHTML = `
    ${statusTop(P)}
    ${(() => { const due = worldDue(); return due.length ? `<div class="win" style="border-color:rgba(255,194,74,.6)" data-wdue="${due[0].chain}"><div class="win-h" style="color:#ffd77a">🌍 Выход в мир<span class="right">›</span></div>
      <div class="small">Сегодня написать: ${due.slice(0, 3).map(x => esc(x.c.name)).join(", ")}${due.length > 3 ? ` и ещё ${due.length - 3}` : ""}</div></div>` : ""; })()}
    ${statusCard()}
    <div class="win" data-godiary style="cursor:pointer">
      <div class="win-h">Питание · сегодня<span class="right">XP за день: <b class="${d.xp < 0 ? "bad" : ""}">${d.xp >= 0 ? "+" : ""}${d.xp}</b></span></div>
      <div class="nut"><div><div class="big">${fmtN(r0(s.kcal))}<small>из ${fmtN(t.kcal)} ккал</small></div>
        <div class="mac">${[["Б", s.p, t.p], ["Ж", s.f, t.f], ["У", s.c, t.c]].map(([n, v, g]) => `<div>${n} <b>${r0(v)}</b> г<i style="--w:${clamp(v / (g || 1) * 100, 0, 100)}%"></i></div>`).join("")}</div></div>
        ${ring(s.kcal, t.kcal)}</div>
    </div>
    ${questsWin(P, td)}
    ${examWin(P)}
    ${V2 && API_URL && S.player ? gatesWin(P) : ""}
    <div class="qbtns">
      <button class="btn block" data-act="photo">${ICONS.camera.replace("<svg", '<svg width="20" height="20" style="vertical-align:-4px;margin-right:6px"')}Фото еды</button>
      <button class="btn block" data-act="manual">${ICONS.pencil.replace("<svg", '<svg width="20" height="20" style="vertical-align:-4px;margin-right:6px"')}По названию</button>
    </div>
    <button class="btn block violet" data-act="workout">${ICONS.swords.replace("<svg", '<svg width="20" height="20" style="vertical-align:-4px;margin-right:6px"')}Тренировка Системы</button>
    ${planWin(t)}
    ${y && y.s.count ? `<div class="win violet mt"><div class="win-h">Отчёт за вчера</div>
      <div class="small">${r0(y.s.kcal)} ккал · Б ${r0(y.s.p)} · Ж ${r0(y.s.f)} · У ${r0(y.s.c)}</div>
      <div class="small ${y.xp < 0 ? "bad" : "muted"}">${y.all ? "Все квесты выполнены. " : ""}${y.penalty ? y.penalty.why + ". " : ""}Итог: ${y.xp >= 0 ? "+" : ""}${y.xp} XP</div></div>` : ""}
  `;
  $app.querySelector("[data-act=photo]").onclick = () => startPhoto(today());
  $app.querySelector("[data-act=manual]").onclick = () => openManual({ date: today() });
  $app.querySelector("[data-act=workout]").onclick = () => openWorkout(td, d.lvl);
  $app.querySelectorAll("[data-skgo]").forEach(b => b.onclick = () => { tab = "skills"; render(); window.scrollTo(0, 0); });
  $app.querySelectorAll("[data-wdue]").forEach(b => b.onclick = () => { tab = "skills"; openWorldView(b.dataset.wdue); });
  $app.querySelectorAll("[data-hunter]").forEach(b => b.onclick = () => { tab = "player"; ptab = "profile"; render(); window.scrollTo(0, 0); });
  const gd = $app.querySelector("[data-godiary]"); if (gd) gd.onclick = () => { tab = "diary"; diaryDate = today(); render(); window.scrollTo(0, 0); };
  bindQuests(P);
  if (V2 && API_URL && S.player) bindGates($app, P);
  bindExam($app, P);
}
function planWin(t) {
  return `<div class="win violet mt"><div class="win-h">План Системы<span class="right">${t.target} кг</span></div>
    <div class="small" style="white-space:pre-line">${esc(planText(t))}</div>
    <div class="grid2 mt small">
      <div class="kv"><span class="muted">Калории</span><b>${t.kcal}</b></div>
      <div class="kv"><span class="muted">Белок</span><b>${t.p} г</b></div>
      <div class="kv"><span class="muted">Шаги</span><b>${t.steps.toLocaleString("ru")}</b></div>
      <div class="kv"><span class="muted">Вода</span><b>${t.water} л</b></div>
    </div>
    <div class="tiny muted mt">${t.goal === "lose" ? "Дефицит без голодовки: белок держит мышцы, шаги сжигают жир. Взвешивайся раз в неделю утром." : t.goal === "gain" ? "Небольшой профицит + тренировки = мышцы, а не жир." : "Держи норму и выполняй квесты — форма сохранится."}</div>
  </div>`;
}

/* ============================ экран: Дневник ============================ */
function renderDiary(P) {
  const t = targets(), d = diaryDate, td = today();
  const list = S.entries.filter(e => e.date === d).sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  const s = daySums(d);
  // неделя (пн–вс) вокруг выбранного дня
  const wd = (parseD(d).getDay() + 6) % 7, mon = addDays(d, -wd);
  const WDN = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  const week = WDN.map((n, i) => { const dd = addDays(mon, i), has = S.entries.some(e => e.date === dd);
    return `<button class="wk-d ${dd === d ? "on" : ""} ${dd > td ? "fut" : ""}" data-day="${dd}"><span>${n}</span><b>${parseD(dd).getDate()}</b><i class="${has ? "has" : ""}"></i></button>`; }).join("");
  const meals = MEALS.map(m => {
    const items = list.filter(e => e.meal === m.id);
    const k = items.reduce((a, e) => a + e.kcal, 0), tm = items.length ? items[0].time : "";
    return `<div class="meal"><div class="meal-h"><span class="n">${m.name}${tm ? ` <span class="tm">${tm}</span>` : ""}</span>
        ${items.length ? `<span class="k">${r0(k)} ккал</span>` : `<button class="chip-b sm-add" data-addmeal="${m.id}">+ Добавить</button>`}</div>
      ${items.map(entryRow).join("")}
    </div>`;
  }).join("");
  const left = t.kcal - s.kcal, mb = (n, v, g) => `<div><div class="tiny muted">${n} <b>${r0(v)}</b> / ${r0(g)} г</div><div class="bar"><i style="width:${clamp(v / (g || 1) * 100, 0, 100)}%"></i></div></div>`;
  $app.innerHTML = `
    <div class="dhead"><button class="icon-btn" data-dd="-1">${svgI('<path d="M14.6 5.4 8 12l6.6 6.6"/>')}</button>
      <div class="grow center"><div class="tag-sys">${d === td ? "СЕГОДНЯ" : d === addDays(td, -1) ? "ВЧЕРА" : "ДНЕВНИК"}</div><div class="dt">${dayTitle(d)}</div></div>
      <button class="icon-btn" data-dd="1" ${d >= td ? "disabled style='opacity:.3'" : ""}>${svgI('<path d="M9.4 5.4 16 12l-6.6 6.6"/>')}</button></div>
    <div class="win wk">${week}</div>
    <div class="win">
      <div class="row" style="align-items:flex-end"><div class="grow"><span class="sys-font" style="font-size:40px;color:#fff">${fmtN(r0(s.kcal))}</span> <span class="muted small">/ ${fmtN(t.kcal)} ккал</span></div>
        <div class="center"><div class="sys-font" style="font-size:26px;color:${left < 0 ? "var(--bad)" : "#fff"}">${fmtN(Math.abs(r0(left)))}</div><div class="tiny muted">${left < 0 ? "сверх" : "осталось"}</div></div></div>
      <div class="grid3 mt" style="gap:12px">${mb("Б", s.p, t.p)}${mb("Ж", s.f, t.f)}${mb("У", s.c, t.c)}</div>
    </div>
    ${d !== td && P.days[d] ? questsWin(P, d) : ""}
    <div class="win meals">${meals}</div>`;
  $app.querySelectorAll("[data-dd]").forEach(b => b.onclick = () => {
    const nd = addDays(diaryDate, +b.dataset.dd); if (nd > td) return; diaryDate = nd; render();
  });
  $app.querySelectorAll("[data-day]").forEach(b => b.onclick = () => { if (b.dataset.day > td) return; diaryDate = b.dataset.day; render(); });
  $app.querySelectorAll("[data-addmeal]").forEach(b => b.onclick = () => openAddSheet(diaryDate, b.dataset.addmeal));
  $app.querySelectorAll("[data-entry]").forEach(b => b.onclick = () => openEdit(b.dataset.entry));
  bindQuests(P);
}
const dayTitle = d => { const x = parseD(d), w = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"][x.getDay()];
  return `${w}, ${x.getDate()} ${["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"][x.getMonth()]}`; };
function entryRow(e) {
  return `<div class="entry" data-entry="${e.id}">
    <div class="th" ${e.thumb ? `style="background-image:url(${e.thumb})"` : ""}>${e.thumb ? "" : e.source === "barcode" ? ICONS.barcode : ICONS.pencil}</div>
    <div class="grow"><div class="nm">${esc(e.name)} ${e.source === "photo" ? '<span class="src">ИИ</span>' : e.source === "barcode" ? '<span class="src">▦</span>' : ""}</div>
      <div class="mc">${e.grams ? r0(e.grams) + " г · " : ""}Б ${r1(e.p)} · Ж ${r1(e.f)} · У ${r1(e.c)}</div></div>
    <div class="kc">${r0(e.kcal)}</div></div>`;
}

/* ============================ экран: Охотник ============================ */
function renderHunter(P) {
  const t = targets();
  const STATS = [
    ["str", "Сила", "тренировку Системы"],
    ["hp", "Живучесть", "день с нормой белка"],
    ["vit", "Выносливость", "лучшую серию дней"],
    ["dis", "Дисциплина", "день в норме калорий"],
    ["per", "Восприятие", "каждые 3 фото-анализа"],
  ];
  const days = []; for (let i = 13; i >= 0; i--) days.push(addDays(today(), -i));
  const max = Math.max(t.kcal * 1.3, ...days.map(d => daySums(d).kcal));
  const bars = days.map(d => {
    const k = daySums(d).kcal, h = k / max * 100;
    const cls = k === 0 ? "none" : k > normRange(t)[1] ? "over" : "";
    return `<div class="b ${cls}"><i style="height:${k ? Math.max(h, 2) : 2}%"></i></div>`;
  }).join("");
  const labels = days.map(d => `<span>${parseD(d).getDate()}</span>`).join("");
  const goalPos = (t.kcal / max * 100);
  const got = new Set(S.seen.ach.concat(ACH.filter(a => a.ok(P)).map(a => a.id)));
  $app.innerHTML = `
    ${hunterCard(P, true)}
    ${finishedSkills().length ? `<div class="win violet"><div class="win-h">Навыки</div>${finishedSkills().map(sk => `<div class="kv"><span>${esc(sk.plan.skill_name)} · Ур. ${sk.level}</span><b>${masteryRank(sk.mastery)} · ${sk.mastery}%</b></div>`).join("")}</div>` : ""}
    ${weightWin(t)}
    <div class="win"><div class="win-h">Характеристики</div>
      <div class="stat-rows">${(() => { const mx = Math.max(20, ...STATS.map(([k]) => P.stats[k])); return STATS.map(([k, n, d]) => `<div class="srow"><div class="grow"><div class="sn">${n}</div><div class="sd">+1 за ${d}</div></div>
        <div class="sb"><i style="width:${(P.stats[k] / mx * 100).toFixed(0)}%"></i></div><div class="sv">${P.stats[k]}</div></div>`).join(""); })()}</div>
    </div>
    <div class="win"><div class="win-h">Последние 14 дней<span class="right">ккал</span></div>
      <div class="chart"><div class="plot"><div class="goal" style="bottom:${goalPos}%"><span>${t.kcal}</span></div>${bars}</div><div class="labels">${labels}</div></div>
    </div>
    ${(S.extraTitles || []).length ? `<div class="win violet"><div class="win-h">Особые титулы<span class="right">${S.extraTitles.length}</span></div>
      ${S.extraTitles.map(a => `<div class="ach got"><div class="ic">${esc(a.ic)}</div>
        <div class="grow"><div class="an">${esc(a.n)}</div><div class="ad">${esc(a.d)}</div></div>
        <button class="btn sm ${S.title === a.id ? "violet" : "ghost"} sel" data-title="${a.id}">${S.title === a.id ? "Титул" : "Надеть"}</button></div>`).join("")}</div>` : ""}
    <div class="win violet"><div class="win-h">Достижения и титулы<span class="right">${[...got].length}/${ACH.length}</span></div>
      ${ACH.map(a => `<div class="ach ${got.has(a.id) ? "got" : ""} rar-${RARITY[a.r].id}" style="--rc:${RARITY[a.r].c}">
        <div class="ic">${a.ic}</div>
        <div class="grow"><div class="an">${esc(a.n)}</div><div class="ad"><span class="rar-l">${RARITY[a.r].n}</span> · ${esc(a.d)}</div></div>
        ${got.has(a.id) ? `<button class="btn sm ${S.title === a.id ? "violet" : "ghost"} sel" data-title="${a.id}">${S.title === a.id ? "Титул" : "Надеть"}</button>` : ""}
      </div>`).join("")}
    </div>`;
  $app.querySelectorAll("[data-title]").forEach(b => b.onclick = () => {
    S.title = S.title === b.dataset.title ? null : b.dataset.title; save(); render();
  });
  document.getElementById("w-add").onclick = () => {
    const kg = r1(num(document.getElementById("w-in").value));
    if (kg < 30 || kg > 300) return toast("Введи вес в кг", true);
    addWeight(kg, true); render();
  };
}

function weightWin(t) {
  const W = S.weights;
  const cur = W.length ? W[W.length - 1].kg : S.profile.weight, start = W.length ? W[0].kg : cur;
  const chg = r1(cur - start), left = r1(Math.abs(cur - t.target));
  return `<div class="win"><div class="win-h">Вес<span class="right">цель ${t.target} кг</span></div>
    <div class="grid3 center small mb">
      <div><div class="sys-font" style="font-size:18px;color:#fff">${cur}</div><div class="muted tiny">сейчас, кг</div></div>
      <div><div class="sys-font" style="font-size:18px;color:${(t.goal === "gain" ? chg >= 0 : chg <= 0) ? "var(--ok)" : "var(--warn)"}">${chg > 0 ? "+" : ""}${chg}</div><div class="muted tiny">с начала</div></div>
      <div><div class="sys-font" style="font-size:18px;color:#fff">${left}</div><div class="muted tiny">до цели, кг</div></div>
    </div>
    ${weightChart(t)}
    <div class="row mt"><input class="in grow" id="w-in" inputmode="decimal" placeholder="Вес сегодня, кг">
      <button class="btn" id="w-add">Записать</button></div>
    <div class="tiny dim mt">Взвешивайся утром натощак, раз в 3–7 дней. Норма пересчитывается по новому весу.</div>
  </div>`;
}
function weightChart(t) {
  const W = S.weights; if (!W.length) return "";
  const day = d => Math.round(parseD(d).getTime() / 864e5);
  const d0 = day(W[0].date), start = W[0].kg;
  const planDays = t.goal === "keep" || !t.rate ? 0 : Math.ceil(Math.abs(start - t.target) / t.rate * 7);
  const dEnd = Math.max(day(today()) + 7, d0 + planDays, day(W[W.length - 1].date) + 7);
  const ks = W.map(w => w.kg).concat([t.target, start]);
  const lo = Math.min(...ks) - 2, hi = Math.max(...ks) + 2;
  const X = d => 8 + (d - d0) / Math.max(1, dEnd - d0) * 284, Y = kg => 8 + (hi - kg) / (hi - lo) * 124;
  const pts = W.map(w => `${X(day(w.date)).toFixed(1)},${Y(w.kg).toFixed(1)}`).join(" ");
  const endLbl = planDays ? (() => { const d = new Date((d0 + planDays) * 864e5); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)}`; })() : "";
  return `<svg class="wchart" viewBox="0 0 300 140" preserveAspectRatio="none">
    <line x1="8" x2="292" y1="${Y(t.target)}" y2="${Y(t.target)}" class="w-goal"/>
    <text x="290" y="${Y(t.target) - 4}" text-anchor="end" class="w-lbl v">цель ${t.target}</text>
    ${planDays ? `<line x1="${X(d0)}" y1="${Y(start)}" x2="${X(d0 + planDays)}" y2="${Y(t.target)}" class="w-plan"/>
      <text x="${X(d0 + planDays)}" y="${Y(t.target) + 12}" text-anchor="end" class="w-lbl">план: ${endLbl}</text>` : ""}
    <polyline points="${pts}" class="w-line"/>
    ${W.map(w => `<circle cx="${X(day(w.date))}" cy="${Y(w.kg)}" r="2.6" class="w-dot"/>`).join("")}
  </svg>`;
}

/* ============================ экран: Игрок ============================ */
let ptab = "profile";
function playerHead() {
  return `<div class="screen-title"><h1>Игрок</h1><span class="sub">${esc(S.profile.name)}</span></div>
    <div class="seg mb rtabs"><button data-pt="profile" class="${ptab === "profile" ? "on" : ""}">Профиль</button><button data-pt="settings" class="${ptab === "settings" ? "on" : ""}">Настройки</button><button data-pt="about" class="${ptab === "about" ? "on" : ""}">О Системе</button></div>`;
}
function renderPlayer(P) {
  if (tab === "settings") ptab = "settings";
  tab = "player";
  if (ptab === "settings") renderSettings();
  else if (ptab === "about") renderAbout(P);
  else renderHunter(P);
  $app.insertAdjacentHTML("afterbegin", playerHead());
  $app.querySelectorAll("[data-pt]").forEach(b => b.onclick = () => { ptab = b.dataset.pt; render(); window.scrollTo(0, 0); });
}
function renderAbout(P) {
  const sec = (title, body) => `<details class="rule"><summary>${title}</summary><div class="small">${body}</div></details>`;
  $app.innerHTML = `
    <div class="win violet about">
      <div class="win-h">Об авторе</div>
      <div class="about-gate">${'<div class="g-glow"></div><div class="g-core"></div>'}</div>
      <p>Привет. Я — <b>Сурен</b>, и Ingot я сделал для себя и своих друзей.</p>
      <p>Я хочу расти: быть сильнее, здоровее, умнее, зарабатывать больше. Но честно — мне не хватало мотивации и дисциплины. Начинаешь с огнём, а через неделю всё сходит на нет. Знакомо?</p>
      <p>Поэтому я построил Систему. Как в Solo Leveling: каждый день — квест, за каждый шаг — опыт, за слабость — штраф, а ранг нужно заслужить. Рядом — друзья, которые видят твой прогресс и не дают остановиться.</p>
      <p>Ingot не сделает работу за тебя. Он просто не даст забыть, кем ты решил стать.</p>
      <p class="about-sign">— Сурен, создатель Ingot</p>
    </div>
    <div class="win"><div class="win-h">Факты</div>
      <div class="kv"><span class="muted">Создано</span><b>в 2026 году, в Ташкенте</b></div>
      <div class="kv"><span class="muted">Для кого</span><b>для себя и друзей</b></div>
      <div class="kv"><span class="muted">Цена</span><b>бесплатно и без рекламы</b></div>
      <div class="kv"><span class="muted">Твои данные</span><b>на телефоне + копия на сервере</b></div>
      <div class="kv"><span class="muted">Игроков в Системе</span><b>${board ? board.length : "—"}</b></div>
    </div>
    <div class="win"><div class="win-h">Правила Системы</div>
      ${sec("Опыт и уровни", `XP дают записи еды (+5, до 10 в день), ежедневные квесты, испытания, дуэли, задания навыка и экзамены. Уровень N→N+1 стоит 100 + 25·(N−1) XP. Опыт за пропуски не отнимается. Серию дней берегут щиты: 1 в начале и +1 за каждые 7 дней подряд (до 3). Пропустил день — щит сгорает, серия живёт.`)}
      ${sec("Ежедневные квесты", `Тренировка Системы (+80), учёт питания (+30), норма калорий 85–105% (+60). Все три — бонус +50 и «идеальный день». Нормы тренировки растут с уровнем.`)}
      ${sec("Ранги и экзамены", `Уровень открывает экзамен, ранг даётся только после сдачи. E→D 7 дней, D→C 14, C→B 21, B→A 30, A→S 45, S→Национальный уровень 60. Каждый день — все квесты, усиленная тренировка и честные отметки. Одна ошибка — провал и пересдача через несколько дней.`)}
      ${sec("Испытания недели и рейды", `Каждую неделю у всех открываются одни и те же испытания разной сложности и рейд. Прошёл — XP и редкий титул. Взялся и не прошёл до воскресенья — штраф. В рейде проигрывают все, если не справится хоть один.`)}
      ${sec("Сезоны и дуэли", `Сезоны: неделя, месяц, год — считается XP за период. Победители: «Огонь недели», «Пламя месяца», «Феникс года». Дуэль на 7 дней: XP, дни в норме или тренировки; победитель забирает ставку.`)}
      ${sec("Навыки", `Интервью → проверка уровня → план на 30 дней. Каждый день — задание, сдача работы и разбор, повторение, босс каждую неделю, финальный проект. Пропуск — −40 XP и титул «Беглец» на неделю.`)}
      ${sec("Честность", `Многие условия отмечаются вручную. Система доверяет игрокам: обманываешь — обманываешь только себя.`)}
    </div>
    <div class="center tiny dim mb">Ingot · v5.0 · «Переплавь усилия в золото»</div>`;
}

/* ============================ экран: Рейтинг ============================ */
let board = null, boardErr = null, boardAt = 0, boardPeriod = "week", champs = null;
let rtab = "board", feed = null, feedAt = 0, duels = null, duelsAt = 0;
const PERIODS = V2 ? [["week", "Неделя"], ["month", "Месяц"], ["year", "Год"], ["all", "Всё время"]] : [["week", "Неделя"], ["all", "Всё время"]];
const CHAMP = { week: ["Огонь недели", "🔥"], month: ["Пламя месяца", "♛"], year: ["Феникс года", "🦅"] };
const METRICS = { xp: "больше XP", norm: "больше дней в норме", workout: "больше тренировок" };
async function loadBoard() {
  try {
    const d = await api("leaderboard", { period: boardPeriod });
    board = d.players || []; champs = d.champions || null; boardErr = null; boardAt = Date.now();
    seasonPopups();
  } catch (e) { boardErr = e.message; }
  if (tab === "rating") render();
}
function seasonPopups() {
  if (!V2 || !champs || !S.player) return;
  S.seen.champs = S.seen.champs || [];
  for (const k of ["week", "month", "year"]) {
    const c = champs[k]; if (!c || S.seen.champs.includes(c.key)) continue;
    S.seen.champs.push(c.key);
    const mine = c.id === S.player.id, [name, ic] = CHAMP[k];
    if (mine) {
      const id = `champ_${c.key}`;
      if (!S.extraTitles.some(t => t.id === id)) S.extraTitles.push({ id, ic, n: name, d: `Победитель сезона: ${k === "week" ? "неделя" : k === "month" ? "месяц" : "год"} (${c.key.split(":")[1]})` });
      S.adj.push({ date: today(), xp: k === "week" ? 100 : k === "month" ? 300 : 1000, why: name });
      postEvent("season", `стал «${name}»`);
    }
    system({ kind: mine ? "levelup" : "achv", tag: "СЕЗОН ЗАВЕРШЁН", head: `${ic} ${name}`, body: mine ? `Это ты, ${c.name}.\nНаграда: титул «${name}» и бонус XP.` : `${c.name} — ${c.xp} XP за сезон.\nСледующий сезон уже начался.` });
  }
  save();
}
async function loadFeed() {
  try { const d = await api("feed"); feed = d.events || []; feedAt = Date.now(); } catch (e) { feed = feed || []; toast(e.message, true); }
  if (tab === "rating") render();
}
let lives = [];
async function loadDuels() {
  if (!S.player) return;
  try {
    const [d, l] = await Promise.all([api("duels", { token: S.player.token }), api("live_list", { token: S.player.token })]);
    duels = d.duels || []; lives = l.live || []; duelsAt = Date.now(); applyDuels(); applyLives(lives);
  } catch (e) { duels = duels || []; toast(e.message, true); }
  if (tab === "rating") render();
}
function applyDuels() {
  S.duelsApplied = S.duelsApplied || {};
  let ch = false;
  for (const d of duels || []) {
    if (d.status !== "done" || S.duelsApplied[d.id]) continue;
    S.duelsApplied[d.id] = 1; ch = true;
    if (!d.winner) { system({ tag: "ДУЭЛЬ", head: "Ничья", body: `${d.a_name} vs ${d.b_name}\nСтавки возвращены.` }); continue; }
    const won = d.winner === S.player.id, opp = d.a === S.player.id ? d.b_name : d.a_name;
    S.adj.push({ date: today(), xp: won ? d.stake : -d.stake, why: `Дуэль с ${opp}` });
    system({ kind: won ? "levelup" : "penalty", tag: won ? "ПОБЕДА В ДУЭЛИ" : "ПОРАЖЕНИЕ В ДУЭЛИ", head: `vs ${opp}`, body: `${won ? "+" : "−"}${d.stake} XP` });
  }
  if (ch) save();
}
const EXN = { push: "Отжимания", squat: "Приседания", abs: "Скручивания" };
function applyLives(list) {
  S.liveApplied = S.liveApplied || {};
  let ch = false;
  for (const d of list || []) {
    if (d.status !== "done" || S.liveApplied[d.id]) continue;
    S.liveApplied[d.id] = 1; ch = true;
    const iA = d.a === S.player.id, my = iA ? d.a_reps : d.b_reps, their = iA ? d.b_reps : d.a_reps, opp = iA ? d.b_name : d.a_name;
    if (!d.winner) { system({ tag: "ЖИВАЯ ДУЭЛЬ", head: "Ничья", body: `${my} : ${their}\n${EXN[d.exercise]} против ${opp}` }); continue; }
    const won = d.winner === S.player.id;
    S.adj.push({ date: today(), xp: won ? d.stake : -d.stake, why: `Живая дуэль с ${opp}` });
    system({ kind: won ? "levelup" : "penalty", tag: won ? "ПОБЕДА" : "ПОРАЖЕНИЕ", head: `${my} : ${their}`, body: `${EXN[d.exercise]} против ${opp}\n${won ? "+" : "−"}${d.stake} XP\n\n${phrase(won ? "allQuests" : "penalty")}` });
  }
  if (ch) save();
}
/** Живая дуэль: ожидание соперника → отсчёт → камера с гонкой → итог. */
async function runLive(id) {
  loadPose().then(m => m.preloadPose()); // модель позы качается, пока ждём соперника
  const st = async () => api("live_state", { token: S.player.token, id });
  let r = await st();
  if (r.duel.status === "pending") {
    const ok = await new Promise(res => {
      sheet(`<div class="center"><div class="tag-sys">ЖИВАЯ ДУЭЛЬ</div><div class="sys-font mt" style="font-size:19px;color:#fff">Ждём соперника…</div>
        <div class="small muted mt">Вызов действует 10 минут. Как только соперник примет, начнётся отсчёт.</div><div class="mt"><span class="spinner"></span></div>
        <button class="btn ghost block mt" id="lw-x">Закрыть</button></div>`, (el, close) => {
        let alive = true;
        el.querySelector("#lw-x").onclick = () => { alive = false; close(); res(false); };
        (async () => { while (alive) { await new Promise(t => setTimeout(t, 2000)); if (!alive) return;
          try { r = await st(); } catch { continue; }
          if (r.duel.status === "active") { alive = false; close(); return res(true); }
          if (r.duel.status !== "pending") { alive = false; close(); toast("Вызов отклонён или устарел", true); return res(false); } } })();
      });
    });
    if (!ok) return;
  }
  if (r.duel.status !== "active") { if (r.duel.status === "done") { applyLives([r.duel]); render(); } return; }
  const d = r.duel, iA = d.a === S.player.id, offset = r.server_now - Date.now();
  const { openCamera } = await loadPose();
  let last = { opp: 0 };
  openCamera({ kind: d.exercise, esc, sfx: k => S.sound !== false && sfx(k),
    race: { seconds: d.seconds, startAt: Date.parse(d.start_at) - offset,
      push: reps => api("live_update", { token: S.player.token, id, reps }).then(x => { last = { opp: iA ? x.duel.b_reps : x.duel.a_reps, oppName: iA ? x.duel.b_name : x.duel.a_name }; }),
      poll: async () => last },
    onFinish: async reps => {
      try { await api("live_update", { token: S.player.token, id, reps }); } catch {}
      toast("Подсчёт результата…");
      for (let i = 0; i < 12; i++) {
        await new Promise(t => setTimeout(t, 1500));
        try { const x = await st(); if (x.duel.status === "done") { applyLives([x.duel]); duels = null; render(); return; } } catch {}
      }
    } });
}

const ago = iso => { const m = Math.round((Date.now() - new Date(iso)) / 6e4); return m < 1 ? "только что" : m < 60 ? `${m} мин` : m < 1440 ? `${Math.round(m / 60)} ч` : `${Math.round(m / 1440)} д`; };

function renderRating(P) {
  if (!API_URL || !S.player) {
    $app.innerHTML = `<div class="screen-title"><h1>Рейтинг</h1></div>
      <div class="win"><div class="win-h">Сервер не подключён</div><div class="small muted">Рейтинг заработает, когда будет подключён сервер Ingot.</div></div>`;
    return;
  }
  if (rtab === "board" && ((!board && !boardErr) || Date.now() - boardAt > 60000)) loadBoard();
  if (rtab === "feed" && (!feed || Date.now() - feedAt > 30000)) loadFeed();
  if (rtab === "duels" && (!duels || Date.now() - duelsAt > 30000)) loadDuels();
  const td = today(), me = S.player.id;
  let body = "";
  if (rtab === "board") {
    const rows = (board || []).map((u, i) => {
      const fresh = u.stats_date === td;
      const q = fresh ? u.today_quests : 0, qt = u.today_total || QUESTS.length;
      const streak = fresh || u.stats_date === addDays(td, -1) ? u.streak : 0;
      const badges = V2 && champs ? ["week", "month", "year"].filter(k => champs[k] && champs[k].id === u.id).map(k => CHAMP[k][1]).join("") : "";
      return `<div class="lb ${u.id === me ? "me" : ""}" ${V2 && u.id !== me ? `data-duel="${u.id}" data-name="${esc(u.name)}"` : ""}>
        <div class="pos ${i < 3 ? "top" + (i + 1) : ""}">${i + 1}</div>
        <div class="rank-mini rank-${esc(u.rank)}" title="${esc(rankName(u.rank))}">${esc(rankMono(u.rank))}</div>
        <div class="grow" style="min-width:0">
          <div class="nm">${badges ? `<span class="champ-b">${badges}</span> ` : ""}${esc(u.name)}${u.id === me ? ' <span class="tiny muted">(ты)</span>' : ""}</div>
          <div class="tiny muted ell">${u.title ? "«" + esc(u.title) + "» · " : ""}LV. ${u.level} · ${boardPeriod === "all" ? u.xp + " XP" : `<b style="color:var(--blue2)">${u.season_xp ?? 0} XP</b> за сезон`}</div>
        </div>
        <div class="lb-r"><div title="серия">🔥 ${streak}</div><div class="tiny ${q >= qt ? "ok" : "muted"}">квесты ${q}/${qt}</div></div>
      </div>`;
    }).join("");
    const ch = V2 && champs ? ["week", "month", "year"].filter(k => champs[k]).map(k => `<div class="champ"><span>${CHAMP[k][1]}</span><div><div class="tiny muted">${CHAMP[k][0]}</div><b>${esc(champs[k].name)}</b></div></div>`).join("") : "";
    body = `<div class="seg mb">${PERIODS.map(([k, n]) => `<button data-per="${k}" class="${boardPeriod === k ? "on" : ""}">${n}</button>`).join("")}</div>
      ${ch ? `<div class="champs mb">${ch}</div>` : ""}
      <div class="win"><div class="win-h">${boardPeriod === "all" ? "Таблица игроков" : V2 ? "Сезон: " + PERIODS.find(p => p[0] === boardPeriod)[1].toLowerCase() : "Эта неделя"}<span class="right">по XP</span></div>
        ${boardErr ? `<div class="small bad">${esc(boardErr)}</div>` : !board ? `<div class="center"><span class="spinner"></span></div>` : rows || `<div class="empty">Пока никого. Позови друзей!</div>`}
      </div>
      <div class="tiny muted center mb">${V2 ? "Тапни по игроку, чтобы вызвать его на дуэль.<br>" : ""}🔥 — дней подряд в ударе · квесты — выполнено сегодня.</div>
      <button class="btn ghost block" id="lb-share">Пригласить друга</button>`;
  } else if (rtab === "feed") {
    body = `<div class="win"><div class="win-h">Лента игроков</div>
      ${!feed ? `<div class="center"><span class="spinner"></span></div>` : feed.length ? feed.map(ev => `<div class="feed-i">
        <div class="rank-mini rank-${esc((ev.players && ev.players.rank) || "E")}">${esc(rankMono((ev.players && ev.players.rank) || "E"))}</div>
        <div class="grow"><b>${esc(ev.players ? ev.players.name : "?")}</b> <span class="small">${esc(ev.text)}</span></div>
        <span class="tiny dim">${ago(ev.created_at)}</span></div>`).join("") : `<div class="empty">Пока тихо. Сделай первый шаг — и он появится здесь.</div>`}</div>`;
  } else {
    const list = duels || [];
    const liveRows = (lives || []).map(d => {
      const iA = d.a === me, opp = iA ? d.b_name : d.a_name, my = iA ? d.a_reps : d.b_reps, their = iA ? d.b_reps : d.a_reps;
      return `<div class="duel live ${d.status}"><div class="row"><b class="grow">⚡ ${esc(opp)}</b><span class="tiny muted">${EXN[d.exercise]} · 60 сек · ${d.stake} XP</span></div>
        ${d.status === "pending" ? (iA ? `<button class="btn ghost sm block mt" data-lgo="${d.id}">Ждём ответа — открыть</button>` :
          `<div class="grid2 mt"><button class="btn danger sm" data-lresp="${d.id}" data-acc="0">Отказаться</button><button class="btn-epic" data-lresp="${d.id}" data-acc="1">В бой!</button></div>`) :
        d.status === "active" ? `<button class="btn-epic block mt" data-lgo="${d.id}">Войти в бой</button>` :
        `<div class="duel-sc"><div><div class="sys-font">${my}</div><div class="tiny muted">ты</div></div><div class="tiny dim">vs</div><div><div class="sys-font">${their}</div><div class="tiny muted">${esc(opp)}</div></div></div>
         <div class="tiny center ${d.winner === me ? "ok" : d.winner ? "bad" : "muted"}">${d.winner === me ? "Победа" : d.winner ? "Поражение" : "Ничья"}</div>`}</div>`;
    }).join("");
    body = `${liveRows ? `<div class="win live-win"><div class="win-h">⚡ Живые дуэли</div>${liveRows}</div>` : ""}
      <div class="win"><div class="win-h">Дуэли<span class="right">7 дней</span></div>
      <div class="tiny muted mb">Вызов — в таблице рейтинга, тапом по сопернику. Дуэль начинается со следующего дня после принятия. Победитель забирает ставку XP.</div>
      ${!duels ? `<div class="center"><span class="spinner"></span></div>` : list.length ? list.map(d => {
        const iA = d.a === me, opp = iA ? d.b_name : d.a_name;
        const my = d.score ? d.score[me] ?? 0 : 0, their = d.score ? d.score[iA ? d.b : d.a] ?? 0 : 0;
        const left = d.end_day ? Math.max(0, Math.round((parseD(d.end_day) - parseD(td)) / 864e5) + 1) : 0;
        return `<div class="duel ${d.status}">
          <div class="row"><b class="grow">⚔ ${esc(opp)}</b><span class="tiny muted">${METRICS[d.metric]} · ставка ${d.stake} XP</span></div>
          ${d.status === "pending" ? (iA ? `<div class="tiny muted mt">Ждём ответа соперника…</div>` :
            `<div class="grid2 mt"><button class="btn danger sm" data-dresp="${d.id}" data-acc="0">Отказаться</button><button class="btn sm" data-dresp="${d.id}" data-acc="1">Принять вызов</button></div>`) :
          `<div class="duel-sc"><div><div class="sys-font">${my}</div><div class="tiny muted">ты</div></div><div class="tiny dim">vs</div><div><div class="sys-font">${their}</div><div class="tiny muted">${esc(opp)}</div></div></div>
           <div class="tiny ${d.status === "done" ? (d.winner === me ? "ok" : d.winner ? "bad" : "muted") : "muted"} center">${d.status === "done" ? (d.winner === me ? "Победа" : d.winner ? "Поражение" : "Ничья") : td < d.start_day ? "Начнётся завтра" : `Осталось дней: ${left}`}</div>`}
        </div>`;
      }).join("") : `<div class="empty">Дуэлей пока нет.</div>`}</div>`;
  }
  $app.innerHTML = `<div class="screen-title"><h1>Рейтинг</h1><button class="icon-btn" style="margin-left:auto" id="lb-refresh" aria-label="Обновить">↻</button></div>
    <div class="seg mb rtabs"><button data-rt="board" class="${rtab === "board" ? "on" : ""}">Таблица</button><button data-rt="feed" class="${rtab === "feed" ? "on" : ""}">Лента</button>${V2 ? `<button data-rt="duels" class="${rtab === "duels" ? "on" : ""}">Дуэли</button>` : ""}</div>
    ${body}`;
  $app.querySelectorAll("[data-rt]").forEach(b => b.onclick = () => { rtab = b.dataset.rt; render(); });
  $app.querySelectorAll("[data-per]").forEach(b => b.onclick = () => { boardPeriod = b.dataset.per; board = null; boardErr = null; render(); });
  document.getElementById("lb-refresh").onclick = () => {
    board = null; boardErr = null; feed = null; duels = null;
    syncNow().finally(() => { if (rtab === "board") loadBoard(); else if (rtab === "feed") loadFeed(); else loadDuels(); });
    render();
  };
  const sh = document.getElementById("lb-share");
  if (sh) sh.onclick = async () => {
    const url = location.href.split("#")[0];
    try { if (navigator.share) await navigator.share({ title: "Ingot", text: "Давай прокачиваться вместе в Ingot!", url }); else { await navigator.clipboard.writeText(url); toast("Ссылка скопирована"); } } catch {}
  };
  $app.querySelectorAll("[data-duel]").forEach(r => r.onclick = () => openDuel(r.dataset.duel, r.dataset.name));
  $app.querySelectorAll("[data-lgo]").forEach(b => b.onclick = () => runLive(b.dataset.lgo).catch(e => toast(e.message, true)));
  $app.querySelectorAll("[data-lresp]").forEach(b => b.onclick = async () => {
    b.disabled = true;
    try {
      await api("live_respond", { token: S.player.token, id: b.dataset.lresp, accept: b.dataset.acc === "1" });
      if (b.dataset.acc === "1") runLive(b.dataset.lresp).catch(e => toast(e.message, true)); else { duels = null; render(); }
    } catch (e) { toast(e.message, true); b.disabled = false; }
  });
  $app.querySelectorAll("[data-dresp]").forEach(b => b.onclick = async () => {
    b.disabled = true;
    try { await api("duel_respond", { token: S.player.token, id: b.dataset.dresp, accept: b.dataset.acc === "1" }); toast(b.dataset.acc === "1" ? "Вызов принят. Дуэль начнётся завтра." : "Вызов отклонён"); duels = null; render(); }
    catch (e) { toast(e.message, true); b.disabled = false; }
  });
}
function openDuel(id, name) {
  let metric = "xp", stake = 100, mode = "week", exercise = "push";
  sheet(`<h2>Дуэль</h2><div class="small mb">Вызвать <b>${esc(name)}</b> на дуэль.</div>
    <div class="seg mb" id="dmode"><button data-mode="week" class="on">Недельная</button><button data-mode="live">⚡ Живая · 60 сек</button></div>
    <div id="dlive" class="hidden"><div class="small mb">Вы одновременно включаете камеры. Кто сделает больше повторов за 60 секунд — забирает 50 XP. Камера считает сама.</div>
      <div class="f">Упражнение</div><div class="chips-row">${Object.entries(EXN).map(([k, v]) => `<button class="chip-b ${k === exercise ? "on" : ""}" data-ex="${k}">${v}</button>`).join("")}</div>
      <button class="btn-epic block mt" id="lg">⚡ Бросить живой вызов</button></div>
    <div id="dweek">
    <div class="f">Кто…</div><div class="chips-row" id="dm">${Object.entries(METRICS).map(([k, v]) => `<button class="chip-b ${k === metric ? "on" : ""}" data-m="${k}">${v}</button>`).join("")}</div>
    <div class="f mt">Ставка XP (победитель забирает у проигравшего)</div><div class="chips-row" id="ds">${[50, 100, 200, 300].map(v => `<button class="chip-b ${v === stake ? "on" : ""}" data-s="${v}">${v}</button>`).join("")}</div>
    <button class="btn-epic block mt" id="dg">Бросить вызов</button></div>`, (el, close) => {
    el.querySelectorAll("[data-mode]").forEach(b => b.onclick = () => { mode = b.dataset.mode; el.querySelectorAll("[data-mode]").forEach(x => x.classList.toggle("on", x === b));
      el.querySelector("#dlive").classList.toggle("hidden", mode !== "live"); el.querySelector("#dweek").classList.toggle("hidden", mode === "live"); });
    el.querySelectorAll("[data-ex]").forEach(b => b.onclick = () => { exercise = b.dataset.ex; el.querySelectorAll("[data-ex]").forEach(x => x.classList.toggle("on", x === b)); });
    el.querySelector("#lg").onclick = async () => {
      const btn = el.querySelector("#lg"); btn.disabled = true;
      try { const r = await api("live_create", { token: S.player.token, opponent: id, exercise }); close(); rtab = "duels"; duels = null; render(); runLive(r.id).catch(e => toast(e.message, true)); }
      catch (e) { toast(e.message, true); btn.disabled = false; }
    };
    el.querySelectorAll("[data-m]").forEach(b => b.onclick = () => { metric = b.dataset.m; el.querySelectorAll("[data-m]").forEach(x => x.classList.toggle("on", x === b)); });
    el.querySelectorAll("[data-s]").forEach(b => b.onclick = () => { stake = +b.dataset.s; el.querySelectorAll("[data-s]").forEach(x => x.classList.toggle("on", x === b)); });
    el.querySelector("#dg").onclick = async () => {
      const btn = el.querySelector("#dg"); btn.disabled = true;
      try {
        await api("duel_create", { token: S.player.token, opponent: id, metric, stake });
        close(); toast("Вызов отправлен"); rtab = "duels"; duels = null; render();
      } catch (e) { toast(e.message, true); btn.disabled = false; }
    };
  });
}

/* ============================ тренировка ============================ */
function openWorkout(date, lvl) {
  sheet(`<div id="wk"></div>`, (el, close) => {
    const draw = () => {
      const w = wDay(date);
      el.querySelector("#wk").innerHTML = `<h2>Тренировка Системы</h2>
        <div class="tiny muted mb">${humanDate(date)} · уровень ${lvl}: нормы растут вместе с уровнем</div>
        ${EX.map(ex => {
          const tg = exTarget(ex, lvl, date), v = w[ex.id] || 0, done = v >= tg, cam = CAM.includes(ex.id), vv = vDay(date)[ex.id] || 0;
          return `<div class="quest ${done ? "done" : ""}"><div class="box">${done ? "✓" : ""}</div>
            <div class="grow"><div class="qt">${ex.n}</div><div class="qp">${r1(v)} / ${tg}${ex.unit}${cam && vv ? ` · <span class="ok">камера ${vv}</span>` : ""}</div>
              <div class="bar" style="margin-top:5px"><i style="width:${clamp(v / tg * 100, 0, 100)}%"></i></div></div>
            <div class="row" style="gap:6px">
              ${cam ? `<button class="icon-btn cam-btn" data-cam="${ex.id}" aria-label="Камера">📷</button>` : ""}
              <button class="icon-btn" data-dec="${ex.id}">−</button>
              <button class="icon-btn" data-inc="${ex.id}" style="width:auto;padding:0 8px">+${ex.inc}</button>
              <button class="icon-btn" data-full="${ex.id}" style="color:var(--ok)">✓</button>
            </div></div>`;
        }).join("")}
        <div class="notice mt">📷 <b>С камерой</b> — тренировка подтверждена: +${XP.workout} XP и ✓. Вручную — +${Math.round(XP.workout / 2)} XP.${exMult(date) !== 1 ? "<br><b class=\"bad\">Идёт экзамен: отжимания, приседания и скручивания засчитываются только с камеры.</b>" : ""}<br>Камера считает повторы прямо на телефоне — видео никуда не отправляется.</div>
        <button class="btn block mt" id="wk-close">Готово</button>`;
      const set = (id, v) => {
        const ex = EX.find(e => e.id === id);
        S.workouts[date] = Object.assign({}, wDay(date), { [id]: Math.max(0, r1(Math.min(v, exTarget(ex, lvl, date) * 3))) });
        save(); draw(); render();
      };
      el.querySelectorAll("[data-inc]").forEach(b => b.onclick = () => { const ex = EX.find(e => e.id === b.dataset.inc); set(ex.id, (wDay(date)[ex.id] || 0) + ex.inc); });
      el.querySelectorAll("[data-dec]").forEach(b => b.onclick = () => { const ex = EX.find(e => e.id === b.dataset.dec); set(ex.id, (wDay(date)[ex.id] || 0) - ex.inc); });
      el.querySelectorAll("[data-full]").forEach(b => b.onclick = () => { const ex = EX.find(e => e.id === b.dataset.full); set(ex.id, exTarget(ex, lvl, date)); });
      el.querySelectorAll("[data-cam]").forEach(b => b.onclick = async () => {
        const ex = EX.find(e => e.id === b.dataset.cam);
        b.disabled = true;
        try {
          const { openCamera } = await loadPose();
          const left = Math.max(0, exTarget(ex, lvl, date) - (vDay(date)[ex.id] || 0));
          openCamera({ kind: ex.id, target: left || exTarget(ex, lvl, date), esc, sfx: k => S.sound !== false && sfx(k), onFinish: reps => {
            if (!reps) return;
            S.verified = S.verified || {};
            S.verified[date] = Object.assign({}, vDay(date), { [ex.id]: (vDay(date)[ex.id] || 0) + reps });
            const cur = wDay(date)[ex.id] || 0, ver = S.verified[date][ex.id];
            S.workouts[date] = Object.assign({}, wDay(date), { [ex.id]: Math.max(cur, ver) });
            save(); draw(); render();
            toast(`📷 ${ex.n}: +${reps} (подтверждено камерой)`);
            const P2 = computeProgress(), d2 = P2.days[date];
            if (d2 && d2.q.workout.verified && !(S.seen.verifiedPosted || []).includes(date)) {
              S.seen.verifiedPosted = [...(S.seen.verifiedPosted || []).slice(-30), date]; save();
              postEvent("workout", "выполнил тренировку Системы, подтверждённую камерой ✓");
            }
          } });
        } catch (e) { toast("Не удалось открыть камеру: " + (e.message || e), true); }
        b.disabled = false;
      });
      el.querySelector("#wk-close").onclick = close;
    };
    draw();
  });
}

/* ============================ экран: Настройки ============================ */
function profileFields(p, withName) {
  p = p || { name: "", sex: "m", age: 25, height: 178, weight: 80, targetWeight: 75, activity: 1.375 };
  return `
    ${withName ? `<label class="f">Имя игрока (видно в рейтинге)<input class="in" id="pf-name" value="${esc(p.name)}" placeholder="Например, Сурен" maxlength="24" autocomplete="off"></label>` : ""}
    <div class="grid2 ${withName ? "mt" : ""}">
      <label class="f">Пол<select class="in" id="pf-sex"><option value="m" ${p.sex === "m" ? "selected" : ""}>Мужской</option><option value="f" ${p.sex === "f" ? "selected" : ""}>Женский</option></select></label>
      <label class="f">Возраст<input class="in" id="pf-age" inputmode="numeric" value="${p.age}"></label>
      <label class="f">Рост, см<input class="in" id="pf-height" inputmode="decimal" value="${p.height}"></label>
      <label class="f">Вес сейчас, кг<input class="in" id="pf-weight" inputmode="decimal" value="${p.weight}"></label>
      <label class="f">Желаемый вес, кг<input class="in" id="pf-target" inputmode="decimal" value="${p.targetWeight ?? p.weight}"></label>
    </div>
    <label class="f mt">Активность<select class="in" id="pf-act">${ACTIVITY.map(a => `<option value="${a.v}" ${+p.activity === a.v ? "selected" : ""}>${a.n}</option>`).join("")}</select></label>
    `;
}
function readProfile(base) {
  const g = id => document.getElementById(id);
  const p = Object.assign({}, base, {
    name: g("pf-name") ? g("pf-name").value.trim().replace(/\s+/g, " ") : base.name,
    sex: g("pf-sex").value, age: r0(num(g("pf-age").value)), height: num(g("pf-height").value),
    weight: r1(num(g("pf-weight").value)), targetWeight: r1(num(g("pf-target").value)), activity: num(g("pf-act").value),
  });
  if (!p.name || p.name.length < 2) { toast("Введи имя (от 2 букв)", true); return null; }
  if (p.age < 10 || p.age > 100 || p.height < 120 || p.height > 230 || p.weight < 30 || p.weight > 300) {
    toast("Проверь возраст, рост и вес", true); return null;
  }
  if (p.targetWeight < 35 || p.targetWeight > 300) { toast("Проверь желаемый вес", true); return null; }
  p.goal = goalOf(p);
  return p;
}

function renderSettings() {
  const p = S.profile, t = targets(), auto = calcTargets(p);
  $app.innerHTML = `
    ${accountWin()}
    <div class="win"><div class="win-h">Уведомления и звук</div>
      <div class="small mb">Система напомнит о квесте утром, днём (если ничего не записано) и вечером (если квест не закрыт), и сообщит о вызове на дуэль.</div>
      <button class="btn block ${pushOn() ? "ghost" : ""}" id="push-btn">${pushOn() ? "Уведомления включены · выключить" : "Включить уведомления"}</button>
      <div class="tiny muted mt" id="push-hint">${!("PushManager" in window) ? "Чтобы получать уведомления на iPhone, открой Ingot с иконки на экране «Домой» (iOS 16.4 или новее)." : ""}</div>
      <div class="row mt"><span class="grow small">Звуки Системы</span><button class="btn sm ${S.sound === false ? "ghost" : ""}" id="snd-btn">${S.sound === false ? "Выкл" : "Вкл"}</button></div>
    </div>
    <div class="win"><div class="win-h">Параметры тела и цель</div>
      ${profileFields(p, false)}
      <button class="btn block mt" id="save-prof">Сохранить параметры</button>
      <div class="tiny muted mt">Обмен веществ (BMR): ${auto.bmr} ккал · расход с активностью: ${auto.tdee} ккал</div>
    </div>
    <div class="win"><div class="win-h">Дневная норма</div>
      <div class="seg mb"><button data-tg="auto" class="${p.customTargets ? "" : "on"}">Авторасчёт</button><button data-tg="custom" class="${p.customTargets ? "on" : ""}">Своя норма</button></div>
      <div class="grid4">
        <label class="f">Ккал<input class="in" id="tg-k" inputmode="numeric" value="${t.kcal}" ${p.customTargets ? "" : "disabled"}></label>
        <label class="f">Белки<input class="in" id="tg-p" inputmode="numeric" value="${t.p}" ${p.customTargets ? "" : "disabled"}></label>
        <label class="f">Жиры<input class="in" id="tg-f" inputmode="numeric" value="${t.f}" ${p.customTargets ? "" : "disabled"}></label>
        <label class="f">Углев.<input class="in" id="tg-c" inputmode="numeric" value="${t.c}" ${p.customTargets ? "" : "disabled"}></label>
      </div>
      ${p.customTargets ? `<button class="btn block mt" id="save-tg">Сохранить норму</button>` : `<div class="tiny muted mt">Формула Миффлина — Сан Жеора, темп ~0,75% веса в неделю, белок ${auto.goal === "lose" ? "2 г на кг целевого веса" : auto.goal === "gain" ? "1,8 г/кг" : "1,6 г/кг"}.</div>`}
    </div>
    <div class="win"><div class="win-h">Данные</div>
      <div class="grid2"><button class="btn ghost" id="exp">Экспорт</button><button class="btn ghost" id="imp">Импорт</button></div>
      <input type="file" id="imp-file" accept="application/json,.json" class="hidden">
      <div class="tiny muted mt">Записей: ${S.entries.length}. ${S.player ? "Копия данных хранится на сервере — восстановишь по коду." : "Данные лежат только в этом браузере — делай экспорт."}</div>
      <button class="btn danger block mt" id="reset">Сбросить всё на этом телефоне</button>
      ${S.player ? `<button class="btn danger block mt" id="del-acc">Удалить аккаунт</button>
      <div class="tiny muted mt">Удаляет аккаунт и все данные на сервере: прогресс, рейтинг, ленту, дуэли. Отменить нельзя.</div>` : ""}
    </div>
    <div class="center tiny dim mb"><a href="./privacy.html" target="_blank" rel="noopener" style="color:inherit">Политика приватности</a> · <a href="./terms.html" target="_blank" rel="noopener" style="color:inherit">Условия</a></div>
    <div class="center tiny dim mb">Ingot · v5.0</div>`;
  document.getElementById("push-btn").onclick = togglePush;
  document.getElementById("snd-btn").onclick = () => { S.sound = S.sound === false; save(); render(); if (S.sound) sfx("achv"); };
  bindAccount();

  document.getElementById("save-prof").onclick = () => {
    const np = readProfile(p); if (!np) return;
    if (np.weight !== p.weight) addWeight(np.weight, false);
    S.profile = np; save(); toast("Параметры обновлены"); render();
  };
  $app.querySelectorAll("[data-tg]").forEach(b => b.onclick = () => {
    S.profile.customTargets = b.dataset.tg === "custom";
    if (S.profile.customTargets && !S.profile.targets) S.profile.targets = calcTargets(S.profile);
    save(); render();
  });
  const st = document.getElementById("save-tg");
  if (st) st.onclick = () => {
    const g = id => r0(num(document.getElementById(id).value));
    const nt = { kcal: g("tg-k"), p: g("tg-p"), f: g("tg-f"), c: g("tg-c") };
    if (nt.kcal < 800) return toast("Норма калорий слишком мала", true);
    S.profile.targets = nt; save(); toast("Норма сохранена"); render();
  };
  document.getElementById("exp").onclick = exportData;
  document.getElementById("imp").onclick = () => document.getElementById("imp-file").click();
  document.getElementById("imp-file").onchange = importData;
  document.getElementById("reset").onclick = () => {
    if (!confirm("Удалить ВСЕ данные: записи, прогресс, профиль?")) return;
    if (!confirm("Точно? Это нельзя отменить.")) return;
    localStorage.removeItem(STORE_KEY); S = defaultState(); tab = "status"; render();
  };
  const del = document.getElementById("del-acc");
  if (del) del.onclick = async () => {
    if (!confirm("Удалить аккаунт и все данные на сервере? Прогресс, рейтинг и код восстановления перестанут работать.")) return;
    if (!confirm("Точно удалить? Это нельзя отменить.")) return;
    del.disabled = true; del.textContent = "Удаляю…";
    try { await api("delete_account", { token: S.player.token }); }
    catch (e) { del.disabled = false; del.textContent = "Удалить аккаунт"; return toast("Не удалось удалить: " + (e.message || "нет связи") + ". Попробуй ещё раз.", true); }
    try { const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); if (sub) await sub.unsubscribe(); } catch {}
    localStorage.removeItem(STORE_KEY); S = defaultState(); tab = "status"; render();
    toast("Аккаунт и данные удалены");
  };
}
const pushOn = () => !!S.pushOn && typeof Notification !== "undefined" && Notification.permission === "granted";
const b64u8 = b64 => { const p = "=".repeat((4 - b64.length % 4) % 4), s2 = atob((b64 + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(s2, c => c.charCodeAt(0)); };
async function togglePush() {
  if (pushOn()) {
    try { const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); if (sub) await sub.unsubscribe(); } catch {}
    try { await api("push_unsub", { token: S.player.token }); } catch {}
    S.pushOn = false; save(); render(); toast("Уведомления выключены"); return;
  }
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return toast("Открой Ingot с иконки на экране «Домой» — в браузере iPhone уведомления не работают", true);
  if (!S.player) return toast("Сначала войди в рейтинг", true);
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return toast("Разреши уведомления в настройках iPhone: Настройки → Уведомления → Ingot", true);
  try {
    const { key } = await api("push_key");
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u8(key) });
    await api("push_sub", { token: S.player.token, sub: sub.toJSON(), test: true });
    S.pushOn = true; save(); render(); toast("Уведомления включены");
  } catch (e) { toast("Не удалось включить: " + (e.message || e), true); }
}

function accountWin() {
  if (!S.player) return API_URL ? `<div class="win violet"><div class="win-h">Аккаунт</div>
    <div class="small muted mb">Ты ещё не в рейтинге.</div><button class="btn violet block" id="acc-reg">Войти в рейтинг</button></div>` : "";
  return `<div class="win violet"><div class="win-h">Аккаунт<span class="right">${esc(S.player.name)}</span></div>
    <button class="btn ghost block mb" id="acc-rename">Сменить имя</button>
    <div class="small mb">Код восстановления — с ним ты вернёшь весь прогресс на новом телефоне. Никому не показывай.</div>
    <div class="row"><input class="in grow sys-font" id="acc-code" readonly value="••••••-••••••-••••••" style="letter-spacing:.08em">
      <button class="icon-btn" id="acc-show">👁</button><button class="icon-btn" id="acc-copy">⧉</button></div>
  </div>`;
}
function bindAccount() {
  const sh = document.getElementById("acc-show");
  if (sh) sh.onclick = () => { const i = document.getElementById("acc-code"); i.value = i.value.startsWith("•") ? S.player.token : "••••••-••••••-••••••"; };
  const cp = document.getElementById("acc-copy");
  if (cp) cp.onclick = async () => { try { await navigator.clipboard.writeText(S.player.token); toast("Код скопирован"); } catch { toast("Не удалось скопировать — нажми 👁 и перепиши", true); } };
  const rn = document.getElementById("acc-rename");
  if (rn) rn.onclick = () => sheet(`<h2>Сменить имя</h2>
      <label class="f">Новое имя (видно в рейтинге)<input class="in" id="rn-name" value="${esc(S.player.name)}" maxlength="24" autocomplete="off"></label>
      <button class="btn block mt" id="rn-go">Сохранить</button>`, (el, close) => {
    el.querySelector("#rn-go").onclick = async () => {
      const name = el.querySelector("#rn-name").value.trim().replace(/\s+/g, " ");
      if (name.length < 2) return toast("Имя слишком короткое", true);
      const btn = el.querySelector("#rn-go"); btn.disabled = true;
      try {
        const d = await api("rename", { token: S.player.token, name });
        S.player.name = d.name; S.profile.name = d.name; board = null;
        save(); close(); render(); toast("Имя изменено");
      } catch (e) { toast(e.message, true); btn.disabled = false; }
    };
  });
  const rg = document.getElementById("acc-reg");
  if (rg) rg.onclick = async () => {
    rg.disabled = true;
    try { await registerPlayer(S.profile.name); render(); } catch (e) { toast(e.message, true); rg.disabled = false; }
  };
}
async function registerPlayer(name) {
  const d = await api("register", { name });
  S.player = { id: d.id, token: d.token, name: d.name };
  S.profile.name = d.name;
  save(); syncNow();
  system({ kind: "achv", tag: "КОД ВОССТАНОВЛЕНИЯ", head: d.token,
    body: "Сохрани этот код (скриншот или заметки).\nС ним ты вернёшь прогресс на другом телефоне.\nОн также есть в Настройках.", btn: "Сохранил" });
}
function addWeight(kg, setProfile) {
  const td = today();
  S.weights = S.weights.filter(w => w.date !== td); S.weights.push({ date: td, kg });
  S.weights.sort((a, b) => a.date.localeCompare(b.date));
  if (setProfile) { S.profile.weight = kg; S.profile.goal = goalOf(S.profile); }
  save(); if (setProfile) toast(`Вес ${kg} кг записан. Норма пересчитана.`);
}
function exportData() {
  const data = Object.assign({}, S, { player: null }); // код игрока не экспортируем
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  a.download = `ingot-backup-${today()}.json`; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function importData(ev) {
  const f = ev.target.files[0]; if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const d = JSON.parse(rd.result);
      if (!d || !d.v || !Array.isArray(d.entries)) throw 0;
      if (!confirm(`Заменить текущие данные резервной копией (${d.entries.length} записей)?`)) return;
      const pl = S.player; S = Object.assign(defaultState(), d); S.player = pl || d.player || null; save(); toast("Данные восстановлены"); render();
    } catch { toast("Файл не подходит", true); }
  };
  rd.readAsText(f);
}

/* ============================ онбординг ============================ */
function renderOnboarding() {
  $app.innerHTML = `<div class="onb">
    <div class="onb-sig"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M12 2.8 21.2 12 12 21.2 2.8 12Z"/><path d="M12 8 16 12 12 16 8 12Z"/></svg></div>
    <div class="tagline">СИСТЕМА · НОВЫЙ ИГРОК</div>
    <div class="logo">Начало пути</div>
    <div class="onb-sub">Система выбрала тебя. Назови себя, Игрок.</div>
    <div class="win">
      <div class="small mb muted">Система составит план питания под твою цель, будет выдавать ежедневные квесты и повышать твой уровень.</div>
      ${profileFields(S.player ? { name: S.player.name, sex: "m", age: 25, height: 178, weight: 80, targetWeight: 75, activity: 1.375 } : null, !S.player)}
      <button class="btn-epic block mt" id="accept" style="margin-top:16px;width:100%">Начать путь</button>
      ${API_URL && !S.player ? `<button class="btn ghost block mt" id="restore">У меня есть код восстановления</button>` : ""}
    </div></div>`;
  const acc = document.getElementById("accept");
  acc.onclick = async () => {
    const p = readProfile(S.player ? { name: S.player.name } : {}); if (!p) return;
    p.createdAt = today(); p.customTargets = false;
    if (API_URL && !S.player) {
      acc.disabled = true; acc.innerHTML = `<span class="spinner"></span>`;
      try {
        const d = await api("register", { name: p.name });
        S.player = { id: d.id, token: d.token, name: d.name };
      } catch (e) { toast(e.message, true); acc.disabled = false; acc.textContent = "Принять"; return; }
    }
    S.profile = p;
    S.weights = [{ date: today(), kg: p.weight }];
    syncSeenSilently();
    const t = calcTargets(p);
    tab = "status"; render();
    system({ kind: "levelup", tag: "СИСТЕМА", head: "Путь начат",
      body: `Добро пожаловать, ${p.name}.\n\n${planText(t)}\n\nНорма: ${t.kcal} ккал · Б ${t.p} · Ж ${t.f} · У ${t.c}\nШаги: ${t.steps.toLocaleString("ru")} в день\n\nВыполняйте ежедневные квесты, чтобы расти в уровне.` });
    if (S.player) system({ kind: "achv", tag: "КОД ВОССТАНОВЛЕНИЯ", head: S.player.token,
      body: "Сохрани этот код (скриншот или заметки).\nС ним ты вернёшь прогресс на другом телефоне.\nОн также есть в Настройках.", btn: "Сохранил" });
  };
  const rs = document.getElementById("restore");
  if (rs) rs.onclick = () => sheet(`<h2>Восстановление</h2>
      <label class="f">Код восстановления<input class="in sys-font" id="rs-code" placeholder="XXXXXX-XXXXXX-XXXXXX" autocapitalize="characters" autocomplete="off"></label>
      <button class="btn block mt" id="rs-go">Восстановить</button>`, (el, close) => {
    el.querySelector("#rs-go").onclick = async () => {
      const token = el.querySelector("#rs-code").value.trim().toUpperCase();
      const btn = el.querySelector("#rs-go"); btn.disabled = true;
      try {
        const d = await api("restore", { token });
        if (d.save && d.save.profile) { S = Object.assign(defaultState(), d.save); }
        S.player = { id: d.id, token, name: d.name };
        save(); close(); tab = "status"; render();
        toast(S.profile ? "Прогресс восстановлен" : "Аккаунт найден — заполни параметры");
      } catch (e) { toast(e.message, true); btn.disabled = false; }
    };
  });
}

/* ============================ шторки ============================ */
function sheet(html, onMount) {
  const bg = document.createElement("div"); bg.className = "sheet-bg";
  if (S.sound !== false) try { sfx("open"); } catch {}
  bg.innerHTML = `<div class="sheet"><div class="grab"></div>${html}</div>`;
  const close = () => bg.remove();
  bg.addEventListener("click", e => { if (e.target === bg) close(); });
  document.body.appendChild(bg);
  onMount && onMount(bg.querySelector(".sheet"), close);
  return close;
}
const mealSelect = (id, val) => `<select class="in" id="${id}">${MEALS.map(m => `<option value="${m.id}" ${m.id === val ? "selected" : ""}>${m.name}</option>`).join("")}</select>`;

function openAddSheet(date = (tab === "diary" ? diaryDate : today()), meal) {
  sheet(`<h2>Добавить еду</h2>
    <div class="tiny muted mb">${humanDate(date)}${meal ? " · " + mealName(meal) : ""}</div>
    <div class="add-opts">
      <button class="add-opt" data-o="photo"><span class="i">${ICONS.camera}</span><b>Фото</b><span>Система распознает блюдо и КБЖУ</span></button>
      <button class="add-opt" data-o="manual"><span class="i">${ICONS.pencil}</span><b>По названию</b><span>Название и граммы — КБЖУ посчитается</span></button>
      <button class="add-opt wide" data-o="scan"><span class="i">${ICONS.barcode}</span><div><b>Штрихкод</b><span>Наведи камеру на упаковку — КБЖУ из общей базы</span></div></button>
    </div>
    ${recentList()}`, (el, close) => {
    el.querySelector("[data-o=photo]").onclick = () => { close(); startPhoto(date, meal); };
    el.querySelector("[data-o=manual]").onclick = () => { close(); openManual({ date, meal }); };
    el.querySelector("[data-o=scan]").onclick = () => { close(); startScan(date, meal); };
    el.querySelectorAll("[data-recent]").forEach(b => b.onclick = () => {
      const e = S.entries.find(x => x.id === b.dataset.recent); close();
      if (!e.grams) return openManual({ date, meal, name: e.name });
      const m = 100 / e.grams;
      openManual({ date, meal, sel: { name: e.name, kcal: r0(e.kcal * m), p: r1(e.p * m), f: r1(e.f * m), c: r1(e.c * m), pc: 0, last: e.grams } });
    });
  });
}
function recentList() {
  const seen = new Set(), out = [];
  for (const e of [...S.entries].sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time))) {
    const k = e.name.toLowerCase(); if (seen.has(k)) continue; seen.add(k); out.push(e); if (out.length >= 12) break;
  }
  if (!out.length) return "";
  return `<div class="win-h mt" style="margin-top:18px">Недавние</div>${out.map(e =>
    `<div class="recent" data-recent="${e.id}"><span class="nm">${esc(e.name)}</span><span class="kc">${e.grams ? r0(e.grams) + " г · " : ""}${r0(e.kcal)} ккал</span><span class="muted">›</span></div>`).join("")}`;
}

/* ---------- ввод по названию и граммам ---------- */
function myFoods(q) {
  // свои прошлые записи как подсказки (на 100 г)
  const words = q.toLowerCase().replace(/ё/g, "е").split(/\s+/).filter(w => w && !/^\d/.test(w));
  if (!words.length) return [];
  const seen = new Set(), out = [];
  for (const e of [...S.entries].reverse()) {
    const k = e.name.toLowerCase().replace(/ё/g, "е");
    if (seen.has(k) || !e.grams) continue; seen.add(k);
    if (!words.every(w => k.split(/\s+/).some(t => t.startsWith(w)))) continue;
    const m = 100 / e.grams;
    out.push({ name: e.name, kcal: r0(e.kcal * m), p: r1(e.p * m), f: r1(e.f * m), c: r1(e.c * m), pc: 0, mine: true, last: e.grams });
    if (out.length >= 3) break;
  }
  return out;
}
function openManual(o = {}) {
  let sel = o.sel || null;
  sheet(`<h2>Что съел?</h2>
    <input class="in" id="m-q" value="${esc(o.sel ? o.sel.name : o.name || "")}" placeholder="Например: гречка 150 г, плов, яблоко" autocomplete="off" autocorrect="off" spellcheck="false">
    <div id="m-sugg"></div>
    <div id="m-body"></div>`, (el, close) => {
    const g = id => el.querySelector("#" + id);
    const date = o.date || today();
    const meal0 = o.meal || mealByTime();

    const showSugg = () => {
      const q = g("m-q").value.trim();
      if (sel && q === sel.name) { g("m-sugg").innerHTML = ""; return; }
      sel = null; g("m-body").innerHTML = "";
      if (q.length < 2) { g("m-sugg").innerHTML = `<div class="tiny muted mt">Начни вводить название — Система подскажет продукт и посчитает КБЖУ по граммам.</div>`; return; }
      const list = [...myFoods(q), ...searchFoods(q, 8)].slice(0, 9);
      g("m-sugg").innerHTML = `${list.map((f, i) => `<div class="recent" data-s="${i}">
          <span class="nm">${esc(f.name)}${f.mine ? ' <span class="tiny" style="color:var(--violet2)">мой</span>' : ""}</span>
          <span class="kc">${f.kcal} ккал/100 г</span><span class="muted">›</span></div>`).join("")}
        <div class="grid2 mt">
          ${API_URL && S.player ? `<button class="btn violet" id="m-ai">🤖 Рассчитать ИИ</button>` : ""}
          <button class="btn ghost" id="m-self" ${API_URL && S.player ? "" : 'style="grid-column:span 2"'}>✎ Ввести КБЖУ самому</button>
        </div>
        <div class="tiny dim mt">${list.length ? "Нет нужного? " : "В базе не нашлось. "}ИИ посчитает по описанию: «гречка с маслом 150 г».</div>`;
      el.querySelectorAll("[data-s]").forEach(r => r.onclick = () => pick(list[+r.dataset.s]));
      sharedSearch(q, foods => {
        if (g("m-q").value.trim() !== q || sel) return;
        const box = document.createElement("div");
        box.innerHTML = foods.map((f, i) => `<div class="recent" data-sh="${i}"><span class="nm">${esc(f.name)} <span class="tiny" style="color:var(--blue2)">${f.source === "off" ? "упаковка" : "база игроков"}</span></span>
          <span class="kc">${r0(f.kcal)} ккал/100 г</span><span class="muted">›</span></div>`).join("");
        box.querySelectorAll("[data-sh]").forEach(r => r.onclick = () => pick({ ...foods[+r.dataset.sh], pc: foods[+r.dataset.sh].serving || 0 }));
        g("m-sugg").prepend(box);
      });
      const ai = g("m-ai"); if (ai) ai.onclick = () => runAI(q);
      g("m-self").onclick = () => selfForm(q);
    };

    const pick = f => {
      sel = f;
      const typed = gramsFromText(g("m-q").value);
      g("m-q").value = f.name; g("m-sugg").innerHTML = "";
      const grams0 = typed || f.last || f.pc || 100;
      g("m-body").innerHTML = `
        <div class="grid2 mt"><label class="f">Сколько грамм<input class="in" id="m-g" inputmode="decimal" value="${grams0}"></label>
          <label class="f">Приём пищи${mealSelect("m-meal", meal0)}</label></div>
        ${f.pc ? `<div class="row mt" style="gap:6px;flex-wrap:wrap">${[1, 2, 3].map(n => `<button class="btn ghost sm" data-pc="${n}">${n} ${f.code ? "уп" : "шт"} · ${f.pc * n} г</button>`).join("")}</div>` : ""}
        <div class="win mt" style="margin-bottom:10px">
          <div class="total-line" style="border:0;margin:0;padding:0"><span class="muted small" id="m-sum"></span><b id="m-tot"></b></div>
          <div class="tiny dim mt" id="m-per">На 100 г: ${f.kcal} ккал · Б ${f.p} · Ж ${f.f} · У ${f.c}</div>
          ${f.code ? `<div class="tiny dim mt">▦ ${esc(f.code)} · ${f.source === "off" ? "Open Food Facts" : f.by ? "добавил " + esc(f.by) : "база игроков"}
            · <a href="#" id="m-rep" style="color:var(--red,#ff5470)">данные неверны?</a></div>` : ""}
        </div>
        <div class="grid2"><button class="btn ghost" id="m-edit">Изменить КБЖУ</button><button class="btn" id="m-save">Записать</button></div>`;
      const upd = () => {
        const k = num(g("m-g").value) / 100;
        g("m-tot").textContent = `${r0(sel.kcal * k)} ккал`;
        g("m-sum").textContent = `Б ${r1(sel.p * k)} · Ж ${r1(sel.f * k)} · У ${r1(sel.c * k)}`;
      };
      g("m-g").oninput = upd; upd();
      el.querySelectorAll("[data-pc]").forEach(b => b.onclick = () => { g("m-g").value = f.pc * +b.dataset.pc; upd(); });
      const rp = g("m-rep"); if (rp) rp.onclick = async ev => {
        ev.preventDefault();
        if (!confirm("Сообщить, что КБЖУ этого продукта неверные? После двух жалоб продукт уберут из базы, и его можно будет добавить заново.")) return;
        try {
          const r = await api("barcode_report", { token: S.player.token, code: f.code });
          if (S.barcodes) delete S.barcodes[f.code]; save();
          if (r.removed) { close(); toast("Продукт убран. Добавь верные данные с этикетки."); openNewProduct(f.code, date, meal0); }
          else toast("Жалоба учтена. Спасибо за честность.");
        } catch (e) { toast(e.message, true); }
      };
      g("m-edit").onclick = () => selfForm(sel.name, { grams: num(g("m-g").value), kcal: sel.kcal, p: sel.p, f: sel.f, c: sel.c });
      g("m-save").onclick = () => {
        const grams = num(g("m-g").value), k = grams / 100;
        if (grams <= 0) return toast("Укажи граммы", true);
        addEntries([{ name: sel.name, grams, kcal: sel.kcal * k, p: sel.p * k, f: sel.f * k, c: sel.c * k, source: sel.code ? "barcode" : "manual" }], date, g("m-meal").value);
        close();
      };
      setTimeout(() => { const i = g("m-g"); if (i) { i.focus(); i.select(); } }, 200);
    };

    const runAI = async q => {
      g("m-sugg").innerHTML = ""; sel = null;
      g("m-body").innerHTML = `<div class="center mt"><span class="spinner"></span> <span class="muted small">Система считает КБЖУ…</span></div>`;
      try {
        const res = normalizeAI(await api("estimate", { token: S.player.token, text: q }));
        if (!res.is_food || !res.items.length) { g("m-body").innerHTML = `<div class="small muted mt">Не похоже на еду. Попробуй описать иначе.</div>`; return; }
        renderAIItems(g("m-body"), res, meal0, { source: "text", date, onCancel: close, onSaved: close });
      } catch (e) {
        g("m-body").innerHTML = `<div class="small bad mt">${esc(e.message)}</div>`;
      }
    };

    const selfForm = (name, v = {}) => {
      g("m-sugg").innerHTML = ""; sel = { name };
      let mode = "100";
      g("m-q").value = name.replace(/\s*\d+(?:[.,]\d+)?\s*(?:грамм|гр|г|мл|ml|g)?(?=\s|$)/i, "").trim() || name;
      sel.name = g("m-q").value;
      g("m-body").innerHTML = `
        <div class="grid2 mt"><label class="f">Вес порции, г<input class="in" id="s-g" inputmode="decimal" value="${v.grams || gramsFromText(name) || ""}"></label>
          <label class="f">Приём пищи${mealSelect("s-meal", meal0)}</label></div>
        <div class="seg mt" id="s-mode"><button data-m="100">На 100 г</button><button data-m="total">На всю порцию</button></div>
        <div class="grid4 mt">
          <label class="f">Ккал<input class="in" id="s-k" inputmode="decimal" value="${v.kcal ?? ""}"></label>
          <label class="f">Белки<input class="in" id="s-p" inputmode="decimal" value="${v.p ?? ""}"></label>
          <label class="f">Жиры<input class="in" id="s-f" inputmode="decimal" value="${v.f ?? ""}"></label>
          <label class="f">Углев.<input class="in" id="s-c" inputmode="decimal" value="${v.c ?? ""}"></label>
        </div>
        <div class="total-line"><span class="muted small" id="s-sum"></span><b id="s-tot">0 ккал</b></div>
        <button class="btn block" id="s-save">Записать</button>`;
      const calc = () => {
        const grams = num(g("s-g").value), f = mode === "100" ? grams / 100 : 1;
        return { grams, kcal: num(g("s-k").value) * f, p: num(g("s-p").value) * f, f: num(g("s-f").value) * f, c: num(g("s-c").value) * f };
      };
      const upd = () => {
        el.querySelectorAll("#s-mode button").forEach(b => b.classList.toggle("on", b.dataset.m === mode));
        const x = calc();
        g("s-tot").textContent = `${r0(x.kcal)} ккал`;
        g("s-sum").textContent = mode === "100" && !x.grams ? "Укажи вес порции" : `Б ${r1(x.p)} · Ж ${r1(x.f)} · У ${r1(x.c)}`;
      };
      el.querySelectorAll("#s-mode button").forEach(b => b.onclick = () => { mode = b.dataset.m; upd(); });
      g("m-body").querySelectorAll("input").forEach(i => i.oninput = upd);
      upd();
      g("s-save").onclick = () => {
        const nm = g("m-q").value.trim(), x = calc();
        if (!nm) return toast("Введи название", true);
        if (mode === "100" && !x.grams) return toast("Укажи вес порции", true);
        if (x.kcal <= 0) return toast("Укажи калории", true);
        addEntries([{ name: nm, grams: x.grams, kcal: x.kcal, p: x.p, f: x.f, c: x.c, source: "manual" }], date, g("s-meal").value);
        close();
      };
    };

    g("m-q").oninput = showSugg;
    if (o.sel) pick(o.sel); else { showSugg(); setTimeout(() => g("m-q").focus(), 250); }
  });
}

/* ---------- штрихкоды ---------- */
const sharedCache = {};
let sharedT = 0;
function sharedSearch(q, cb) {
  clearTimeout(sharedT);
  if (!API_URL || !S.player || q.length < 3) return;
  const key = q.toLowerCase().replace(/\s*\d+\s*(г|гр|грамм|мл)?\s*$/i, "").trim();
  if (key.length < 3) return;
  const done = foods => foods && foods.length && cb(foods);
  if (sharedCache[key]) return done(sharedCache[key]);
  sharedT = setTimeout(async () => {
    try { const r = await api("foods_search", { q: key }); sharedCache[key] = r.foods || []; done(sharedCache[key]); } catch { /* офлайн */ }
  }, 450);
}
function needServer() {
  if (API_URL && S.player) return false;
  system({ tag: "СИСТЕМА", head: "Нужен сервер", body: "Общая база продуктов работает через сервер. Войди в рейтинг в разделе «Игрок».", btn: "Понятно" });
  return true;
}
function startScan(date, meal) {
  if (needServer()) return;
  loadScanner().then(m => m.openScanner({ esc, onCode: c => lookupBarcode(c, date, meal), onManual: () => askCode(date, meal) }))
    .catch(e => toast(e.message, true));
}
function askCode(date, meal) {
  sheet(`<h2>Штрихкод</h2><div class="small mb">Введи цифры под штрихкодом (8–13 цифр).</div>
    <input class="in" id="bc-in" inputmode="numeric" placeholder="4600000000000" autocomplete="off">
    <button class="btn block mt" id="bc-go">Найти</button>`, (el, close) => {
    const go = () => { const c = el.querySelector("#bc-in").value.replace(/\D/g, ""); if (c.length < 8) return toast("Слишком короткий код", true); close(); lookupBarcode(c, date, meal); };
    el.querySelector("#bc-go").onclick = go;
    el.querySelector("#bc-in").onkeydown = e => { if (e.key === "Enter") go(); };
    setTimeout(() => el.querySelector("#bc-in").focus(), 250);
  });
}
const prodSel = pr => ({ name: pr.brand && !pr.name.toLowerCase().includes(pr.brand.toLowerCase()) ? `${pr.name} ${pr.brand}` : pr.name,
  kcal: r0(pr.kcal), p: r1(pr.p), f: r1(pr.f), c: r1(pr.c), pc: pr.serving || 0, code: pr.code, source: pr.source, by: pr.by });
async function lookupBarcode(code, date, meal) {
  S.barcodes = S.barcodes || {};
  let closeWait = () => {};
  sheet(`<div class="center"><div class="tag-sys">▦ ${esc(code)}</div><div class="mt"><span class="spinner"></span></div><div class="small muted mt">Система ищет продукт…</div></div>`, (el, close) => { closeWait = close; });
  let pr = null, offline = false;
  try { pr = (await api("barcode", { token: S.player.token, code })).product; }
  catch { offline = true; pr = S.barcodes[code] || null; }
  closeWait();
  if (pr) {
    S.barcodes[code] = pr; save();
    if (S.sound !== false) sfx("tap");
    openManual({ date, meal, sel: prodSel(pr) });
    return;
  }
  if (offline) return toast("Нет связи с сервером. Попробуй позже или введи вручную.", true);
  openNewProduct(code, date, meal);
}
function openNewProduct(code, date, meal) {
  sheet(`<div class="tag-sys">НОВЫЙ ПРОДУКТ</div>
    <h2 style="margin-top:6px">Его ещё нет в базе</h2>
    <div class="small mb">Добавь его — и все игроки смогут сканировать этот продукт. Награда: <b style="color:var(--gold,#ffd25a)">+15 XP</b>.</div>
    <button class="btn violet block" id="np-photo">📷 Сфоткать этикетку — ИИ заполнит</button>
    <div class="tiny dim mt">Сфоткай таблицу «Пищевая ценность на 100 г» крупно и ровно.</div>
    <label class="f mt">Название<input class="in" id="np-n" placeholder="Например: йогурт клубничный" autocomplete="off"></label>
    <label class="f">Бренд (если есть)<input class="in" id="np-b" autocomplete="off"></label>
    <div class="tiny muted mt">На 100 г, как на этикетке:</div>
    <div class="grid4 mt">
      <label class="f">Ккал<input class="in" id="np-k" inputmode="decimal"></label>
      <label class="f">Белки<input class="in" id="np-p" inputmode="decimal"></label>
      <label class="f">Жиры<input class="in" id="np-f" inputmode="decimal"></label>
      <label class="f">Углев.<input class="in" id="np-c" inputmode="decimal"></label>
    </div>
    <label class="f">Вес упаковки, г (если указан)<input class="in" id="np-s" inputmode="decimal"></label>
    <div class="tiny dim">▦ ${esc(code)}</div>
    <button class="btn-epic block mt" id="np-save">Добавить в общую базу</button>`, (el, close) => {
    const g = id => el.querySelector("#" + id);
    const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*"; inp.className = "hidden"; el.appendChild(inp);
    g("np-photo").onclick = () => { inp.value = ""; inp.click(); };
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      const btn = g("np-photo"); btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> ИИ читает этикетку…`;
      try {
        const img = await loadImage(f);
        const r = await api("barcode_label", { token: S.player.token, image: drawScaled(img, 1400, 0.85).split(",")[1] });
        if (!r.found) toast("Не удалось прочитать таблицу. Попробуй крупнее или введи сам.", true);
        else {
          if (r.name && !/без назв|неизвест/i.test(r.name) && !g("np-n").value) g("np-n").value = r.name;
          g("np-k").value = r0(r.kcal); g("np-p").value = r1(r.protein); g("np-f").value = r1(r.fat); g("np-c").value = r1(r.carbs);
          if (r.serving > 0) g("np-s").value = r0(r.serving);
          toast("Готово. Сверь цифры с этикеткой.");
        }
      } catch (e) { toast(e.message, true); }
      btn.disabled = false; btn.textContent = "📷 Сфоткать этикетку — ИИ заполнит";
    };
    g("np-save").onclick = async () => {
      const pr = { code, name: g("np-n").value.trim(), brand: g("np-b").value.trim(), kcal: num(g("np-k").value), p: num(g("np-p").value),
        f: num(g("np-f").value), c: num(g("np-c").value), serving: num(g("np-s").value) || null };
      if (pr.name.length < 2) return toast("Укажи название", true);
      if (!(pr.kcal > 0) && !(pr.p + pr.f + pr.c > 0)) return toast("Укажи КБЖУ с этикетки", true);
      const btn = g("np-save"); btn.disabled = true;
      try {
        const r = await api("barcode_add", { token: S.player.token, ...pr });
        S.barcodes = S.barcodes || {}; S.barcodes[code] = { ...pr, source: "player", by: S.player.name };
        if (r.first) {
          S.mapped = (S.mapped || 0) + 1;
          const todays = S.adj.filter(a => a.date === today() && a.why === "Продукт в общую базу").length;
          if (todays < 5) S.adj.push({ date: today(), xp: 15, why: "Продукт в общую базу" });
        }
        save(); close();
        if (r.first) system({ tag: "ОБЩАЯ БАЗА", head: "Продукт добавлен", body: `«${pr.name}» теперь знают все игроки.\n+15 XP`, btn: "Дальше" });
        openManual({ date, meal, sel: prodSel({ ...pr, source: "player", by: S.player.name }) });
      } catch (e) { toast(e.message, true); btn.disabled = false; }
    };
  });
}

function addEntries(items, date, meal, thumb) {
  const time = nowTime();
  for (const it of items) S.entries.push({
    id: uid(), date, time, meal, name: it.name, grams: r0(it.grams || 0),
    kcal: r0(it.kcal), p: r1(it.p), f: r1(it.f), c: r1(it.c), source: it.source || "manual", thumb: thumb || null,
  });
  save();
  const k = items.reduce((a, i) => a + i.kcal, 0);
  toast(`+${r0(k)} ккал · ${mealName(meal)}`);
  if (S.sound !== false) try { sfx("add"); } catch {}
  render();
}

/* ---------- редактирование записи ---------- */
function openEdit(id) {
  const e = S.entries.find(x => x.id === id); if (!e) return;
  const base = { grams: e.grams, kcal: e.kcal, p: e.p, f: e.f, c: e.c };
  sheet(`<h2>Запись</h2>
    ${e.thumb ? `<img class="photo-prev mb" src="${e.thumb}" style="max-height:140px">` : ""}
    <label class="f">Название<input class="in" id="e-name" value="${esc(e.name)}"></label>
    <div class="grid2 mt"><label class="f">Вес, г<input class="in" id="e-g" inputmode="decimal" value="${e.grams || ""}"></label>
      <label class="f">Приём пищи${mealSelect("e-meal", e.meal)}</label></div>
    <div class="grid4 mt">
      <label class="f">Ккал<input class="in" id="e-k" inputmode="decimal" value="${e.kcal}"></label>
      <label class="f">Белки<input class="in" id="e-p" inputmode="decimal" value="${e.p}"></label>
      <label class="f">Жиры<input class="in" id="e-f" inputmode="decimal" value="${e.f}"></label>
      <label class="f">Углев.<input class="in" id="e-c" inputmode="decimal" value="${e.c}"></label>
    </div>
    <div class="tiny muted mt">При изменении веса калории и БЖУ пересчитываются пропорционально.</div>
    <div class="grid2 mt"><button class="btn danger" id="e-del">Удалить</button><button class="btn" id="e-save">Сохранить</button></div>`, (el, close) => {
    const g = id => el.querySelector("#" + id);
    g("e-g").oninput = () => {
      const ng = num(g("e-g").value); if (!base.grams || !ng) return;
      const f = ng / base.grams;
      g("e-k").value = r0(base.kcal * f); g("e-p").value = r1(base.p * f); g("e-f").value = r1(base.f * f); g("e-c").value = r1(base.c * f);
    };
    g("e-save").onclick = () => {
      Object.assign(e, { name: g("e-name").value.trim() || e.name, grams: r0(num(g("e-g").value)), meal: g("e-meal").value,
        kcal: r0(num(g("e-k").value)), p: r1(num(g("e-p").value)), f: r1(num(g("e-f").value)), c: r1(num(g("e-c").value)) });
      save(); close(); render(); toast("Сохранено");
    };
    g("e-del").onclick = () => {
      if (!confirm(`Удалить «${e.name}»?`)) return;
      S.entries = S.entries.filter(x => x.id !== id); save(); close(); render(); toast("Удалено");
    };
  });
}

/* ---------- фото ---------- */
function pickPhoto() {
  return new Promise(res => {
    const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*";
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return res(null);
      try { const img = await loadImage(f); res(drawScaled(img, 1024, 0.8).split(",")[1]); } catch { toast("Не удалось открыть фото", true); res(null); }
    };
    inp.click();
  });
}
initSkills({ S: () => S, save, api, sheet, system, toast, esc, today, addDays, parseD, humanDate, render, num, r0, pickPhoto, API_URL, postEvent, renderWorld });
initWorld({ S: () => S, save, api, sheet, system, toast, esc, today, addDays, render, postEvent });
initGates({ S: () => S, save, api, esc, today, addDays, parseD, system, toast, render, postEvent, sheet });
initExams({ S: () => S, save, today, addDays, parseD, system, postEvent, render, esc, sheet });

const fileInput = document.createElement("input");
fileInput.type = "file"; fileInput.accept = "image/*"; fileInput.className = "hidden";
document.body.appendChild(fileInput);
let photoCtx = null;
function startPhoto(date, meal) {
  if (!API_URL || !S.player) {
    system({ tag: "СИСТЕМА", head: "Распознавание недоступно", body: API_URL ? "Войди в рейтинг в Настройках — распознавание фото работает через сервер." : "Сервер ещё не подключён. Пока используй ручной ввод.", btn: "Понятно" });
    return;
  }
  photoCtx = { date, meal: meal || mealByTime() };
  fileInput.value = ""; fileInput.click();
}
fileInput.onchange = async () => {
  const f = fileInput.files[0]; if (!f || !photoCtx) return;
  try {
    const img = await loadImage(f);
    const full = drawScaled(img, 1024, 0.8);
    const thumb = drawScaled(img, 160, 0.6);
    openPhotoSheet(full, thumb, photoCtx);
  } catch { toast("Не удалось открыть фото", true); }
};
function loadImage(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(); };
    img.src = url;
  });
}
function drawScaled(img, maxSide, q) {
  const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", q);
}

function normalizeAI(d) {
  d.items = (Array.isArray(d.items) ? d.items : []).map(it => ({
    name: String(it.name || "продукт"),
    grams: Math.max(0, r0(+it.grams || 0)), kcal: Math.max(0, r0(+it.kcal || 0)),
    protein: Math.max(0, r1(+it.protein || 0)), fat: Math.max(0, r1(+it.fat || 0)), carbs: Math.max(0, r1(+it.carbs || 0)),
    confidence: ["high", "medium", "low"].includes(it.confidence) ? it.confidence : "medium",
  }));
  return d;
}
function renderAIItems(box0, res, meal, o) {
  const items = res.items.map(it => ({ ...it, on: true, base: { ...it } }));
  const conf = { high: "точно", medium: "примерно", low: "неуверенно" };
  box0.innerHTML = `
    <div class="win mt"><div class="win-h">${esc(res.summary || "Результат")}</div>
      ${res.notes ? `<div class="tiny muted mb">${esc(res.notes)}</div>` : ""}
      <div class="ai-items">${items.map((it, i) => `<div class="item" data-i="${i}">
        <div class="top"><input type="checkbox" checked data-on="${i}"><input class="nm-in" data-name="${i}" value="${esc(it.name)}">
          <span class="conf ${it.confidence}">${conf[it.confidence]}</span></div>
        <div class="nums">
          <label>Вес, г<input inputmode="decimal" data-g="${i}" value="${it.grams}"></label>
          <label>Ккал<input inputmode="decimal" data-k="${i}" value="${it.kcal}"></label>
          <label>Б<input inputmode="decimal" data-p="${i}" value="${it.protein}"></label>
          <label>Ж<input inputmode="decimal" data-f="${i}" value="${it.fat}"></label>
          <label>У<input inputmode="decimal" data-c="${i}" value="${it.carbs}"></label>
        </div></div>`).join("")}</div>
      <div class="total-line"><span class="muted small ai-sum"></span><b class="ai-tot"></b></div>
      <div class="tiny dim">Подправь вес, если знаешь точнее — КБЖУ пересчитаются.</div>
    </div>
    <label class="f">Приём пищи${mealSelect("ai-meal", meal)}</label>
    <div class="grid2 mt"><button class="btn ghost ai-cancel">Отмена</button><button class="btn ai-save">Записать</button></div>`;
  const q = sel => box0.querySelector(sel);
  const tot = () => {
    const s2 = items.filter(i => i.on).reduce((a, i) => ({ k: a.k + i.kcal, p: a.p + i.protein, f: a.f + i.fat, c: a.c + i.carbs }), { k: 0, p: 0, f: 0, c: 0 });
    q(".ai-tot").textContent = `${r0(s2.k)} ккал`; q(".ai-sum").textContent = `Б ${r1(s2.p)} · Ж ${r1(s2.f)} · У ${r1(s2.c)}`;
  };
  const box = q(".ai-items");
  box.addEventListener("input", ev => {
    const t = ev.target, d = t.dataset;
    if (d.on !== undefined) { items[+d.on].on = t.checked; t.closest(".item").classList.toggle("off", !t.checked); }
    else if (d.name !== undefined) items[+d.name].name = t.value;
    else if (d.g !== undefined) {
      const it = items[+d.g], ng = num(t.value), b = it.base; it.grams = ng;
      if (b.grams > 0) {
        const f = ng / b.grams;
        it.kcal = r0(b.kcal * f); it.protein = r1(b.protein * f); it.fat = r1(b.fat * f); it.carbs = r1(b.carbs * f);
        const row = t.closest(".item");
        row.querySelector("[data-k]").value = it.kcal; row.querySelector("[data-p]").value = it.protein;
        row.querySelector("[data-f]").value = it.fat; row.querySelector("[data-c]").value = it.carbs;
      }
    }
    else if (d.k !== undefined) items[+d.k].kcal = num(t.value);
    else if (d.p !== undefined) items[+d.p].protein = num(t.value);
    else if (d.f !== undefined) items[+d.f].fat = num(t.value);
    else if (d.c !== undefined) items[+d.c].carbs = num(t.value);
    tot();
  });
  box.addEventListener("change", ev => { if (ev.target.dataset.on !== undefined) tot(); });
  tot();
  q(".ai-cancel").onclick = o.onCancel;
  q(".ai-save").onclick = () => {
    const on = items.filter(i => i.on && i.kcal > 0);
    if (!on.length) return toast("Ничего не выбрано", true);
    addEntries(on.map(i => ({ name: i.name.trim() || "продукт", grams: i.grams, kcal: i.kcal, p: i.protein, f: i.fat, c: i.carbs, source: o.source })),
      o.date, q("#ai-meal").value, o.thumb);
    o.onSaved();
  };
}
function openPhotoSheet(dataUrl, thumb, ctx) {
  sheet(`<h2>Анализ еды</h2>
    <div class="scan" id="p-scan"><img class="photo-prev" src="${dataUrl}"></div>
    <div id="p-body">
      <label class="f mt">Уточнение (необязательно)<textarea class="in" id="p-hint" rows="2" placeholder="Например: плов, порция ~300 г, на сливочном масле"></textarea></label>
      <label class="f mt">Приём пищи${mealSelect("p-meal", ctx.meal)}</label>
      <button class="btn block mt" id="p-go">Анализировать</button>
    </div>`, (el, close) => {
    const g = id => el.querySelector("#" + id);
    el.querySelector("#p-scan").classList.remove("scan");
    const go = async () => {
      const hint = g("p-hint") ? g("p-hint").value : "";
      const meal = g("p-meal").value;
      el.querySelector("#p-scan").classList.add("scan");
      g("p-body").innerHTML = `<div class="center mt"><span class="spinner"></span> <span class="muted small">Система анализирует добычу…</span></div>`;
      try {
        const res = normalizeAI(await api("analyze", { token: S.player.token, image: dataUrl.split(",")[1], hint }));
        if (res.photos_left !== undefined && res.photos_left <= 3) toast(`Осталось фото на сегодня: ${res.photos_left}`);
        el.querySelector("#p-scan").classList.remove("scan");
        if (!res.is_food || !res.items.length) {
          g("p-body").innerHTML = `<div class="win mt"><div class="win-h">Результат</div><div class="small">Еда на фото не найдена.</div></div>
            <button class="btn block ghost" id="p-close">Закрыть</button>`;
          g("p-close").onclick = close; return;
        }
        showResult(res, meal);
      } catch (e) {
        el.querySelector("#p-scan").classList.remove("scan");
        g("p-body").innerHTML = `<div class="win mt" style="border-color:rgba(255,77,109,.5)"><div class="win-h bad">Ошибка</div><div class="small">${esc(e.message || e)}</div></div>
          <div class="grid2"><button class="btn ghost" id="p-close">Закрыть</button><button class="btn" id="p-retry">Повторить</button></div>`;
        g("p-close").onclick = close;
        g("p-retry").onclick = () => { g("p-body").innerHTML = `<input type="hidden" id="p-hint" value="${esc(hint)}"><select id="p-meal" class="hidden"><option value="${meal}" selected></option></select>`; go(); };
      }
    };
    const showResult = (res, meal) => {
      renderAIItems(g("p-body"), res, meal, { source: "photo", thumb, date: ctx.date, onCancel: close, onSaved: close });
    };
    g("p-go").onclick = go;
  });
}

/* ============================ запуск ============================ */
// экран входа — один раз за запуск; окна Системы ждут, пока игрок войдёт
if (!sessionStorage.getItem("arise-intro")) {
  sessionStorage.setItem("arise-intro", "1");
  introOn = true;
  const P0 = S.profile ? computeProgress() : null;
  showIntro({ first: !S.profile, name: S.profile ? esc(S.profile.name) : "", level: P0 ? P0.level : 1, rank: P0 ? rankLabel(P0.rank, P0.level) : "",
    rankName: "", sound: S.sound !== false })
    .then(() => { introOn = false; if (!sysOpen) setTimeout(nextSystem, 350); });
}
render();
if (S.player) setTimeout(syncNow, 1500);
// новый день — пересчитать при возвращении в приложение
document.addEventListener("visibilitychange", () => { if (!document.hidden && S.profile && !document.querySelector(".sheet-bg")) render(); });
if ("serviceWorker" in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).then(r => r.update()).catch(() => {});
  // новая версия приложения установилась — один раз перезагружаемся, чтобы сразу её показать
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloaded || document.querySelector(".sheet-bg, .iv-ov, .sys-bg")) return;
    reloaded = true; location.reload();
  });
}
