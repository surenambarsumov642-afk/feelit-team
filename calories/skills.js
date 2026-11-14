// ARISE — модуль «Навыки»: интервью → план на 30 дней → ежедневные задания с проверкой → повторение → боссы → финальный проект.
// Состояние хранится в S.skills (локально + резервная копия на сервере через sync). ИИ — через действие сервера "skill".

let X; // контекст из app.js: { S(), save, api, sheet, system, toast, esc, today, addDays, parseD, humanDate, render, num, r0, drawPhoto, API_URL }
export function initSkills(ctx) { X = ctx; }

/* ============================ константы ============================ */
const POPULAR = [
  "ИИ-видео", "ИИ-картинки и дизайн", "ИИ-ассистенты и промпты", "Разработка ИИ-ботов", "Программирование на Python",
  "Веб-разработка", "Мобилография", "Монтаж видео", "SMM и ведение Instagram", "Таргетированная реклама", "Копирайтинг",
  "Графический дизайн", "Английский язык", "Публичные выступления", "Продажи", "Личные финансы и инвестиции",
  "Excel и Google Таблицы", "3D-моделирование", "Фотография", "Гитара",
];
const HARD = ["Не хватает времени", "Бросаю через неделю", "Не понимаю, с чего начать", "Теряюсь в теории", "Нет обратной связи", "Скучно"];
const FORMATS = ["Смотреть видео", "Читать", "Сразу пробовать руками", "Разбирать чужие примеры"];
const TONES = [["hard", "Жёстко, без жалости"], ["strict", "Строго, но с поддержкой"], ["soft", "Мягко"]];
const WD = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const BOSS_DAYS = [7, 14, 21, 28];
const XPS = { task: 40, late: 20, miss: -40 };
const REVIEW_STEPS = [1, 3, 7, 14, 30];

/* ============================ утилиты ============================ */
const e = s => X.esc(s);
const activeSkill = () => (X.S().skills || []).find(s => s.status === "active" || s.status === "interview" || s.status === "preview");
const daysBetween = (a, b) => Math.round((X.parseD(b) - X.parseD(a)) / 864e5);
export const dayOf = (sk, date) => daysBetween(sk.start, date) + 1; // 1..30
const dateOf = (sk, n) => X.addDays(sk.start, n - 1);
const planDay = (sk, n) => sk.plan.days.find(d => +d.day === n) || null;
const isRest = (sk, n) => !!(planDay(sk, n) || {}).rest;
const ask = (kind, ctx, image) => X.api("skill", { token: X.S().player.token, kind, ctx, image });
function searchUrl(res, lang) {
  const q = encodeURIComponent(res.query || res.title);
  return res.kind === "video" ? `https://www.youtube.com/results?search_query=${q}` : `https://www.google.com/search?q=${q}${lang === "ru" ? "&hl=ru" : ""}`;
}
function busy(el, text) { el.innerHTML = `<div class="center mt mb"><span class="spinner"></span> <span class="muted small">${e(text)}</span></div>`; }

/* ============================ прогресс навыка ============================ */
export function skillStats(sk) {
  const td = X.today();
  const nowDay = Math.min(30, dayOf(sk, td));
  let done = 0, need = 0;
  const missed = [];
  for (let n = 1; n <= 30; n++) {
    if (isRest(sk, n)) continue;
    need++;
    const t = sk.tasks[n];
    if (t && t.done) done++;
    else if (n < dayOf(sk, td)) missed.push(n);
  }
  const bossScores = BOSS_DAYS.map((d, i) => (sk.bosses[i + 1] && sk.bosses[i + 1].grade) ? sk.bosses[i + 1].grade.score : null);
  const bossAvg = bossScores.reduce((a, x) => a + (x || 0), 0) / 4;
  const finalScore = sk.final && sk.final.grade ? sk.final.grade.score : 0;
  const mastery = Math.round(0.4 * (done / Math.max(1, need)) * 100 + 0.3 * bossAvg + 0.3 * finalScore);
  return { nowDay, done, need, missed, bossScores, bossAvg, finalScore, mastery };
}
export const masteryRank = m => m >= 95 ? "S" : m >= 85 ? "A" : m >= 70 ? "B" : m >= 55 ? "C" : m >= 40 ? "D" : "E";

/** XP по датам для общего прогресса (вызывается из computeProgress). */
export function skillXpByDate() {
  const out = {}, add = (d, v) => { out[d] = (out[d] || 0) + v; };
  const td = X.today();
  for (const sk of X.S().skills || []) {
    if (!sk.start || !sk.plan) continue;
    for (const [n, t] of Object.entries(sk.tasks)) if (t.done && t.at) add(t.at, t.late ? XPS.late : XPS.task);
    for (const b of Object.values(sk.bosses)) if (b.grade && b.at) add(b.at, Math.round(b.grade.score));
    if (sk.final && sk.final.grade && sk.final.at) add(sk.final.at, Math.round(sk.final.grade.score * 1.5));
    for (let n = 1; n <= 30; n++) {
      const d = dateOf(sk, n);
      if (d >= td || isRest(sk, n)) continue;
      const t = sk.tasks[n];
      if (!t || !t.done || (t.at && t.at > d)) add(X.addDays(d, 1) <= td ? X.addDays(d, 1) : d, XPS.miss);
    }
  }
  return out;
}
/** Позорный титул: пропуск задания навыка за последние 7 дней. */
export function shameTitle() {
  const td = X.today();
  for (const sk of X.S().skills || []) {
    if (!sk.start || !sk.plan) continue;
    for (let n = 1; n <= 30; n++) {
      const d = dateOf(sk, n);
      if (d >= td || isRest(sk, n) || daysBetween(d, td) > 7) continue;
      const t = sk.tasks[n];
      if (!t || !t.done || (t.at && t.at > d)) return "Беглец";
    }
  }
  return null;
}
export const finishedSkills = () => (X.S().skills || []).filter(s => s.status === "done");

/* ============================ виджет на «Статусе» ============================ */
export function statusCard() {
  const sk = activeSkill();
  if (!sk) return `<div class="win violet mt"><div class="win-h">Навык</div>
    <div class="small mb">Система может сделать из тебя специалиста за месяц. Один навык. Тридцать дней. Без отмены.</div>
    <button class="btn violet block" data-skgo>Освоить навык</button></div>`;
  if (sk.status !== "active") return `<div class="win violet mt"><div class="win-h">Навык</div>
    <div class="small mb">Подготовка плана не завершена.</div><button class="btn violet block" data-skgo>Продолжить</button></div>`;
  const st = skillStats(sk), n = dayOf(sk, X.today());
  const t = sk.tasks[n], pd = planDay(sk, n);
  const doneToday = t && t.done;
  return `<div class="win violet mt"><div class="win-h">${e(sk.plan.skill_name)}<span class="right">день ${Math.min(n, 30)}/30</span></div>
    ${n > 30 ? `<div class="small">Месяц завершён. Сдай финальный проект.</div>` :
      `<div class="small ${doneToday ? "ok" : ""}">${doneToday ? "✓ Задание дня выполнено" : pd && pd.rest ? "День отдыха: короткое повторение" : "[ЗАДАНИЕ ДНЯ] " + e(pd ? pd.title : "")}</div>`}
    ${st.missed.filter(m => !(sk.tasks[m] && sk.tasks[m].done)).length ? `<div class="tiny bad mt">Долгов: ${st.missed.length}</div>` : ""}
    <div class="bar violet mt"><i style="width:${n / 30 * 100}%"></i></div>
    <button class="btn violet block mt" data-skgo>${doneToday ? "Открыть навык" : "Выполнить"}</button></div>`;
}

