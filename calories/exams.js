// Ingot — экзамены на ранг. Уровень открывает экзамен, ранг даётся только после сдачи.
// Одна ошибка (пропущенный квест, недобитая тренировка, неотмеченное условие) — провал и пересдача через N дней.

import { phrase } from "./phrases.js";

let X; // { S(), save, today, addDays, parseD, system, postEvent, render, esc, sheet }
export function initExams(ctx) { X = ctx; }

export const RANK_ORDER = ["E", "D", "C", "B", "A", "S", "N"];
export const rankIdx = r => Math.max(0, RANK_ORDER.indexOf(r));
const ALL = ["10 000+ шагов", "Без сладкого и фастфуда", "Отбой до 00:00"];
export const EXAMS = [
  { to: "D", level: 10, days: 7, mult: 1.25, checks: [], cooldown: 3 },
  { to: "C", level: 20, days: 14, mult: 1.5, checks: ["8 000+ шагов"], cooldown: 5 },
  { to: "B", level: 35, days: 21, mult: 2, checks: ["Без сладкого и фастфуда"], raid: 7, cooldown: 7 },
  { to: "A", level: 50, days: 30, mult: 2, checks: ["10 000+ шагов", "Отбой до 00:00"], weight: true, raid: 7, cooldown: 10 },
  { to: "S", level: 70, days: 45, mult: "max", checks: ALL, weight: true, final: true, cooldown: 14 },
  { to: "N", level: 85, days: 60, mult: "max", checks: ALL, weight: true, final: true, cooldown: 21 },
];
// Ранги Ingot: внутренние коды E…N остаются (хранятся в данных и на сервере), людям показываем имена.
export const RANKS = {
  E: { n: "Искра", en: "Spark", c1: "#ff7a5c", c2: "#b3200f" },
  D: { n: "Боец", en: "Fighter", c1: "#ff9a4a", c2: "#b4400c" },
  C: { n: "Воин", en: "Warrior", c1: "#ffbe55", c2: "#b8650a" },
  B: { n: "Мастер", en: "Master", c1: "#ffe08a", c2: "#c98a14" },
  A: { n: "Чемпион", en: "Champion", c1: "#fff6dc", c2: "#ffb347" },
  S: { n: "Титан", en: "Titan", c1: "#ffd76a", c2: "#a8700a" },
  N: { n: "Легенда", en: "Legend", c1: "#fff0b8", c2: "#9a6bff" },
};
export const RANK_TITLE = Object.fromEntries(Object.entries(RANKS).map(([k, v]) => [k, v.n]));
export const rankName = r => (RANKS[r] || RANKS.E).n;
export const rankMono = r => rankName(r)[0];
/** Уровни, с которых открывается экзамен на следующий ранг (E→D с 10-го и т.д.). */
export const RANK_LV = [0, 10, 20, 35, 50, 70, 85];
/** Ступень внутри ранга: I/II/III по прогрессу уровня до следующего экзамена. У Легенды ступеней нет. */
export function rankTier(rank, level) {
  const i = rankIdx(rank); if (i >= 6) return "";
  const f = (level - RANK_LV[i]) / Math.max(1, RANK_LV[i + 1] - RANK_LV[i]);
  return f >= 2 / 3 ? "III" : f >= 1 / 3 ? "II" : "I";
}
export const rankLabel = (rank, level) => (rankName(rank) + " " + rankTier(rank, level)).trim();
/** Пламя ранга (SVG) — растёт и раскаляется от Искры к Легенде. */
export function rankGlyph(r, size = 16) {
  const R = RANKS[r] || RANKS.E, id = "rg" + r + size;
  return `<svg class="rk-glyph" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${R.c2}"/><stop offset="1" stop-color="${R.c1}"/></linearGradient></defs><path fill="url(#${id})" d="M12 2c1 3.2 4.6 5.4 4.6 10.2A4.6 4.6 0 0 1 12 17a4.6 4.6 0 0 1-4.6-4.8c0-2 1-3.4 2.2-4.6.2 1.6 1 2.6 2 3C11 8.200 11.200 4.800 12 2Z"/><path fill="${R.c1}" opacity=".55" d="M12 22c-4.400 0-7-2.600-7-5.600 0-.9.2-1.700.6-2.500.6 2.900 3.300 4.900 6.400 4.900s5.800-2 6.400-4.900c.4.800.6 1.600.6 2.500C19 19.400 16.400 22 12 22Z"/></svg>`;
}
const examFor = to => EXAMS.find(e => e.to === to);

/** Ранг по уровню (без экзаменов). */
export function levelRank(level) { let r = "E"; for (const e of EXAMS) if (level >= e.level) r = e.to; return r; }
/** Действующий ранг = меньшее из ранга по уровню и сданного экзамена. */
export function effectiveRank(level) {
  const earned = X.S().rankEarned || "E", lr = levelRank(level);
  return rankIdx(lr) < rankIdx(earned) ? lr : earned;
}

