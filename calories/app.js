// ARISE — учёт калорий в стиле «Системы». Данные на устройстве + синхронизация с сервером (рейтинг, резервная копия).
import { API_URL } from "./config.js";
const STORE_KEY = "arise-calories-v1";
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
    entries: [], weights: [], workouts: {}, title: null,
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
    const t = S.title && ACH.find(a => a.id === S.title);
    const backup = Object.assign({}, S, { player: null, entries: S.entries.map(e => Object.assign({}, e, { thumb: null })) });
    await api("sync", {
      token: S.player.token,
      stats: { level: P.level, rank: P.rank, xp: P.xp, streak: P.streak, best_streak: P.longest, perfect_days: P.perfectDays,
        workouts: P.workoutDays, title: t ? t.n : null, today_quests: d ? d.doneCount : 0, today_total: QUESTS.length, stats_date: today() },
      save: backup,
    });
  } catch (e) { /* офлайн — попробуем позже */ }
  finally { syncing = false; }
}

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
const exTarget = (ex, lvl) => { const v = Math.min(ex.max, ex.base + (lvl - 1) * ex.step); return ex.id === "run" ? r1(v) : Math.round(v); };
const wDay = d => S.workouts[d] || {};
function workoutDone(d, lvl) { const w = wDay(d); return EX.every(ex => (w[ex.id] || 0) >= exTarget(ex, lvl)); }

/* ============================ прогресс «Системы» ============================ */
const XP = { entry: 5, entryCap: 10, log: 30, protein: 40, norm: 60, workout: 80, allBonus: 50, penMiss: -30, penOver: -20 };
const QUESTS = [
  { id: "workout", name: "Тренировка Системы", xp: XP.workout },
  { id: "log", name: "Записать 3 приёма пищи", xp: XP.log },
  { id: "protein", name: "Добрать норму белка", xp: XP.protein },
  { id: "norm", name: "Уложиться в норму калорий", xp: XP.norm },
];
const xpNeed = lvl => 100 + 25 * (lvl - 1);
const RANKS = [["E", 1], ["D", 10], ["C", 20], ["B", 35], ["A", 50], ["S", 70]];
const rankOf = lvl => RANKS.filter(r => lvl >= r[1]).pop()[0];
const RANK_NAMES = { E: "Охотник ранга E", D: "Охотник ранга D", C: "Охотник ранга C", B: "Охотник ранга B", A: "Охотник ранга A", S: "Охотник ранга S" };

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
  const w = wDay(d), parts = EX.filter(ex => (w[ex.id] || 0) >= exTarget(ex, lvl)).length;
  return {
    workout: { done: workoutDone(d, lvl), prog: `${parts}/${EX.length} упражнений` },
    log: { done: s.meals >= 3, prog: `${Math.min(s.meals, 3)}/3 приёма` },
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
  let lvl = 1, lvlRest = 0;
  const days = {};
  const first = [start, ...Object.keys(byDate), ...Object.keys(S.workouts)].sort()[0];
  for (let d = first; d <= td; d = addDays(d, 1)) {
    const s = daySums(d);
    photos += s.photos;
    const dayLvl = lvl;
    const q = evalQuests(s, t, d, dayLvl);
    const closed = d < td;
    let dx = XP.entry * Math.min(s.count, XP.entryCap);
    const doneIds = QUESTS.filter(x => q[x.id].done).map(x => x.id);
    for (const id of doneIds) dx += QUESTS.find(x => x.id === id).xp;
    const all = doneIds.length === QUESTS.length;
    if (all) { dx += XP.allBonus; perfectDays++; }
    if (q.protein.done) proteinDays++;
    if (q.workout.done) workoutDays++;
    if (q.norm.done) normDays++;
    let penalty = null;
    if (closed && d >= start) {
      if (s.count === 0 && !q.workout.done) { penalty = { xp: XP.penMiss, why: "День пропущен — ни одной записи" }; }
      else if (s.kcal > t.kcal * 1.15) { penalty = { xp: XP.penOver, why: `Превышение нормы: ${r0(s.kcal)} из ${t.kcal} ккал` }; }
    }
    if (penalty) dx += penalty.xp;
    xp = Math.max(0, xp + dx);
    lvl = 1; lvlRest = xp; while (lvlRest >= xpNeed(lvl)) { lvlRest -= xpNeed(lvl); lvl++; }
    const active = s.count > 0 || q.workout.done;
    if (active) { cur++; longest = Math.max(longest, cur); } else if (closed) cur = 0;
    days[d] = { s, q, xp: dx, penalty, all, lvl: dayLvl, doneCount: doneIds.length };
  }
  let level = 1, rest = xp;
  while (rest >= xpNeed(level)) { rest -= xpNeed(level); level++; }
  const rank = rankOf(level);
  const stats = {
    str: 10 + workoutDays,
    hp: 10 + proteinDays,
    vit: 10 + longest,
    dis: 10 + normDays,
    per: 10 + Math.floor(photos / 3),
  };
  return { xp, level, into: rest, need: xpNeed(level), rank, stats, streak: cur, longest, proteinDays, normDays, perfectDays, photos, entries, days, weights: S.weights.length, workoutDays };
}