/* ============================ экран «Навыки» ============================ */
let autoOpen = false; // сразу открыть интервью после анимации Врат

export function renderSkills($app) {
  const S = X.S();
  if (!S.skills) S.skills = [];
  const sk = activeSkill();
  if (!X.API_URL || !S.player) {
    $app.innerHTML = `<div class="screen-title"><h1>Навыки</h1></div><div class="win"><div class="small muted">Навыки работают через сервер: войди в рейтинг в Настройках.</div></div>`;
    return;
  }
  if (!sk || sk.status === "interview") {
    renderGate($app, sk);
    if (sk && autoOpen) { autoOpen = false; openInterview(sk); }
    return;
  }
  if (sk.status === "preview") return renderPreview($app, sk);
  return renderActive($app, sk);
}

/* ---------- Врата ---------- */
const RUNES = "ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ";
function gateHtml(big) {
  const ring = (cls, n) => `<div class="g-ring ${cls}">${Array.from({ length: n }, (_, i) =>
    `<span style="transform:rotate(${i * 360 / n}deg) translateY(var(--r))">${RUNES[(i * 7) % RUNES.length]}</span>`).join("")}</div>`;
  const parts = Array.from({ length: 14 }, (_, i) => `<i style="--a:${i * 26}deg;--d:${(i % 5) * 0.6}s;--s:${2.6 + (i % 4) * 0.5}s"></i>`).join("");
  return `<div class="gate ${big ? "big" : ""}">
    <div class="g-glow"></div>${ring("r1", 24)}${ring("r2", 16)}<div class="g-ring r3"></div>
    <div class="g-core"></div><div class="g-parts">${parts}</div></div>`;
}
function renderGate($app, sk) {
  const done = finishedSkills();
  $app.innerHTML = `<div class="gate-screen">
      ${gateHtml()}
      <div class="gate-title">ВРАТА НАВЫКА</div>
      <div class="gate-sub">Один навык · 30 дней · без отмены</div>
      <button class="btn-epic" id="sk-open">${sk ? "Вернуться во Врата" : "Открыть Врата"}</button>
      ${sk ? `<div class="tiny muted center mt">Интервью сохранено: вопрос ${(sk.qi || 0) + 1}</div>` : ""}
    </div>
    <div class="gate-feats">
      <div><b>🜂</b><span>План под тебя<br><small>после интервью и проверки уровня</small></span></div>
      <div><b>⚔</b><span>Проверка каждой работы<br><small>разбор от Системы</small></span></div>
      <div><b>♛</b><span>Боссы и финальный проект<br><small>процент освоения и ранг</small></span></div>
    </div>
    ${done.length ? `<div class="win violet mt"><div class="win-h">Освоенные навыки</div>${done.map(s => `<div class="ach got">
        <div class="ic">${masteryRank(s.mastery)}</div>
        <div class="grow"><div class="an">${e(s.plan.skill_name)} · Ур. ${s.level}</div><div class="ad">Освоено на ${s.mastery}% · ${e(s.plan.final_project.title)}</div></div></div>`).join("")}</div>` : ""}
    ${sk ? `<button class="btn ghost block mt" id="sk-drop">Отменить интервью</button>` : ""}`;
  $app.querySelector("#sk-open").onclick = () => sk ? openInterview(sk) : openGateAnimation();
  const dr = $app.querySelector("#sk-drop");
  if (dr) dr.onclick = () => { if (!confirm("Отменить интервью? Ответы удалятся.")) return; X.S().skills = X.S().skills.filter(s => s !== sk); X.save(); X.render(); };
}

function typeText(el, text, speed = 22) {
  return new Promise(res => {
    let i = 0, stop = false;
    el.textContent = ""; el.classList.add("typing");
    const skip = () => { stop = true; };
    el.addEventListener("click", skip, { once: true });
    const tick = () => {
      if (stop) { el.textContent = text; el.classList.remove("typing"); return res(); }
      el.textContent = text.slice(0, ++i);
      if (i >= text.length) { el.classList.remove("typing"); return res(); }
      setTimeout(tick, text[i - 1] === "." ? speed * 8 : speed);
    };
    tick();
  });
}

function openGateAnimation() {
  const ov = document.createElement("div");
  ov.className = "gate-ov";
  ov.innerHTML = `<div class="gate-ov-in">${gateHtml(true)}</div><div class="gate-flash"></div>
    <div class="gate-msg"><div class="tag-sys">СИСТЕМА</div><p id="gm1"></p><p id="gm2"></p><p id="gm3"></p>
    <button class="btn-epic hidden" id="gm-go">Я готов</button></div>`;
  document.body.appendChild(ov);
  requestAnimationFrame(() => ov.classList.add("on"));
  setTimeout(async () => {
    ov.classList.add("flash");
    await new Promise(r => setTimeout(r, 700));
    ov.classList.add("talk");
    await typeText(ov.querySelector("#gm1"), "Обнаружен скрытый потенциал.");
    await typeText(ov.querySelector("#gm2"), "Прежде чем открыть путь, Система должна узнать тебя.");
    await typeText(ov.querySelector("#gm3"), "Отвечай честно. От этого зависит твой план.");
    const go = ov.querySelector("#gm-go"); go.classList.remove("hidden");
    go.onclick = () => {
      const S = X.S();
      const sk = { id: Date.now().toString(36), status: "interview", qi: 0, level: 1,
        answers: { city: "Ташкент", lang: "ru", tone: "strict", off: [], hard: [], format: [] }, tasks: {}, bosses: {}, cards: [], journal: [] };
      S.skills.push(sk); X.save();
      ov.classList.add("out"); setTimeout(() => ov.remove(), 500);
      autoOpen = true; X.render();
    };
  }, 900);
}

/* ---------- интервью: слайды ---------- */
const chips = (name, list, sel, multi) => `<div class="chips-row">${list.map(v => {
  const [val, label] = Array.isArray(v) ? v : [v, v];
  const on = multi ? (sel || []).includes(val) : sel === val;
  return `<button class="chip-b ${on ? "on" : ""}" data-chip="${name}" data-val="${e(val)}">${e(label)}</button>`;
}).join("")}</div>`;