/** Множитель тренировки на дату (во время экзамена). "max" — 100/100/100 и 10 км. */
export function exMult(d) {
  const ex = X.S().exam;
  if (!ex || ex.status !== "active" || d < ex.start || d > ex.end) return 1;
  const def = examFor(ex.to), n = dayNo(ex, d);
  if (def.final && n === def.days) return 3;
  if (def.raid && n % def.raid === 0) return 3;
  return def.mult;
}
const dayNo = (ex, d) => Math.round((X.parseD(d) - X.parseD(ex.start)) / 864e5) + 1;

function dayPass(ex, d, P) {
  const def = examFor(ex.to), day = P.days[d];
  if (!day || !day.all) return { ok: false, why: "не выполнены все ежедневные квесты" };
  const marks = (ex.checks || {})[d] || [];
  const miss = def.checks.filter(c => !marks.includes(c));
  if (miss.length) return { ok: false, why: `не отмечено: ${miss.join(", ")}` };
  return { ok: true };
}
function weightOk(ex) {
  const W = X.S().weights || [];
  const before = W.filter(w => w.date <= ex.start).pop() || W[0];
  const during = W.filter(w => w.date > ex.start && w.date <= X.addDays(ex.end, 1));
  if (!before || !during.length) return { ok: false, why: "нет взвешивания во время экзамена" };
  const last = during[during.length - 1];
  return last.kg <= before.kg + 0.3 ? { ok: true } : { ok: false, why: `вес вырос: ${before.kg} → ${last.kg} кг` };
}

/** Проверка экзамена после computeProgress: провал/успех, предложения. */
export function settleExam(P) {
  const S = X.S(), td = X.today(), ex = S.exam;
  S.seen.examOffer = S.seen.examOffer || [];
  if (ex && ex.status === "active") {
    for (let d = ex.start; d < td && d <= ex.end; d = X.addDays(d, 1)) {
      const r = dayPass(ex, d, P);
      if (!r.ok) return failExam(ex, `День ${dayNo(ex, d)}: ${r.why}.`);
    }
    if (td > ex.end) {
      const def = examFor(ex.to);
      if (def.weight) { const w = weightOk(ex); if (!w.ok) return failExam(ex, `Условие веса: ${w.why}.`); }
      return passExam(ex);
    }
    return;
  }
  const next = nextExam(P);
  if (next && next.available && !S.seen.examOffer.includes(next.def.to)) {
    S.seen.examOffer.push(next.def.to); X.save();
    X.system({ kind: "achv", tag: `ЭКЗАМЕН НА РАНГ «${rankName(next.def.to).toUpperCase()}»`, head: "Доступно испытание",
      body: `Твой уровень достаточен для ранга «${rankName(next.def.to)}».\nНо ранг не дают — его подтверждают.\n${next.def.days} дней без единой ошибки.\nНачать можно на экране «Статус».` });
  }
}
function failExam(ex, why) {
  const S = X.S(), def = examFor(ex.to);
  ex.status = "failed"; ex.failedAt = X.today();
  S.examCooldown = { to: ex.to, until: X.addDays(X.today(), def.cooldown) };
  (S.examHistory = S.examHistory || []).push({ ...ex });
  S.exam = null; X.save();
  X.system({ kind: "penalty", tag: "ЭКЗАМЕН ПРОВАЛЕН", head: rankName(ex.to), body: `${why}\nПересдача через ${def.cooldown} дн.\n\nОдна ошибка — и всё сначала. Так рождаются сильные.`, btn: "Понятно" });
  X.postEvent("exam", `провалил экзамен на ранг «${rankName(ex.to)}»`);
}
function passExam(ex) {
  const S = X.S();
  ex.status = "passed"; ex.passedAt = X.today();
  S.rankEarned = ex.to; (S.examHistory = S.examHistory || []).push({ ...ex });
  S.exam = null; S.examCooldown = null;
  S.adj = S.adj || []; S.adj.push({ date: X.today(), xp: 100 * (rankIdx(ex.to) + 1), why: `Экзамен на ранг «${rankName(ex.to)}»` });
  // титул ранга выдаётся как достижение (rankD…rankN) — отдельный дубль больше не создаём
  X.save();
  X.system({ kind: "rank", rank: ex.to, tag: "НОВЫЙ РАНГ", head: rankName(ex.to).toUpperCase(), body: `${phrase("rank")}\n\n+${100 * (rankIdx(ex.to) + 1)} XP`, btn: "Принять силу" });
  X.postEvent("exam", `сдал экзамен и получил ранг «${rankName(ex.to)}»`);
}
/** Следующий экзамен: доступен ли, или кулдаун. */
export function nextExam(P) {
  const S = X.S(), earned = S.rankEarned || "E";
  const def = EXAMS.find(e => rankIdx(e.to) === rankIdx(earned) + 1);
  if (!def) return null;
  const cd = S.examCooldown && S.examCooldown.to === def.to && S.examCooldown.until > X.today() ? S.examCooldown.until : null;
  return { def, available: P.level >= def.level && !cd && !S.exam, cooldownUntil: cd, needLevel: def.level };
}