/* ============================ достижения ============================ */
const ACH = [
  { id: "awaken", ic: "⚡", n: "Пробуждённый", d: "Сделать первую запись", ok: P => P.entries >= 1 },
  { id: "eye", ic: "👁", n: "Око Системы", d: "Распознать еду по фото", ok: P => P.photos >= 1 },
  { id: "train1", ic: "🏋", n: "Первая тренировка", d: "Выполнить тренировку Системы", ok: P => P.workoutDays >= 1 },
  { id: "train10", ic: "⚔", n: "Закалённый", d: "10 тренировок Системы", ok: P => P.workoutDays >= 10 },
  { id: "train50", ic: "🛡", n: "Сила Монарха", d: "50 тренировок Системы", ok: P => P.workoutDays >= 50 },
  { id: "perfect1", ic: "✦", n: "Идеальный день", d: "Выполнить все квесты за день", ok: P => P.perfectDays >= 1 },
  { id: "streak3", ic: "🔥", n: "Начало пути", d: "3 дня подряд с записями", ok: P => P.longest >= 3 },
  { id: "streak7", ic: "🗡", n: "Неделя без пропусков", d: "7 дней подряд с записями", ok: P => P.longest >= 7 },
  { id: "protein10", ic: "💪", n: "Железное тело", d: "10 дней с нормой белка", ok: P => P.proteinDays >= 10 },
  { id: "norm14", ic: "⚖", n: "Мастер баланса", d: "14 дней в норме калорий", ok: P => P.normDays >= 14 },
  { id: "perfect7", ic: "♛", n: "Безупречный", d: "7 идеальных дней", ok: P => P.perfectDays >= 7 },
  { id: "eye50", ic: "◎", n: "Всевидящий", d: "50 распознанных фото", ok: P => P.photos >= 50 },
  { id: "scribe", ic: "📜", n: "Летописец", d: "100 записей", ok: P => P.entries >= 100 },
  { id: "streak30", ic: "⛓", n: "Несгибаемый", d: "30 дней подряд с записями", ok: P => P.longest >= 30 },
  { id: "weigh", ic: "⚙", n: "Взгляд в зеркало", d: "Записать вес 5 раз", ok: P => P.weights >= 5 },
  { id: "rankD", ic: "D", n: "Охотник ранга D", d: "Достичь 10 уровня", ok: P => P.level >= 10 },
  { id: "rankC", ic: "C", n: "Охотник ранга C", d: "Достичь 20 уровня", ok: P => P.level >= 20 },
  { id: "rankB", ic: "B", n: "Охотник ранга B", d: "Достичь 35 уровня", ok: P => P.level >= 35 },
  { id: "rankA", ic: "A", n: "Охотник ранга A", d: "Достичь 50 уровня", ok: P => P.level >= 50 },
  { id: "rankS", ic: "S", n: "Охотник ранга S", d: "Достичь 70 уровня", ok: P => P.level >= 70 },
  { id: "monarch", ic: "☠", n: "Монарх Теней", d: "30 идеальных дней", ok: P => P.perfectDays >= 30 },
];

/* ============================ окна «Системы» ============================ */
const sysQueue = [];
let sysOpen = false;
function system(o) { sysQueue.push(o); if (!sysOpen) nextSystem(); }
function nextSystem() {
  const o = sysQueue.shift(); if (!o) { sysOpen = false; return; }
  sysOpen = true;
  const bg = document.createElement("div");
  bg.className = "sys-bg";
  bg.innerHTML = `<div class="sys ${o.kind || ""}">
    <div class="tag">${esc(o.tag || "СИСТЕМА")}</div>
    <div class="head">${esc(o.head)}</div>
    ${o.body ? `<div class="body">${esc(o.body)}</div>` : ""}
    <button class="btn ${o.kind === "achv" ? "violet" : o.kind === "penalty" ? "danger" : ""}">${esc(o.btn || "Принять")}</button>
  </div>`;
  bg.querySelector("button").onclick = () => { bg.remove(); nextSystem(); };
  document.body.appendChild(bg);
}