function questions(sk) {
  const a = sk.answers, Q = [];
  const sec = s => ({ sec: s });
  Q.push({ key: "goal", ...sec("Цель"), q: "Какой навык ты хочешь освоить?", hint: "Начни писать — Система подскажет. Можно своими словами.", type: "goal" });
  Q.push({ key: "result", ...sec("Цель"), q: "Что именно ты хочешь УМЕТЬ через 30 дней?", hint: "Результат, который можно показать. Например: «делать рекламные ролики для кафе с помощью ИИ».", type: "textarea" });
  Q.push({ key: "why", ...sec("Смысл"), q: "Зачем тебе это? Что изменится, когда научишься?", hint: "Эти слова Система напомнит тебе в день, когда захочется всё бросить.", type: "textarea" });
  Q.push({ key: "success", ...sec("Смысл"), q: "Как ты поймёшь через месяц, что всё получилось?", hint: "Твоя планка. По ней оценят финальный проект.", type: "textarea" });
  if (a.clar && a.clar.questions && a.clar.questions.length) {
    a.clar.questions.forEach((q, i) => Q.push({ key: "clar" + i, ...sec("Уточнение"), q, hint: "Система уточняет, чтобы цель стала конкретной.", type: "textarea", clar: i }));
    Q.push({ key: "goalFinal", ...sec("Уточнение"), q: "Твоя цель на месяц. Так верно?", hint: "Можно поправить формулировку.", type: "textarea" });
  }
  Q.push({ key: "tried", ...sec("Опыт"), q: "Что ты уже пробовал в этой теме? Что получалось, а что нет?", hint: "Честно. «Ничего» — тоже ответ.", type: "textarea" });
  Q.push({ key: "hard", ...sec("Опыт"), q: "Что тебе сложнее всего, когда учишься новому?", hint: "Можно несколько. План будет закрывать именно это.", type: "multi", options: HARD });
  Q.push({ key: "wk", ...sec("Время"), q: "Сколько минут в день реально готов тратить в будни?", hint: "Лучше честные 30 минут, чем обещанные 2 часа.", type: "chips", options: [["15", "15 мин"], ["30", "30 мин"], ["45", "45 мин"], ["60", "1 час"], ["90", "1,5 часа"], ["120", "2 часа"]] });
  Q.push({ key: "we", ...sec("Время"), q: "А в выходные?", type: "chips", options: [["0", "Не буду"], ["15", "15 мин"], ["30", "30 мин"], ["60", "1 час"], ["90", "1,5 часа"], ["120", "2 часа"], ["180", "3 часа"]] });
  Q.push({ key: "free", ...sec("Время"), q: "Когда ты обычно свободен? Работа, учёба, тренировки?", hint: "Например: «работа до 18:00, зал в 19:00, свободен после 21:00».", type: "text" });
  Q.push({ key: "off", ...sec("Время"), q: "Дни отдыха от навыка?", hint: "До двух дней в неделю. В эти дни — только 10 минут повторения. Можно не выбирать.", type: "multi", options: [["1", "Пн"], ["2", "Вт"], ["3", "Ср"], ["4", "Чт"], ["5", "Пт"], ["6", "Сб"], ["0", "Вс"]], optional: true, max: 2 });
  Q.push({ key: "device", ...sec("Ресурсы"), q: "С чего будешь учиться?", type: "chips", options: ["Только телефон", "Есть компьютер"] });
  Q.push({ key: "budget", ...sec("Ресурсы"), q: "Готов тратить деньги на платные сервисы?", hint: "Если нет — план только на бесплатных инструментах.", type: "chips", options: [["$0", "Нет, только бесплатно"], ["до $10", "До $10 в месяц"], ["до $30", "До $30"], ["больше $30", "Больше $30"]] });
  Q.push({ key: "lang", ...sec("Ресурсы"), q: "На каком языке тебе удобны материалы?", hint: "На английском уроков в разы больше.", type: "chips", options: [["ru", "Только русский"], ["sub", "Английский с субтитрами"], ["en", "Свободно английский"]] });
  Q.push({ key: "city", ...sec("Ресурсы"), q: "Твой город?", hint: "Для примеров и того, где применять навык.", type: "text" });
  Q.push({ key: "format", ...sec("Стиль"), q: "Как тебе проще разбираться?", hint: "Можно несколько.", type: "multi", options: FORMATS });
  Q.push({ key: "tone", ...sec("Стиль"), q: "Как Системе говорить с тобой, когда ты сачкуешь?", type: "chips", options: TONES });
  if (sk.diag && sk.diag.questions) sk.diag.questions.forEach((d, i) => Q.push({ key: "diag" + i, ...sec("Проверка уровня"), q: d.q, hint: (d.hint || "") + " Не знаешь — так и напиши, это нормально.", type: "textarea", diag: i }));
  return Q;
}
const getA = (sk, q) => q.clar !== undefined ? ((sk.answers.clarAns || [])[q.clar] || "") : q.diag !== undefined ? ((sk.diag.answers || [])[q.diag] || "") : sk.answers[q.key];
function setA(sk, q, v) {
  const a = sk.answers;
  if (q.clar !== undefined) { (a.clarAns = a.clarAns || [])[q.clar] = v; }
  else if (q.diag !== undefined) { (sk.diag.answers = sk.diag.answers || [])[q.diag] = v; }
  else a[q.key] = v;
}