/* ---------- окно на «Статусе» ---------- */
export function examWin(P) {
  const S = X.S(), ex = S.exam, td = X.today();
  if (ex && ex.status === "active") {
    const def = examFor(ex.to), n = Math.max(0, dayNo(ex, td)), m = exMult(td);
    const marks = (ex.checks || {})[td] || [];
    const before = td < ex.start;
    return `<div class="win exam-win mt"><div class="win-h">Экзамен на ранг «${rankName(ex.to)}»<span class="right">${before ? "старт завтра" : `день ${Math.min(n, def.days)}/${def.days}`}</span></div>
      <div class="bar thick"><i style="width:${Math.min(100, (n - 1) / def.days * 100)}%"></i></div>
      <div class="small mt"><b>Сегодня без ошибок:</b></div>
      <div class="ex-req ${P.days[td] && P.days[td].all ? "ok" : ""}">${P.days[td] && P.days[td].all ? "✓" : "◇"} Все ежедневные квесты</div>
      <div class="ex-req">◇ Тренировка Системы ${m === "max" ? "100/100/100 и 10 км" : `×${m}`}${m === 3 ? " — день рейда!" : ""} · 📷 только с камерой</div>
      ${def.checks.map(c => `<div class="ex-req ${marks.includes(c) ? "ok" : ""}">${marks.includes(c) ? "✓" : "◇"} ${X.esc(c)}
        ${!marks.includes(c) && !before ? `<button class="btn sm" data-excheck="${X.esc(c)}">Отметить</button>` : ""}</div>`).join("")}
      ${def.weight ? `<div class="ex-req">◇ Вес не растёт (взвесься хотя бы раз до конца экзамена)</div>` : ""}
      <div class="tiny bad mt">Одна ошибка — провал и пересдача через ${def.cooldown} дн.</div></div>`;
  }
  const nx = nextExam(P);
  if (!nx) return "";
  if (nx.available) return `<div class="win exam-win mt"><div class="win-h">Экзамен на ранг «${rankName(nx.def.to)}»<span class="right">доступен</span></div>
    <div class="small">Уровень достаточен. Подтверди ранг: ${nx.def.days} дней без единой ошибки.</div>
    <button class="btn-epic block mt" data-exstart>Начать экзамен</button></div>`;
  if (nx.cooldownUntil) return `<div class="win exam-win mt"><div class="win-h">Экзамен на ранг «${rankName(nx.def.to)}»</div>
    <div class="small muted">Пересдача доступна с ${X.parseD(nx.cooldownUntil).getDate()}.${String(X.parseD(nx.cooldownUntil).getMonth() + 1).padStart(2, "0")}.</div></div>`;
  return "";
}
export function bindExam($app, P) {
  const S = X.S(), td = X.today();
  $app.querySelectorAll("[data-excheck]").forEach(b => b.onclick = () => {
    if (!confirm(`Подтверждаешь: «${b.dataset.excheck}» — выполнено сегодня? Система доверяет игрокам.`)) return;
    const ex = S.exam; ex.checks = ex.checks || {}; ex.checks[td] = [...new Set([...(ex.checks[td] || []), b.dataset.excheck])];
    X.save(); X.render();
  });
  const st = $app.querySelector("[data-exstart]");
  if (st) st.onclick = () => {
    const def = nextExam(P).def;
    X.sheet(`<div class="center"><div class="tag-sys">ЭКЗАМЕН НА РАНГ «${rankName(def.to).toUpperCase()}»</div>
      <div class="sys-font mt" style="font-size:20px;color:#fff">${def.days} дней без ошибок</div></div>
      <div class="small mt">Каждый день:</div>
      <ul class="small"><li>все ежедневные квесты;</li><li>тренировка Системы ${def.mult === "max" ? "в полной форме: 100 отжиманий, 100 приседаний, 100 скручиваний, 10 км" : `×${def.mult} от обычной`}${def.raid ? `; каждый ${def.raid}-й день — рейд: тренировка ×3` : ""}${def.final ? "; последний день — финальный данж: тренировка ×3" : ""};</li>
        ${def.checks.map(c => `<li>${X.esc(c)} (честная отметка);</li>`).join("")}${def.weight ? "<li>вес не растёт (взвешивание обязательно).</li>" : ""}</ul>
      <div class="notice">Одна ошибка — провал, пересдача через ${def.cooldown} дн. Старт — завтра.<br>${"Ранг не дарят. Ранг подтверждают."}</div>
      <button class="btn-epic block mt" id="ex-go">Принять испытание</button><button class="btn ghost block mt" id="ex-no">Не сейчас</button>`, (el, close) => {
      el.querySelector("#ex-no").onclick = close;
      el.querySelector("#ex-go").onclick = () => {
        const start = X.addDays(td, 1);
        S.exam = { to: def.to, start, end: X.addDays(start, def.days - 1), status: "active", checks: {} };
        X.save(); close();
        X.postEvent("exam", `начал экзамен на ранг «${rankName(def.to)}»`);
        X.system({ kind: "achv", tag: "ИСПЫТАНИЕ ПРИНЯТО", head: rankName(def.to), body: "Старт завтра. Система будет наблюдать каждый день." });
        X.render();
      };
    });
  };
}