function checkEvents(P) {
  const seen = S.seen; const td = today(); let changed = false;
  const day = P.days[td];
  if (day) {
    const got = seen.quests[td] || [];
    for (const q of QUESTS) if (day.q[q.id].done && !got.includes(q.id)) {
      got.push(q.id); changed = true;
      system({ tag: "КВЕСТ ВЫПОЛНЕН", head: q.name, body: `Награда: +${q.xp} XP` });
    }
    if (day.all && !got.includes("all")) {
      got.push("all"); changed = true;
      system({ tag: "ЕЖЕДНЕВНЫЙ КВЕСТ", head: "Все задания выполнены", body: `Бонус: +${XP.allBonus} XP\nСистема довольна вашей дисциплиной.` });
    }
    seen.quests[td] = got;
    // чистим старые отметки
    for (const k of Object.keys(seen.quests)) if (k < addDays(td, -14)) delete seen.quests[k];
  }
  for (let i = 1; i <= 3; i++) {
    const d = addDays(td, -i), dd = P.days[d];
    if (dd && dd.penalty && !seen.penalties.includes(d)) {
      seen.penalties.push(d); changed = true;
      system({ kind: "penalty", tag: "ШТРАФ", head: humanDate(d), body: `${dd.penalty.why}\n${dd.penalty.xp} XP`, btn: "Понятно" });
    }
  }
  seen.penalties = seen.penalties.filter(d => d >= addDays(td, -10));
  if (P.level > seen.level) {
    const oldRank = rankOf(seen.level);
    system({ kind: "levelup", tag: "УРОВЕНЬ ПОВЫШЕН", head: `LV. ${P.level}`,
      body: P.rank !== oldRank ? `Новый ранг: ${P.rank}\nВы стали сильнее.` : "Вы стали сильнее." });
    seen.level = P.level; changed = true;
  } else if (P.level < seen.level) { seen.level = P.level; changed = true; }
  for (const a of ACH) if (a.ok(P) && !seen.ach.includes(a.id)) {
    seen.ach.push(a.id); changed = true;
    system({ kind: "achv", tag: "ДОСТИЖЕНИЕ", head: a.n, body: `${a.d}\nПолучен титул «${a.n}».` });
  }
  if (changed) save();
}