function openInterview(sk) {
  let ov = document.querySelector(".iv-ov");
  if (!ov) {
    ov = document.createElement("div"); ov.className = "iv-ov";
    ov.innerHTML = `<div class="iv-bg"></div>
      <div class="iv-top"><button class="icon-btn" id="iv-back">‹</button><div class="grow"><div class="iv-sec" id="iv-sec"></div>
        <div class="bar violet" style="margin-top:6px"><i id="iv-prog"></i></div></div><button class="icon-btn" id="iv-x">✕</button></div>
      <div class="iv-stage" id="iv-stage"></div>`;
    document.body.appendChild(ov);
    requestAnimationFrame(() => ov.classList.add("on"));
  }
  const close = () => { ov.classList.remove("on"); setTimeout(() => ov.remove(), 350); X.render(); };
  ov.querySelector("#iv-x").onclick = close;
  ov.querySelector("#iv-back").onclick = () => { if ((sk.qi || 0) > 0) { sk.qi--; X.save(); show(-1); } };

  const show = (dir = 1) => {
    const Q = questions(sk);
    if (sk.qi >= Q.length) return finish();
    const q = Q[sk.qi];
    ov.querySelector("#iv-sec").textContent = `${q.sec} · ${sk.qi + 1}/${Q.length}${sk.diag ? "" : "+"}`;
    ov.querySelector("#iv-prog").style.width = (sk.qi / Q.length * 100) + "%";
    ov.querySelector("#iv-back").style.visibility = sk.qi ? "visible" : "hidden";
    const v = getA(sk, q);
    const slide = document.createElement("div");
    slide.className = "iv-slide " + (dir > 0 ? "from-r" : "from-l");
    let input = "";
    if (q.type === "text" || q.type === "goal") input = `<input class="in iv-in" id="iv-a" value="${e(v || "")}" autocomplete="off" placeholder="${q.type === "goal" ? "ИИ, монтаж, английский…" : ""}">${q.type === "goal" ? `<div id="iv-sugg" class="chips-row"></div>` : ""}`;
    if (q.type === "textarea") input = `<textarea class="in iv-in" id="iv-a" rows="4">${e(v || "")}</textarea>`;
    if (q.type === "chips") input = chips(q.key, q.options, v, false);
    if (q.type === "multi") input = chips(q.key, q.options, v || [], true);
    slide.innerHTML = `<div class="iv-tag">[ВОПРОС ${sk.qi + 1}]</div>
      <div class="iv-q" id="iv-q"></div>
      ${q.hint ? `<div class="iv-hint">${e(q.hint)}</div>` : ""}
      <div class="iv-ans">${input}</div>
      <button class="btn-epic iv-next" id="iv-next">${sk.qi === Q.length - 1 && sk.diag ? "Построить план" : "Далее"}</button>`;
    const stage = ov.querySelector("#iv-stage");
    const old = stage.querySelector(".iv-slide");
    if (old) { old.classList.add(dir > 0 ? "to-l" : "to-r"); setTimeout(() => old.remove(), 380); }
    stage.appendChild(slide);
    requestAnimationFrame(() => requestAnimationFrame(() => slide.classList.add("in")));
    typeText(slide.querySelector("#iv-q"), q.q, 16);

    const inp = slide.querySelector("#iv-a");
    if (inp) {
      setTimeout(() => inp.focus({ preventScroll: true }), 420);
      inp.oninput = () => { setA(sk, q, inp.value); X.save(); if (q.type === "goal") sugg(); };
      if (q.type === "text" || q.type === "goal") inp.onkeydown = ev => { if (ev.key === "Enter") next(); };
    }
    const sugg = () => {
      const box = slide.querySelector("#iv-sugg"); if (!box) return;
      const t = (inp.value || "").toLowerCase().trim();
      const list = !t ? POPULAR.slice(0, 6) : POPULAR.filter(p => p.toLowerCase().split(/[\s-]+/).some(w => t.split(/\s+/).some(x => x.length > 1 && w.startsWith(x)))).slice(0, 6);
      box.innerHTML = list.filter(p => p !== inp.value).map(p => `<button class="chip-b" data-sg="${e(p)}">${e(p)}</button>`).join("");
      box.querySelectorAll("[data-sg]").forEach(b => b.onclick = () => { inp.value = b.dataset.sg; setA(sk, q, inp.value); X.save(); sugg(); });
    };
    if (q.type === "goal") sugg();
    slide.querySelectorAll("[data-chip]").forEach(c => c.onclick = () => {
      const val = c.dataset.val;
      if (q.type === "multi") {
        const arr = Array.isArray(getA(sk, q)) ? [...getA(sk, q)] : [];
        const i = arr.indexOf(val);
        if (i >= 0) arr.splice(i, 1); else { if (q.max && arr.length >= q.max) return X.toast(`Не больше ${q.max}`, true); arr.push(val); }
        setA(sk, q, arr); c.classList.toggle("on");
      } else {
        setA(sk, q, val);
        slide.querySelectorAll("[data-chip]").forEach(x => x.classList.toggle("on", x === c));
        X.save(); setTimeout(next, 280);
      }
      X.save();
    });
    const next = async () => {
      const val = getA(sk, q);
      const empty = Array.isArray(val) ? !val.length : !String(val || "").trim();
      if (empty && !q.optional) { slide.classList.add("shake"); setTimeout(() => slide.classList.remove("shake"), 400); return X.toast("Ответь, чтобы продолжить", true); }
      // после блока «цель» — уточнение у ИИ
      if (q.key === "success" && !sk.answers.clar) {
        await withLoader("Система анализирует цель…", async () => {
          const a = sk.answers;
          a.clar = await ask("clarify", { skill: a.goal, result: a.result, why: a.why, success: a.success });
          a.goalFinal = a.clar.suggestion || a.result;
          if (!a.clar.vague) a.clar.questions = [];
        });
        if (!sk.answers.clar) return;
      }
      // после стиля — проверка уровня от ИИ
      if (q.key === "tone" && !sk.diag) {
        await withLoader("Система готовит проверку уровня…", async () => {
          const a = sk.answers;
          sk.diag = await ask("diag", { skill: a.goal, goal: a.goalFinal || a.result, tried: a.tried, device: a.device });
          sk.diag.answers = [];
        });
        if (!sk.diag) return;
      }
      sk.qi++; X.save(); show(1);
    };
    slide.querySelector("#iv-next").onclick = next;
  };

  const withLoader = async (text, fn) => {
    const stage = ov.querySelector("#iv-stage");
    const ld = document.createElement("div"); ld.className = "iv-loader";
    ld.innerHTML = `${gateHtml()}<div class="iv-ld-t">${e(text)}</div>`;
    stage.appendChild(ld);
    try { await fn(); }
    catch (err) { X.toast(err.message, true); }
    finally { ld.classList.add("out"); setTimeout(() => ld.remove(), 300); }
  };

  const finish = async () => {
    const stage = ov.querySelector("#iv-stage");
    stage.innerHTML = `<div class="iv-build">${gateHtml(true)}
      <div class="tag-sys">СИСТЕМА</div><div class="iv-steps" id="iv-steps"></div></div>`;
    ov.querySelector("#iv-prog").style.width = "100%";
    const steps = ["Анализ ответов", "Определение реального уровня", "Поиск слабых мест", "Финальный проект", "Построение 30 дней"];
    const box = stage.querySelector("#iv-steps");
    let k = 0;
    const timer = setInterval(() => {
      if (k > 0) box.children[k - 1].classList.add("ok");
      if (k < steps.length) { const d = document.createElement("div"); d.textContent = steps[k]; box.appendChild(d); k++; }
    }, 1600);
    try {
      await buildPlan(sk);
      clearInterval(timer);
      [...box.children].forEach(c => c.classList.add("ok"));
      await new Promise(r => setTimeout(r, 500));
      ov.classList.remove("on"); setTimeout(() => ov.remove(), 350);
      X.render(); window.scrollTo(0, 0);
    } catch (err) {
      clearInterval(timer);
      box.innerHTML = `<div class="bad">${e(err.message)}</div>`;
      const b = document.createElement("button"); b.className = "btn-epic mt"; b.textContent = "Повторить"; b.onclick = finish;
      box.appendChild(b);
    }
  };

  show(1);
}

