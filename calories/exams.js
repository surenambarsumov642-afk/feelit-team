// ARISE — экзамены на ранг. Уровень открывает экзамен, ранг даётся только после сдачи.
// Одна ошибка (пропущенный квест, недобитая тренировка, неотмеченное условие) — провал и пересдача через N дней.

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
export const RANK_TITLE = { E: "Охотник ранга E", D: "Охотник ранга D", C: "Охотник ранга C", B: "Охотник ранга B", A: "Охотник ранга A", S: "Охотник ранга S", N: "Охотник национального уровня" };
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
    X.system({ kind: "achv", tag: `ЭКЗАМЕН НА РАНГ ${next.def.to}`, head: "Доступно испытание",
      body: `Твой уровень достаточен для ранга ${next.def.to}.\nНо ранг не дают — его подтверждают.\n${next.def.days} дней без единой ошибки.\nНачать можно на экране «Статус».` });
  }
}
function failExam(ex, why) {
  const S = X.S(), def = examFor(ex.to);
  ex.status = "failed"; ex.failedAt = X.today();
  S.examCooldown = { to: ex.to, until: X.addDays(X.today(), def.cooldown) };
  (S.examHistory = S.examHistory || []).push({ ...ex });
  S.exam = null; X.save();
  X.system({ kind: "penalty", tag: "ЭКЗАМЕН ПРОВАЛЕН", head: `Ранг ${ex.to}`, body: `${why}\nПересдача через ${def.cooldown} дн.\n\nОдна ошибка — и всё сначала. Так рождаются сильные.`, btn: "Понятно" });
  X.postEvent("exam", `провалил экзамен на ранг ${ex.to}`);
}
function passExam(ex) {
  const S = X.S();
  ex.status = "passed"; ex.passedAt = X.today();
  S.rankEarned = ex.to; (S.examHistory = S.examHistory || []).push({ ...ex });
  S.exam = null; S.examCooldown = null;
  S.adj = S.adj || []; S.adj.push({ date: X.today(), xp: 100 * (rankIdx(ex.to) + 1), why: `Экзамен на ранг ${ex.to}` });
  S.extraTitles = S.extraTitles || [];
  const id = "rank_" + ex.to;
  if (!S.extraTitles.some(t => t.id === id)) S.extraTitles.push({ id, ic: ex.to, n: RANK_TITLE[ex.to], d: `Экзамен на ранг ${ex.to} сдан (${examFor(ex.to).days} дней без ошибок)` });
  X.save();
  X.system({ kind: "levelup", tag: "ПОВЫШЕНИЕ РАНГА", head: `РАНГ ${ex.to}`, body: `Экзамен сдан.\nТы больше не тот, кем начинал.\n+${100 * (rankIdx(ex.to) + 1)} XP · титул «${RANK_TITLE[ex.to]}»` });
  X.postEvent("exam", `сдал экзамен и получил ранг ${ex.to}`);
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
    return `<div class="win exam-win mt"><div class="win-h">Экзамен на ранг ${ex.to}<span class="right">${before ? "старт завтра" : `день ${Math.min(n, def.days)}/${def.days}`}</span></div>
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
  if (nx.available) return `<div class="win exam-win mt"><div class="win-h">Экзамен на ранг ${nx.def.to}<span class="right">доступен</span></div>
    <div class="small">Уровень достаточен. Подтверди ранг: ${nx.def.days} дней без единой ошибки.</div>
    <button class="btn-epic block mt" data-exstart>Начать экзамен</button></div>`;
  if (nx.cooldownUntil) return `<div class="win exam-win mt"><div class="win-h">Экзамен на ранг ${nx.def.to}</div>
    <div class="small muted">Пересдача доступна с ${X.parseD(nx.cooldownUntil).getDate()}.${String(X.parseD(nx.cooldownUntil).getMonth() + 1).padStart(2, "0")}.</div></div>`;
  return "";
}
export function bindExam($app, P) {
  const S = X.S(), td = X.today();
  $app.querySelectorAll("[data-excheck]").forEach(b => b.onclick = () => {
    if (!confirm(`Подтверждаешь: «${b.dataset.excheck}» — выполнено сегодня? Система доверяет охотникам.`)) return;
    const ex = S.exam; ex.checks = ex.checks || {}; ex.checks[td] = [...new Set([...(ex.checks[td] || []), b.dataset.excheck])];
    X.save(); X.render();
  });
  const st = $app.querySelector("[data-exstart]");
  if (st) st.onclick = () => {
    const def = nextExam(P).def;
    X.sheet(`<div class="center"><div class="tag-sys">ЭКЗАМЕН НА РАНГ ${def.to}</div>
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
        X.postEvent("exam", `начал экзамен на ранг ${def.to}`);
        X.system({ kind: "achv", tag: "ИСПЫТАНИЕ ПРИНЯТО", head: `Ранг ${def.to}`, body: "Старт завтра. Система будет наблюдать каждый день." });
        X.render();
      };
    });
  };
}