function syncSeenSilently() {
  const P = computeProgress();
  S.seen.level = P.level;
  S.seen.ach = ACH.filter(a => a.ok(P)).map(a => a.id);
  S.seen.penalties = Object.keys(P.days).filter(d => P.days[d].penalty);
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
const ICONS = {
  status: '<svg viewBox="0 0 24 24"><path d="M12 2l3 6 6 1-4.5 4.5L18 20l-6-3-6 3 1.5-6.5L3 9l6-1z"/></svg>',
  diary: '<svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
  hunter: '<svg viewBox="0 0 24 24"><path d="M14.5 3.5l6 6L9 21l-6-6z"/><path d="M3 21l3-3M13 5l6 6"/></svg>',
  settings: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  rating: '<svg viewBox="0 0 24 24"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0z"/><path d="M7 6H4a3 3 0 003 4M17 6h3a3 3 0 01-3 4"/></svg>',
};
function renderTabbar() {
  let bar = document.querySelector(".tabbar");
  if (!S.profile) { bar && bar.remove(); return; }
  if (!bar) { bar = document.createElement("nav"); bar.className = "tabbar"; document.body.appendChild(bar); }
  const b = (id, label) => `<button class="tab ${tab === id || (id === "hunter" && tab === "settings") ? "on" : ""}" data-tab="${id}">${ICONS[id]}<span>${label}</span></button>`;
  bar.innerHTML = `<div class="in">${b("status", "Статус")}${b("diary", "Дневник")}
    <button class="tab-add" data-act="add" aria-label="Добавить">${ICONS.plus}</button>
    ${b("rating", "Рейтинг")}${b("hunter", "Охотник")}</div>`;
  bar.querySelectorAll("[data-tab]").forEach(x => x.onclick = () => { tab = x.dataset.tab; render(); window.scrollTo(0, 0); });
  bar.querySelector("[data-act=add]").onclick = () => openAddSheet();
}

function render() {
  if (!S.profile) { renderOnboarding(); renderTabbar(); return; }
  const P = computeProgress();
  if (tab === "status") renderStatus(P);
  else if (tab === "diary") renderDiary(P);
  else if (tab === "hunter") renderHunter(P);
  else if (tab === "rating") renderRating(P);
  else renderSettings();
  renderTabbar();
  checkEvents(P);
}

/* ============================ общие куски ============================ */
function hunterCard(P, full) {
  const t = S.title && ACH.find(a => a.id === S.title);
  return `<div class="win">
    <div class="hunter">
      <div class="rank-badge rank-${P.rank}"><span>${P.rank}</span></div>
      <div class="grow">
        <div class="name">${esc(S.profile.name)}</div>
        <div class="title">${t ? "«" + esc(t.n) + "»" : esc(RANK_NAMES[P.rank])}</div>
        <div class="row mt" style="margin-top:8px"><span class="lvl">LV. ${P.level}</span>
          <span class="tiny muted" style="margin-left:auto">${P.into} / ${P.need} XP</span></div>
        <div class="bar" style="margin-top:5px"><i style="width:${(P.into / P.need * 100).toFixed(1)}%"></i></div>
      </div>
    </div>
    ${full ? `<div class="grid3 mt center small">
      <div><div class="sys-font" style="font-size:18px;color:#fff">${P.streak}</div><div class="muted tiny">серия дней</div></div>
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
      <stop offset="0" stop-color="#5ff0ff"/><stop offset="1" stop-color="#3a7bff"/></linearGradient></defs>
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
      <div class="xp">+${q.xp}</div></div>`;
  }).join("");
  return `<div class="win"><div class="win-h">Ежедневный квест<span class="right">бонус за все: +${XP.allBonus} XP</span></div>
    <div class="tiny muted mb">[Подготовка к укреплению тела]</div>${rows}</div>`;
}

/* ============================ экран: Статус ============================ */
function renderStatus(P) {
  const t = targets(), td = today(), d = P.days[td], s = d.s;
  const y = P.days[addDays(td, -1)];
  $app.innerHTML = `
    <div class="screen-title"><h1>Статус</h1><span class="sub">${humanDate(td)}</span></div>
    ${hunterCard(P)}
    <div class="win">
      <div class="win-h">Энергия дня<span class="right">норма ${t.kcal} ккал</span></div>
      <div class="ring-wrap">${ring(s.kcal, t.kcal)}
        <div class="kcal-side">
          <div class="kv"><span class="muted">Съедено</span><b>${r0(s.kcal)}</b></div>
          <div class="kv"><span class="muted">Норма</span><b>${t.kcal}</b></div>
          <div class="kv"><span class="muted">Записей</span><b>${s.count}</b></div>
          <div class="kv"><span class="muted">XP за день</span><b class="${d.xp < 0 ? "bad" : ""}">${d.xp >= 0 ? "+" : ""}${d.xp}</b></div>
        </div>
      </div>
      <div class="macros">${macroBar("Белки", s.p, t.p)}${macroBar("Жиры", s.f, t.f)}${macroBar("Углеводы", s.c, t.c)}</div>
    </div>
    ${questsWin(P, td)}
    <div class="grid2">
      <button class="btn block" data-act="photo">📷 Фото еды</button>
      <button class="btn block violet" data-act="manual">✎ Вручную</button>
    </div>
    <button class="btn block mt" data-act="workout">⚔ Тренировка Системы</button>
    ${planWin(t)}
    ${y && y.s.count ? `<div class="win violet mt"><div class="win-h">Отчёт за вчера</div>
      <div class="small">${r0(y.s.kcal)} ккал · Б ${r0(y.s.p)} · Ж ${r0(y.s.f)} · У ${r0(y.s.c)}</div>
      <div class="small ${y.xp < 0 ? "bad" : "muted"}">${y.all ? "Все квесты выполнены. " : ""}${y.penalty ? y.penalty.why + ". " : ""}Итог: ${y.xp >= 0 ? "+" : ""}${y.xp} XP</div></div>` : ""}
  `;
  $app.querySelector("[data-act=photo]").onclick = () => startPhoto(today());
  $app.querySelector("[data-act=manual]").onclick = () => openManual({ date: today() });
  $app.querySelector("[data-act=workout]").onclick = () => openWorkout(td, d.lvl);
  bindQuests(P);
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
  const t = targets(), d = diaryDate;
  const list = S.entries.filter(e => e.date === d).sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  const s = daySums(d);
  const meals = MEALS.map(m => {
    const items = list.filter(e => e.meal === m.id);
    const k = items.reduce((a, e) => a + e.kcal, 0);
    return `<div class="win"><div class="meal-h"><span class="n">${m.name}</span><span class="k">${r0(k)} ккал</span></div>
      ${items.length ? items.map(entryRow).join("") : `<div class="empty">Пусто</div>`}
      <button class="btn ghost sm mt" data-addmeal="${m.id}">+ Добавить</button></div>`;
  }).join("");
  $app.innerHTML = `
    <div class="screen-title"><h1>Дневник</h1></div>
    <div class="datebar">
      <button class="icon-btn" data-dd="-1">‹</button>
      <div class="d">${humanDate(d)}</div>
      <button class="icon-btn" data-dd="1" ${d >= today() ? "disabled style='opacity:.3'" : ""}>›</button>
    </div>
    <div class="win">
      <div class="row"><div class="grow"><div class="sys-font" style="font-size:22px;color:#fff">${r0(s.kcal)} <span class="muted small">/ ${t.kcal} ккал</span></div></div>
        <div class="small muted">Б ${r0(s.p)} · Ж ${r0(s.f)} · У ${r0(s.c)}</div></div>
      <div class="bar thick mt ${s.kcal > t.kcal * 1.05 ? "over" : ""}"><i style="width:${clamp(s.kcal / t.kcal * 100, 0, 100)}%"></i></div>
    </div>
    ${d !== today() && P.days[d] ? questsWin(P, d) : ""}
    ${meals}`;
  $app.querySelectorAll("[data-dd]").forEach(b => b.onclick = () => {
    const nd = addDays(diaryDate, +b.dataset.dd); if (nd > today()) return; diaryDate = nd; render();
  });
  $app.querySelectorAll("[data-addmeal]").forEach(b => b.onclick = () => openAddSheet(diaryDate, b.dataset.addmeal));
  $app.querySelectorAll("[data-entry]").forEach(b => b.onclick = () => openEdit(b.dataset.entry));
  bindQuests(P);
}
function entryRow(e) {
  return `<div class="entry" data-entry="${e.id}">
    <div class="th" ${e.thumb ? `style="background-image:url(${e.thumb})"` : ""}>${e.thumb ? "" : "✎"}</div>
    <div class="grow"><div class="nm">${esc(e.name)}</div>
      <div class="mc">${e.grams ? r0(e.grams) + " г · " : ""}Б ${r1(e.p)} · Ж ${r1(e.f)} · У ${r1(e.c)}</div></div>
    <div class="kc">${r0(e.kcal)}<small>ккал</small></div></div>`;
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
    <div class="screen-title"><h1>Охотник</h1><button class="icon-btn" style="margin-left:auto" id="to-settings" aria-label="Настройки">⚙</button></div>
    ${hunterCard(P, true)}
    <div class="win"><div class="win-h">Характеристики</div>
      <div class="stats">${STATS.map(([k, n, d]) => `<div class="stat"><div class="s-h"><span class="s-n">${n}</span><span class="s-v">${P.stats[k]}</span></div><div class="s-d">+1 за ${d}</div></div>`).join("")}</div>
    </div>
    <div class="win"><div class="win-h">Последние 14 дней<span class="right">ккал</span></div>
      <div class="chart"><div class="plot"><div class="goal" style="bottom:${goalPos}%"><span>${t.kcal}</span></div>${bars}</div><div class="labels">${labels}</div></div>
    </div>
    <div class="win violet"><div class="win-h">Достижения и титулы<span class="right">${[...got].length}/${ACH.length}</span></div>
      ${ACH.map(a => `<div class="ach ${got.has(a.id) ? "got" : ""}">
        <div class="ic">${a.ic}</div>
        <div class="grow"><div class="an">${esc(a.n)}</div><div class="ad">${esc(a.d)}</div></div>
        ${got.has(a.id) ? `<button class="btn sm ${S.title === a.id ? "violet" : "ghost"} sel" data-title="${a.id}">${S.title === a.id ? "Титул" : "Надеть"}</button>` : ""}
      </div>`).join("")}
    </div>`;
  $app.querySelectorAll("[data-title]").forEach(b => b.onclick = () => {
    S.title = S.title === b.dataset.title ? null : b.dataset.title; save(); render();
  });
  document.getElementById("to-settings").onclick = () => { tab = "settings"; render(); window.scrollTo(0, 0); };
}

/* ============================ экран: Рейтинг ============================ */
let board = null, boardErr = null, boardAt = 0;
async function loadBoard() {
  try { const d = await api("leaderboard"); board = d.players || []; boardErr = null; boardAt = Date.now(); }
  catch (e) { boardErr = e.message; }
  if (tab === "rating") render();
}
function renderRating(P) {
  if (!API_URL) {
    $app.innerHTML = `<div class="screen-title"><h1>Рейтинг</h1></div>
      <div class="win"><div class="win-h">Сервер не подключён</div><div class="small muted">Рейтинг заработает, когда будет подключён сервер ARISE.</div></div>`;
    return;
  }
  if (!board && !boardErr) { loadBoard(); }
  else if (Date.now() - boardAt > 60000 && !boardErr) { loadBoard(); }
  const td = today(), me = S.player && S.player.id;
  const rows = (board || []).map((u, i) => {
    const fresh = u.stats_date === td;
    const q = fresh ? u.today_quests : 0, qt = u.today_total || QUESTS.length;
    const streak = fresh || u.stats_date === addDays(td, -1) ? u.streak : 0;
    return `<div class="lb ${u.id === me ? "me" : ""}">
      <div class="pos ${i < 3 ? "top" + (i + 1) : ""}">${i + 1}</div>
      <div class="rank-mini rank-${esc(u.rank)}">${esc(u.rank)}</div>
      <div class="grow" style="min-width:0">
        <div class="nm">${esc(u.name)}${u.id === me ? ' <span class="tiny muted">(ты)</span>' : ""}</div>
        <div class="tiny muted ell">${u.title ? "«" + esc(u.title) + "» · " : ""}LV. ${u.level} · ${u.xp} XP</div>
      </div>
      <div class="lb-r"><div title="серия">🔥 ${streak}</div><div class="tiny ${q >= qt ? "ok" : "muted"}">квесты ${q}/${qt}</div></div>
    </div>`;
  }).join("");
  $app.innerHTML = `<div class="screen-title"><h1>Рейтинг</h1><button class="icon-btn" style="margin-left:auto" id="lb-refresh" aria-label="Обновить">↻</button></div>
    <div class="win"><div class="win-h">Таблица охотников<span class="right">по XP</span></div>
      ${boardErr ? `<div class="small bad">${esc(boardErr)}</div>` : !board ? `<div class="center"><span class="spinner"></span></div>` :
        rows || `<div class="empty">Пока никого. Позови друзей!</div>`}
    </div>
    <div class="tiny muted center mb">🔥 — дней подряд в ударе · квесты — выполнено сегодня.<br>Твои данные отправляются автоматически.</div>
    <button class="btn ghost block" id="lb-share">Пригласить друга</button>`;
  document.getElementById("lb-refresh").onclick = () => { board = null; boardErr = null; syncNow().finally(loadBoard); render(); };
  document.getElementById("lb-share").onclick = async () => {
    const url = location.href.split("#")[0];
    try { if (navigator.share) await navigator.share({ title: "ARISE", text: "Давай соревноваться в ARISE!", url }); else { await navigator.clipboard.writeText(url); toast("Ссылка скопирована"); } } catch {}
  };
}

/* ============================ тренировка ============================ */
function openWorkout(date, lvl) {
  sheet(`<div id="wk"></div>`, (el, close) => {
    const draw = () => {
      const w = wDay(date);
      el.querySelector("#wk").innerHTML = `<h2>Тренировка Системы</h2>
        <div class="tiny muted mb">${humanDate(date)} · уровень ${lvl}: нормы растут вместе с уровнем</div>
        ${EX.map(ex => {
          const tg = exTarget(ex, lvl), v = w[ex.id] || 0, done = v >= tg;
          return `<div class="quest ${done ? "done" : ""}"><div class="box">${done ? "✓" : ""}</div>
            <div class="grow"><div class="qt">${ex.n}</div><div class="qp">${r1(v)} / ${tg}${ex.unit}</div>
              <div class="bar" style="margin-top:5px"><i style="width:${clamp(v / tg * 100, 0, 100)}%"></i></div></div>
            <div class="row" style="gap:6px">
              <button class="icon-btn" data-dec="${ex.id}">−</button>
              <button class="icon-btn" data-inc="${ex.id}" style="width:auto;padding:0 8px">+${ex.inc}</button>
              <button class="icon-btn" data-full="${ex.id}" style="color:var(--ok)">✓</button>
            </div></div>`;
        }).join("")}
        <div class="notice mt">[ВНИМАНИЕ] Невыполнение не наказывается штрафом — но Система всё видит. Награда: +${XP.workout} XP.</div>
        <button class="btn block mt" id="wk-close">Готово</button>`;
      const set = (id, v) => {
        const ex = EX.find(e => e.id === id);
        S.workouts[date] = Object.assign({}, wDay(date), { [id]: Math.max(0, r1(Math.min(v, exTarget(ex, lvl) * 3))) });
        save(); draw(); render();
      };
      el.querySelectorAll("[data-inc]").forEach(b => b.onclick = () => { const ex = EX.find(e => e.id === b.dataset.inc); set(ex.id, (wDay(date)[ex.id] || 0) + ex.inc); });
      el.querySelectorAll("[data-dec]").forEach(b => b.onclick = () => { const ex = EX.find(e => e.id === b.dataset.dec); set(ex.id, (wDay(date)[ex.id] || 0) - ex.inc); });
      el.querySelectorAll("[data-full]").forEach(b => b.onclick = () => { const ex = EX.find(e => e.id === b.dataset.full); set(ex.id, exTarget(ex, lvl)); });
      el.querySelector("#wk-close").onclick = close;
    };
    draw();
  });
}

/* ============================ экран: Настройки ============================ */
function profileFields(p, withName) {
  p = p || { name: "", sex: "m", age: 25, height: 178, weight: 80, targetWeight: 75, activity: 1.375 };
  return `
    ${withName ? `<label class="f">Имя охотника (видно в рейтинге)<input class="in" id="pf-name" value="${esc(p.name)}" placeholder="Например, Сурен" maxlength="24" autocomplete="off"></label>` : ""}
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
  const lastW = S.weights.slice(-6).reverse();
  $app.innerHTML = `
    <div class="screen-title"><button class="icon-btn" id="back-hunter">‹</button><h1>Настройки</h1></div>
    ${accountWin()}
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
    <div class="win"><div class="win-h">Взвешивание</div>
      <div class="row"><input class="in grow" id="w-in" inputmode="decimal" placeholder="Вес сегодня, кг" value="">
        <button class="btn" id="w-add">Записать</button></div>
      ${lastW.length ? `<div class="mt small">${lastW.map(w => `<div class="kv"><span class="muted">${humanDate(w.date)}</span><b>${w.kg} кг</b></div>`).join("")}</div>` : `<div class="tiny muted mt">Вес обновит параметры тела и пересчитает норму.</div>`}
    </div>
    <div class="win"><div class="win-h">Данные</div>
      <div class="grid2"><button class="btn ghost" id="exp">Экспорт</button><button class="btn ghost" id="imp">Импорт</button></div>
      <input type="file" id="imp-file" accept="application/json,.json" class="hidden">
      <div class="tiny muted mt">Записей: ${S.entries.length}. ${S.player ? "Копия данных хранится на сервере — восстановишь по коду." : "Данные лежат только в этом браузере — делай экспорт."}</div>
      <button class="btn danger block mt" id="reset">Сбросить всё</button>
    </div>
    <div class="center tiny dim mb">ARISE · v2.0</div>`;
  document.getElementById("back-hunter").onclick = () => { tab = "hunter"; render(); };
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
  document.getElementById("w-add").onclick = () => {
    const kg = r1(num(document.getElementById("w-in").value));
    if (kg < 30 || kg > 300) return toast("Введите вес в кг", true);
    addWeight(kg, true); render();
  };
  document.getElementById("exp").onclick = exportData;
  document.getElementById("imp").onclick = () => document.getElementById("imp-file").click();
  document.getElementById("imp-file").onchange = importData;
  document.getElementById("reset").onclick = () => {
    if (!confirm("Удалить ВСЕ данные: записи, прогресс, профиль?")) return;
    if (!confirm("Точно? Это нельзя отменить.")) return;
    localStorage.removeItem(STORE_KEY); S = defaultState(); tab = "status"; render();
  };
}
function accountWin() {
  if (!S.player) return API_URL ? `<div class="win violet"><div class="win-h">Аккаунт</div>
    <div class="small muted mb">Ты ещё не в рейтинге.</div><button class="btn violet block" id="acc-reg">Войти в рейтинг</button></div>` : "";
  return `<div class="win violet"><div class="win-h">Аккаунт<span class="right">${esc(S.player.name)}</span></div>
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
  a.download = `arise-backup-${today()}.json`; document.body.appendChild(a); a.click();
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
    <div class="logo">ARISE</div>
    <div class="tagline">СИСТЕМА УЧЁТА ЭНЕРГИИ</div>
    <div class="win">
      <div class="win-h">Уведомление</div>
      <div class="small mb">Вы получили право стать <b style="color:var(--blue2)">Игроком</b>. Система составит план питания под вашу цель, будет выдавать ежедневные квесты и повышать ваш уровень.<br><span class="muted">Заполните параметры — это займёт минуту.</span></div>
      ${profileFields(S.player ? { name: S.player.name, sex: "m", age: 25, height: 178, weight: 80, targetWeight: 75, activity: 1.375 } : null, !S.player)}
      <button class="btn block mt" id="accept" style="margin-top:16px">Принять</button>
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
    system({ kind: "levelup", tag: "СИСТЕМА", head: "Игрок пробуждён",
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
      <button class="add-opt" data-o="photo"><span class="i">📷</span><b>Фото</b><span>Система распознает блюдо и КБЖУ</span></button>
      <button class="add-opt" data-o="manual"><span class="i">✎</span><b>Вручную</b><span>Название, вес и калории</span></button>
    </div>
    ${recentList()}`, (el, close) => {
    el.querySelector("[data-o=photo]").onclick = () => { close(); startPhoto(date, meal); };
    el.querySelector("[data-o=manual]").onclick = () => { close(); openManual({ date, meal }); };
    el.querySelectorAll("[data-recent]").forEach(b => b.onclick = () => {
      const e = S.entries.find(x => x.id === b.dataset.recent); close();
      const per = e.grams ? 100 / e.grams : 1;
      openManual({ date, meal, name: e.name, grams: e.grams || "", mode: e.grams ? "100" : "total",
        kcal: r1(e.kcal * per), p: r1(e.p * per), f: r1(e.f * per), c: r1(e.c * per) });
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

/* ---------- ручной ввод ---------- */
function openManual(o = {}) {
  let mode = o.mode || "100";
  sheet(`<h2>Ручной ввод</h2>
    <label class="f">Название<input class="in" id="m-name" value="${esc(o.name || "")}" placeholder="Например, овсянка на молоке"></label>
    <div class="grid2 mt"><label class="f">Вес порции, г<input class="in" id="m-g" inputmode="decimal" value="${o.grams ?? ""}" placeholder="г"></label>
      <label class="f">Приём пищи${mealSelect("m-meal", o.meal || mealByTime())}</label></div>
    <div class="seg mt" id="m-mode"><button data-m="100">На 100 г</button><button data-m="total">На всю порцию</button></div>
    <div class="grid4 mt">
      <label class="f">Ккал<input class="in" id="m-k" inputmode="decimal" value="${o.kcal ?? ""}"></label>
      <label class="f">Белки<input class="in" id="m-p" inputmode="decimal" value="${o.p ?? ""}"></label>
      <label class="f">Жиры<input class="in" id="m-f" inputmode="decimal" value="${o.f ?? ""}"></label>
      <label class="f">Углев.<input class="in" id="m-c" inputmode="decimal" value="${o.c ?? ""}"></label>
    </div>
    <div class="total-line"><span class="muted small" id="m-sum"></span><b id="m-tot">0 ккал</b></div>
    <button class="btn block" id="m-save">Записать</button>`, (el, close) => {
    const g = id => el.querySelector("#" + id);
    const calc = () => {
      const grams = num(g("m-g").value), f = mode === "100" ? grams / 100 : 1;
      return { grams, kcal: num(g("m-k").value) * f, p: num(g("m-p").value) * f, f: num(g("m-f").value) * f, c: num(g("m-c").value) * f };
    };
    const upd = () => {
      el.querySelectorAll("#m-mode button").forEach(b => b.classList.toggle("on", b.dataset.m === mode));
      const v = calc();
      g("m-tot").textContent = `${r0(v.kcal)} ккал`;
      g("m-sum").textContent = mode === "100" && !v.grams ? "Укажи вес порции" : `Б ${r1(v.p)} · Ж ${r1(v.f)} · У ${r1(v.c)}`;
    };
    el.querySelectorAll("#m-mode button").forEach(b => b.onclick = () => { mode = b.dataset.m; upd(); });
    el.querySelectorAll("input").forEach(i => i.oninput = upd);
    upd();
    g("m-save").onclick = () => {
      const name = g("m-name").value.trim(); const v = calc();
      if (!name) return toast("Введите название", true);
      if (mode === "100" && !v.grams) return toast("Укажите вес порции", true);
      if (v.kcal <= 0) return toast("Укажите калории", true);
      addEntries([{ name, grams: v.grams, kcal: v.kcal, p: v.p, f: v.f, c: v.c, source: "manual" }], o.date || today(), g("m-meal").value);
      close();
    };
    if (!o.name) setTimeout(() => g("m-name").focus(), 250);
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
    const full = drawScaled(img, 1280, 0.85);
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
function openPhotoSheet(dataUrl, thumb, ctx) {
  let items = [];
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
        items = res.items.map(it => ({ ...it, on: true, base: { ...it } }));
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
      const conf = { high: "точно", medium: "примерно", low: "неуверенно" };
      g("p-body").innerHTML = `
        <div class="win mt"><div class="win-h">${esc(res.summary || "Результат")}</div>
          ${res.notes ? `<div class="tiny muted mb">${esc(res.notes)}</div>` : ""}
          <div id="p-items">${items.map((it, i) => `<div class="item" data-i="${i}">
            <div class="top"><input type="checkbox" checked data-on="${i}"><input class="nm-in" data-name="${i}" value="${esc(it.name)}">
              <span class="conf ${it.confidence}">${conf[it.confidence]}</span></div>
            <div class="nums">
              <label>Вес, г<input inputmode="decimal" data-g="${i}" value="${it.grams}"></label>
              <label>Ккал<input inputmode="decimal" data-k="${i}" value="${it.kcal}"></label>
              <label>Б<input inputmode="decimal" data-p="${i}" value="${it.protein}"></label>
              <label>Ж<input inputmode="decimal" data-f="${i}" value="${it.fat}"></label>
              <label>У<input inputmode="decimal" data-c="${i}" value="${it.carbs}"></label>
            </div></div>`).join("")}</div>
          <div class="total-line"><span class="muted small" id="p-sum"></span><b id="p-tot"></b></div>
          <div class="tiny dim">Подправь вес, если знаешь точнее — КБЖУ пересчитаются.</div>
        </div>
        <label class="f">Приём пищи${mealSelect("p-meal2", meal)}</label>
        <div class="grid2 mt"><button class="btn ghost" id="p-cancel">Отмена</button><button class="btn" id="p-save">Записать</button></div>`;
      const tot = () => {
        const on = items.filter(i => i.on);
        const s = on.reduce((a, i) => ({ k: a.k + i.kcal, p: a.p + i.protein, f: a.f + i.fat, c: a.c + i.carbs }), { k: 0, p: 0, f: 0, c: 0 });
        g("p-tot").textContent = `${r0(s.k)} ккал`; g("p-sum").textContent = `Б ${r1(s.p)} · Ж ${r1(s.f)} · У ${r1(s.c)}`;
      };
      const box = g("p-items");
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
      box.addEventListener("change", ev => { if (ev.target.dataset.on !== undefined) box.dispatchEvent(new Event("input")); });
      tot();
      g("p-cancel").onclick = close;
      g("p-save").onclick = () => {
        const on = items.filter(i => i.on && i.kcal > 0);
        if (!on.length) return toast("Ничего не выбрано", true);
        addEntries(on.map(i => ({ name: i.name.trim() || "продукт", grams: i.grams, kcal: i.kcal, p: i.protein, f: i.fat, c: i.carbs, source: "photo" })),
          ctx.date, g("p-meal2").value, thumb);
        close();
      };
    };
    g("p-go").onclick = go;
  });
}

/* ============================ запуск ============================ */
render();
if (S.player) setTimeout(syncNow, 1500);
// новый день — пересчитать при возвращении в приложение
document.addEventListener("visibilitychange", () => { if (!document.hidden && S.profile && !document.querySelector(".sheet-bg")) render(); });
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