async function buildPlan(sk) {
  const a = sk.answers;
  const start = X.addDays(X.today(), 1);
  const restDays = [];
  for (let n = 1; n <= 30; n++) if ((a.off || []).includes(String(X.parseD(X.addDays(start, n - 1)).getDay()))) restDays.push(n);
  const plan = await ask("plan", {
    skill: a.goal, goal_30_days: a.goalFinal || a.result, why: a.why, success: a.success,
    clarifications: (a.clar && a.clar.questions || []).map((q, i) => ({ q, a: (a.clarAns || [])[i] })),
    tried: a.tried, hardest: a.hard, minutes_weekday: a.wk, minutes_weekend: a.we, free_time: a.free, device: a.device, budget: a.budget,
    materials_language: { ru: "только русский", sub: "английский с субтитрами", en: "свободно английский" }[a.lang], city: a.city,
    formats: a.format, tone: (TONES.find(t => t[0] === a.tone) || TONES[1])[1], rest_days: restDays,
    start_weekday: WD[X.parseD(start).getDay()], diagnostic: sk.diag.questions.map((q, i) => ({ q: q.q, answer: (sk.diag.answers || [])[i] })),
  });
  if (!plan.days || plan.days.length < 30) throw new Error("План получился неполным. Нажми «Повторить».");
  plan.days = plan.days.slice(0, 30).map((d, i) => ({ ...d, day: i + 1, rest: restDays.includes(i + 1) }));
  sk.plan = plan; sk.status = "preview"; X.save();
}

/* ============================ предпросмотр плана ============================ */
function dayHtml(sk, d, opts = {}) {
  const res = d.resource || {};
  return `<div class="sk-day ${d.rest ? "rest" : ""}" ${opts.id ? `id="${opts.id}"` : ""}>
    <div class="row"><span class="sk-n">${d.day}</span><b class="grow">${e(d.title)}</b><span class="tiny muted">${d.minutes || ""} мин</span></div>
    ${opts.full ? `<div class="small mt">${e(d.what)}</div>
      ${res.title ? `<a class="btn ghost sm mt" target="_blank" rel="noopener" href="${searchUrl(res, sk.answers.lang)}">${res.kind === "video" ? "▶ YouTube" : "🔎 Найти"}: ${e(res.title)}</a>` : ""}
      <div class="tiny mt"><span class="muted">Сдать:</span> ${e(d.deliverable)}</div>
      <div class="tiny"><span class="muted">Зачем:</span> ${e(d.why)}</div>` : ""}
    ${opts.edit ? `<button class="btn ghost sm mt" data-edit="${d.day}">Изменить этот день</button>` : ""}
  </div>`;
}
function renderPreview($app, sk) {
  const p = sk.plan, pr = p.profile;
  $app.innerHTML = `<div class="reveal"><div class="screen-title"><h1>План готов</h1><span class="sub">${e(p.skill_name)}</span></div>
    <div class="win violet"><div class="win-h">Как Система тебя поняла</div>
      <div class="kv"><span class="muted">Уровень</span><b>${e(pr.level)}</b></div>
      <div class="small mt">${e(pr.level_note)}</div>
      ${pr.strengths && pr.strengths.length ? `<div class="tiny mt"><span class="ok">Сильные стороны:</span> ${pr.strengths.map(e).join(", ")}</div>` : ""}
      ${pr.weak && pr.weak.length ? `<div class="tiny"><span class="warn">Подтянуть:</span> ${pr.weak.map(e).join(", ")}</div>` : ""}
      <div class="tiny"><span class="bad">Главный риск:</span> ${e(pr.main_risk)}</div>
      <div class="tiny"><span class="muted">Твоё «зачем»:</span> ${e(pr.motivation)}</div>
    </div>
    <div class="win"><div class="win-h">Финальный проект</div><b>${e(p.final_project.title)}</b>
      <div class="small mt">${e(p.final_project.description)}</div>
      <ul class="tiny muted">${p.final_project.criteria.map(c => `<li>${e(c)}</li>`).join("")}</ul></div>
    ${p.weeks.map(w => `<div class="win"><div class="win-h">Неделя ${w.n}: ${e(w.theme)}</div><div class="tiny muted mb">${e(w.goal)}</div>
      ${p.days.filter(d => d.day > (w.n - 1) * 7 && (w.n === 4 ? d.day <= 30 : d.day <= w.n * 7)).map(d => dayHtml(sk, d, { edit: true })).join("")}
      ${w.n < 4 ? `<div class="tiny" style="color:var(--violet2)">⚔ День ${w.n * 7}: босс недели</div>` : `<div class="tiny" style="color:var(--violet2)">⚔ День 28: босс · День 30: защита проекта</div>`}</div>`).join("")}
    <div class="notice mb">Тапни «Изменить этот день», если что-то не подходит. После принятия план нельзя отменить.</div>
    <button class="btn-epic block" id="pv-accept">Принять план</button>
    <button class="btn ghost block mt" id="pv-redo">Пересобрать план</button>
    <button class="btn ghost block mt" id="pv-cancel">Отказаться</button></div>`;
  $app.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => editDay(sk, +b.dataset.edit));
  $app.querySelector("#pv-redo").onclick = () => { sk.status = "interview"; delete sk.plan; sk.qi = questions(sk).length - 1; X.save(); autoOpen = true; X.render(); };
  $app.querySelector("#pv-cancel").onclick = () => { if (!confirm("Отказаться от плана?")) return; X.S().skills = X.S().skills.filter(s => s !== sk); X.save(); X.render(); };
  $app.querySelector("#pv-accept").onclick = () => X.sheet(`<div class="center">
      <div class="tag-sys">ПРЕДУПРЕЖДЕНИЕ</div>
      <div class="sys-font mt" style="font-size:20px;color:#fff">Принять квест «${e(p.skill_name)}»?</div>
      <div class="small mt">30 дней. Задание каждый день. Отменить нельзя.<br>Пропуск дня: −40 XP и титул «Беглец» на неделю.<br>Старт — завтра.</div>
      <button class="btn violet block mt" id="ac-yes">Принять</button>
      <button class="btn ghost block mt" id="ac-no">Я ещё не готов</button></div>`, (el, close) => {
    el.querySelector("#ac-no").onclick = close;
    el.querySelector("#ac-yes").onclick = () => {
      sk.status = "active"; sk.start = X.addDays(X.today(), 1); sk.accepted = X.today(); X.save(); close(); X.render();
      X.postEvent && X.postEvent("skill", `принял квест навыка «${p.skill_name}» на 30 дней`);
      X.system({ kind: "achv", tag: "КВЕСТ ПРИНЯТ", head: p.skill_name, body: `Путь начинается завтра.\n«${pr.motivation}»\n\nОдин день — ничто. Тридцать дней — другой человек.` });
    };
  });
}
function editDay(sk, n) {
  const d = planDay(sk, n);
  X.sheet(`<h2>День ${n}</h2>${dayHtml(sk, d, { full: true })}
    <label class="f mt">Что изменить?<textarea class="in" id="ed-c" rows="2" placeholder="Например: слишком долго, у меня только 20 минут; хочу больше практики"></textarea></label>
    <button class="btn violet block mt" id="ed-go">Переписать день</button><div id="ed-st"></div>`, (el, close) => {
    el.querySelector("#ed-go").onclick = async () => {
      const c = el.querySelector("#ed-c").value.trim(); if (!c) return X.toast("Напиши, что изменить", true);
      busy(el.querySelector("#ed-st"), "Переписываю…");
      try {
        const nd = await ask("regen_day", { skill: sk.plan.skill_name, final_project: sk.plan.final_project.title, week: sk.plan.weeks[Math.min(3, Math.floor((n - 1) / 7))],
          minutes_weekday: sk.answers.wk, minutes_weekend: sk.answers.we, device: sk.answers.device, budget: sk.answers.budget, day: d, comment: c });
        Object.assign(d, nd, { day: n, rest: d.rest }); X.save(); close(); X.render();
      } catch (err) { el.querySelector("#ed-st").innerHTML = `<div class="small bad mt">${e(err.message)}</div>`; }
    };
  });
}

/* ============================ активный навык ============================ */
const MOTTOS = [
  "Каждый день, который ты не бросил, — это уровень, который у тебя никто не отнимет.",
  "Система не даёт силу. Она показывает, сколько её в тебе уже есть.",
  "Слабость — не приговор. Это стартовая точка.",
  "Пока ты сомневаешься, кто-то другой выполняет задание.",
  "Ты выбрал этот путь сам. Докажи, что выбор был верным.",
  "Охотник растёт не в день битвы, а в каждый скучный день до неё.",
  "Мотивация уходит. Дисциплина остаётся.",
];
function renderActive($app, sk) {
  const td = X.today(), n = dayOf(sk, td), st = skillStats(sk), p = sk.plan;
  const motto = MOTTOS[(n + 30) % MOTTOS.length];
  if (n < 1) {
    $app.innerHTML = `<div class="screen-title"><h1>${e(p.skill_name)}</h1></div>
      <div class="win violet"><div class="win-h">Квест принят</div><div class="small">Старт — завтра. Первое задание:</div>${dayHtml(sk, planDay(sk, 1), { full: true })}</div>
      <div class="tiny muted center">${e(motto)}</div>`;
    return;
  }
  const finished = n > 30 + 3 || (sk.final && sk.final.grade);
  if (finished && sk.status === "active") { finishSkill(sk); return renderHome($app); }
  const pd = planDay(sk, Math.min(n, 30)), t = sk.tasks[Math.min(n, 30)] || {};
  const debts = st.missed.filter(m => !(sk.tasks[m] && sk.tasks[m].done));
  const due = sk.cards.filter(c => c.due <= td);
  const bossAvail = BOSS_DAYS.map((d, i) => ({ d, w: i + 1 })).filter(b => n >= b.d && !(sk.bosses[b.w] && sk.bosses[b.w].grade));
  const week = Math.min(4, Math.ceil(Math.min(n, 30) / 7));
  $app.innerHTML = `<div class="sk-hero">${gateHtml()}<div class="sk-hero-t"><div class="gate-title" style="font-size:22px">${e(p.skill_name)}</div>
      <div class="gate-sub" style="margin:4px 0 0">Ур. ${sk.level} · день ${Math.min(n, 30)} из 30</div></div></div>
    <div class="win violet">
      <div class="row"><div class="grow"><div class="tiny muted">Освоение сейчас</div><div class="sys-font" style="font-size:26px;color:#fff">${st.mastery}%</div></div>
        <div class="rank-mini rank-${masteryRank(st.mastery)}" style="width:40px;height:40px;font-size:20px">${masteryRank(st.mastery)}</div></div>
      <div class="bar violet thick mt"><i style="width:${Math.min(n, 30) / 30 * 100}%"></i></div>
      <div class="tiny muted mt">Выполнено ${st.done}/${st.need} · боссы ${st.bossScores.filter(x => x !== null).length}/4 · неделя ${week}: ${e(p.weeks[week - 1] ? p.weeks[week - 1].theme : "")}</div>
      <div class="tiny mt" style="color:var(--violet2)">«${e(p.profile.motivation)}»</div>
    </div>
    ${n <= 30 ? `<div class="win"><div class="win-h">${pd.rest ? "День отдыха" : n === 30 ? "Финальный проект" : "Задание дня"}<span class="right">${t.done ? "✓ сдано" : "+" + XPS.task + " XP"}</span></div>
      ${dayHtml(sk, pd, { full: true })}
      ${t.done ? reviewHtml(t.review) : `<button class="btn violet block mt" data-submit="${n}">${n === 30 ? "Сдать финальный проект" : "Сдать работу"}</button>`}</div>`
    : !sk.final || !sk.final.grade ? `<div class="win"><div class="win-h">Финальный проект</div><div class="small mb">${e(p.final_project.title)}</div>
      <button class="btn violet block" data-submit="30">Сдать финальный проект</button></div>` : ""}
    ${bossAvail.map(b => `<div class="win violet"><div class="win-h">⚔ Босс недели ${b.w}</div>
      <div class="small mb">Экзамен по пройденному. Результат идёт в процент освоения.</div>
      <button class="btn violet block" data-boss="${b.w}">Вступить в бой</button></div>`).join("")}
    ${debts.length ? `<div class="win" style="border-color:rgba(255,77,109,.4)"><div class="win-h bad">Долги</div>
      <div class="tiny muted mb">Пропущенные дни. Штраф уже получен, но задание можно сдать (+${XPS.late} XP).</div>
      ${debts.map(m => `<div class="recent" data-submit="${m}"><span class="nm">День ${m}: ${e(planDay(sk, m).title)}</span><span class="muted">›</span></div>`).join("")}</div>` : ""}
    <div class="win"><div class="win-h">Повторение<span class="right">${due.length} к повтору</span></div>
      ${due.length ? `<button class="btn ghost block" id="rv-go">Повторить (${due.length})</button>` : `<div class="tiny muted">Сегодня повторять нечего. Карточки появляются после сданных заданий.</div>`}</div>
    <div class="win"><div class="win-h">Путь</div>
      ${p.days.map(d => { const tt = sk.tasks[d.day]; const cls = tt && tt.done ? "ok" : d.day < n && !d.rest ? "bad" : d.day === n ? "" : "dim";
        return `<span class="sk-dot ${cls} ${d.day === n ? "cur" : ""}" title="${e(d.title)}">${d.rest ? "·" : d.day}</span>`; }).join("")}
    </div>
    ${sk.journal.length ? `<div class="win"><div class="win-h">Дневник</div>${sk.journal.slice(-5).reverse().map(j => `<div class="small mb"><span class="tiny muted">день ${j.day}:</span> ${e(j.text)}</div>`).join("")}</div>` : ""}
    <div class="tiny muted center mb">${e(motto)}</div>`;
  $app.querySelectorAll("[data-submit]").forEach(b => b.onclick = () => openSubmit(sk, +b.dataset.submit));
  $app.querySelectorAll("[data-boss]").forEach(b => b.onclick = () => openBoss(sk, +b.dataset.boss));
  const rv = $app.querySelector("#rv-go"); if (rv) rv.onclick = () => openReview(sk);
}
function reviewHtml(r) {
  if (!r) return "";
  return `<div class="notice mt"><b class="${r.passed ? "ok" : "warn"}">${r.passed ? "Засчитано" : "Нужно доработать"} · ${Math.round(r.score)}/100</b>
    <div class="small mt">${e(r.feedback)}</div>${r.improve ? `<div class="small mt"><span class="muted">Улучшить:</span> ${e(r.improve)}</div>` : ""}</div>`;
}

/* ---------- сдача работы ---------- */
function openSubmit(sk, n) {
  const pd = planDay(sk, n), isFinal = n === 30;
  let photo = null;
  X.sheet(`<h2>${isFinal ? "Защита проекта" : "Сдача: день " + n}</h2>
    <div class="small"><b>${e(isFinal ? sk.plan.final_project.title : pd.title)}</b></div>
    <div class="tiny muted mt">Сдать: ${e(isFinal ? sk.plan.final_project.description : pd.deliverable)}</div>
    <label class="f mt">Твоя работа (текст, ответ, ссылка)<textarea class="in" id="sb-t" rows="5"></textarea></label>
    <div class="row mt"><button class="btn ghost sm" id="sb-ph">📷 Прикрепить фото/скриншот</button><span class="tiny muted" id="sb-phs"></span></div>
    <label class="f mt">Что понял сегодня? (1 предложение, для дневника)<input class="in" id="sb-j"></label>
    <button class="btn violet block mt" id="sb-go">Отправить Системе</button><div id="sb-st"></div>`, (el, close) => {
    el.querySelector("#sb-ph").onclick = async () => {
      const r = await X.pickPhoto(); if (!r) return;
      photo = r; el.querySelector("#sb-phs").textContent = "✓ фото прикреплено";
    };
    el.querySelector("#sb-go").onclick = async () => {
      const text = el.querySelector("#sb-t").value.trim(), journal = el.querySelector("#sb-j").value.trim();
      if (text.length < 5 && !photo) return X.toast("Опиши работу или прикрепи фото", true);
      const btn = el.querySelector("#sb-go"); btn.disabled = true;
      busy(el.querySelector("#sb-st"), "Система проверяет работу…");
      try {
        const base = { skill: sk.plan.skill_name, level: sk.plan.profile.level, tone: TONES.find(t => t[0] === sk.answers.tone)[1], submission: text || "(см. фото)" };
        if (isFinal) {
          const g = await ask("final_grade", { ...base, final_project: sk.plan.final_project }, photo);
          sk.final = { submission: text, grade: g, at: X.today() };
          sk.tasks[30] = { done: g.passed, at: X.today(), review: { passed: g.passed, score: g.score, feedback: g.feedback, improve: g.next } };
          X.save(); close();
          X.system({ kind: g.passed ? "levelup" : "penalty", tag: "ФИНАЛЬНЫЙ ПРОЕКТ", head: `${Math.round(g.score)}/100`, body: g.feedback });
          X.render();
          return;
        }
        const r = await ask("review", { ...base, task: { title: pd.title, what: pd.what, deliverable: pd.deliverable } }, photo);
        if (journal) sk.journal.push({ day: n, text: journal });
        if (r.passed) {
          const late = dateOf(sk, n) < X.today();
          sk.tasks[n] = { done: true, at: X.today(), late, review: r };
          for (const c of r.recall || []) sk.cards.push({ q: c.q, a: c.a, step: 0, due: X.addDays(X.today(), REVIEW_STEPS[0]) });
          X.save(); close(); X.render();
          X.postEvent && X.postEvent("skill", `выполнил день ${n} навыка «${sk.plan.skill_name}»`);
          X.system({ tag: "ЗАДАНИЕ ВЫПОЛНЕНО", head: `${sk.plan.skill_name} · день ${n}`, body: `+${late ? XPS.late : XPS.task} XP\n${r.feedback}\n\nКаждый день, который ты не бросил, — уровень, который у тебя никто не отнимет.` });
        } else {
          sk.tasks[n] = Object.assign(sk.tasks[n] || {}, { review: r, tries: ((sk.tasks[n] || {}).tries || 0) + 1 });
          X.save();
          el.querySelector("#sb-st").innerHTML = reviewHtml(r) + `<div class="tiny muted mt">Доработай и отправь снова.</div>`;
          btn.disabled = false;
        }
      } catch (err) { el.querySelector("#sb-st").innerHTML = `<div class="small bad mt">${e(err.message)}</div>`; btn.disabled = false; }
    };
  });
}

/* ---------- повторение ---------- */
function openReview(sk) {
  const td = X.today();
  const queue = sk.cards.filter(c => c.due <= td);
  let i = 0;
  X.sheet(`<div id="rv"></div>`, (el, close) => {
    const draw = (show) => {
      if (i >= queue.length) { el.querySelector("#rv").innerHTML = `<h2>Повторение завершено</h2><div class="small">Знания закреплены. Возвращайся завтра.</div><button class="btn block mt" id="rv-x">Готово</button>`; el.querySelector("#rv-x").onclick = () => { close(); X.render(); }; return; }
      const c = queue[i];
      el.querySelector("#rv").innerHTML = `<h2>Повторение ${i + 1}/${queue.length}</h2>
        <div class="win"><div class="small"><b>${e(c.q)}</b></div>${show ? `<div class="small mt" style="color:var(--blue2)">${e(c.a)}</div>` : ""}</div>
        ${show ? `<div class="grid2"><button class="btn danger" id="rv-no">Не помню</button><button class="btn" id="rv-yes">Помню</button></div>`
          : `<div class="tiny muted mb">Сначала вспомни сам, потом проверь.</div><button class="btn block" id="rv-show">Показать ответ</button>`}`;
      if (!show) el.querySelector("#rv-show").onclick = () => draw(true);
      else {
        el.querySelector("#rv-yes").onclick = () => { c.step = Math.min(c.step + 1, REVIEW_STEPS.length - 1); c.due = X.addDays(td, REVIEW_STEPS[c.step]); X.save(); i++; draw(false); };
        el.querySelector("#rv-no").onclick = () => { c.step = 0; c.due = X.addDays(td, 1); X.save(); i++; draw(false); };
      }
    };
    draw(false);
  });
}

/* ---------- босс ---------- */
function openBoss(sk, w) {
  X.sheet(`<div id="bs"></div>`, (el, close) => {
    const box = () => el.querySelector("#bs");
    const load = async () => {
      if (sk.bosses[w] && sk.bosses[w].boss) return fight();
      busy(box(), "Врата открываются…");
      try {
        const days = sk.plan.days.filter(d => d.day > (w - 1) * 7 && d.day <= w * 7);
        const boss = await ask("boss", { skill: sk.plan.skill_name, level: sk.plan.profile.level, week: sk.plan.weeks[w - 1],
          tasks: days.map(d => ({ title: d.title, done: !!(sk.tasks[d.day] && sk.tasks[d.day].done) })), weak: sk.plan.profile.weak });
        sk.bosses[w] = { boss, answers: [] }; X.save(); fight();
      } catch (err) { box().innerHTML = `<div class="small bad">${e(err.message)}</div>`; }
    };
    const fight = () => {
      const b = sk.bosses[w].boss;
      box().innerHTML = `<div class="center"><div class="tag-sys">БОСС НЕДЕЛИ ${w}</div><div class="sys-font mt" style="font-size:20px;color:#fff">${e(b.title)}</div>
        <div class="small muted mt">${e(b.intro)}</div></div>
        ${b.questions.map((q, i) => `<label class="f mt">${i + 1}. ${e(q)}<textarea class="in" rows="3" data-ba="${i}">${e(sk.bosses[w].answers[i] || "")}</textarea></label>`).join("")}
        <label class="f mt">⚔ Практика: ${e(b.practical)}<textarea class="in" rows="4" data-ba="${b.questions.length}">${e(sk.bosses[w].answers[b.questions.length] || "")}</textarea></label>
        <button class="btn violet block mt" id="bs-go">Нанести удар</button><div id="bs-st"></div>`;
      el.querySelectorAll("[data-ba]").forEach(t => t.onchange = () => { sk.bosses[w].answers[+t.dataset.ba] = t.value.trim(); X.save(); });
      el.querySelector("#bs-go").onclick = async () => {
        el.querySelectorAll("[data-ba]").forEach(t => sk.bosses[w].answers[+t.dataset.ba] = t.value.trim());
        if (sk.bosses[w].answers.filter(Boolean).length < b.questions.length + 1) return X.toast("Ответь на всё (можно «не знаю»)", true);
        const btn = el.querySelector("#bs-go"); btn.disabled = true; busy(el.querySelector("#bs-st"), "Система оценивает бой…");
        try {
          const g = await ask("boss_grade", { skill: sk.plan.skill_name, level: sk.plan.profile.level, boss: b, answers: sk.bosses[w].answers });
          sk.bosses[w].grade = g; sk.bosses[w].at = X.today();
          if (g.weak && g.weak.length) sk.plan.profile.weak = [...new Set([...(sk.plan.profile.weak || []), ...g.weak])].slice(-8);
          X.save(); close(); X.render();
          X.postEvent && X.postEvent("boss", g.passed ? `победил босса «${b.title}» (${Math.round(g.score)}/100)` : `проиграл боссу «${b.title}»`);
          X.system({ kind: g.passed ? "levelup" : "penalty", tag: g.passed ? "БОСС ПОВЕРЖЕН" : "БОСС УСТОЯЛ", head: `${b.title}: ${Math.round(g.score)}/100`, body: g.feedback });
          if (w < 4) setTimeout(() => openAdapt(sk, w), 400);
        } catch (err) { el.querySelector("#bs-st").innerHTML = `<div class="small bad mt">${e(err.message)}</div>`; btn.disabled = false; }
      };
    };
    load();
  });
}

/* ---------- подстройка плана после недели ---------- */
function openAdapt(sk, w) {
  let mood = "норм";
  X.sheet(`<h2>Как прошла неделя ${w}?</h2>
    <div class="small muted mb">Система подстроит следующую неделю. План не отменяется — меняется только нагрузка.</div>
    ${chips("mood", [["легко", "Слишком легко"], ["норм", "Нормально"], ["тяжело", "Тяжело"]], mood)}
    <label class="f mt">Комментарий (необязательно)<textarea class="in" id="ad-c" rows="2" placeholder="Например: не успеваю по будням, больше практики"></textarea></label>
    <button class="btn violet block mt" id="ad-go">Подстроить</button><button class="btn ghost block mt" id="ad-skip">Оставить как есть</button><div id="ad-st"></div>`, (el, close) => {
    el.querySelectorAll("[data-chip]").forEach(c => c.onclick = () => { mood = c.dataset.val; el.querySelectorAll("[data-chip]").forEach(x => x.classList.toggle("on", x === c)); });
    el.querySelector("#ad-skip").onclick = close;
    el.querySelector("#ad-go").onclick = async () => {
      const c = el.querySelector("#ad-c").value.trim();
      if (mood === "норм" && !c) return close();
      busy(el.querySelector("#ad-st"), "Перестраиваю неделю…");
      try {
        const remaining = sk.plan.days.filter(d => d.day > w * 7 && d.day <= Math.min(30, (w + 1) * 7));
        const r = await ask("adapt", { skill: sk.plan.skill_name, final_project: sk.plan.final_project.title, feedback: mood, comment: c,
          done: skillStats(sk).done, weak: sk.plan.profile.weak, remaining });
        for (const nd of r.days || []) { const d = planDay(sk, +nd.day); if (d && d.day > w * 7) Object.assign(d, nd, { day: d.day, rest: d.rest }); }
        X.save(); close(); X.render(); X.toast(r.note || "План подстроен");
      } catch (err) { el.querySelector("#ad-st").innerHTML = `<div class="small bad mt">${e(err.message)}</div>`; }
    };
  });
}

/* ---------- завершение ---------- */
function finishSkill(sk) {
  const st = skillStats(sk);
  sk.status = "done"; sk.mastery = st.mastery; sk.doneAt = X.today();
  X.postEvent && X.postEvent("skill", `освоил навык «${sk.plan.skill_name}» на ${st.mastery}%`);
  X.save();
  X.system({ kind: "levelup", tag: "НАВЫК ОСВОЕН", head: `${sk.plan.skill_name} · Ур. ${sk.level}`,
    body: `Освоение: ${st.mastery}% · ранг навыка ${masteryRank(st.mastery)}\nВыполнено дней: ${st.done}/${st.need}\n\nТы больше не тот, кем начинал.` });
}
