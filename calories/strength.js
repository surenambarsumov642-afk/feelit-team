// Ingot — программа «Турник и брусья»: прогрессия по ступеням от нуля до полноценных подтягиваний и отжиманий на брусьях.
// Каждая ступень — упражнение и лестница норм (подходы × повторы или секунды).
// Сделал все подходы 2 тренировки подряд → норма растёт. Прошёл последнюю норму → следующая ступень.
// «Тяжело» 2 раза подряд → норма на шаг назад. Отдых между тренировками — 48 часов: мышцы растут во время отдыха.

let X; // { S(), save, sheet, system, toast, render, esc, today, addDays, parseD }
export function initStrength(ctx) { X = ctx; }

const XP_SESSION = 40;
const REST_DAYS = 2;

// t: "reps" — повторы, "sec" — секунды. steps: [подходы, норма].
export const PROGRAMS = {
  pull: {
    n: "Подтягивания обратным хватом", short: "Турник",
    note: "Обратный хват (ладони к себе) сильнее нагружает бицепс, и с него проще начать.",
    stages: [
      { n: "Вис на турнике", t: "sec", steps: [[3, 15], [3, 20], [3, 30], [3, 40]],
        how: ["Возьмись обратным хватом на ширине плеч.", "Повисни на прямых руках, плечи не «в ушах» — чуть опусти их вниз.", "Дыши спокойно. Это укрепляет хват и связки."] },
      { n: "Лопаточные подтягивания", t: "reps", steps: [[3, 6], [3, 8], [3, 10], [3, 12]],
        how: ["Из виса на прямых руках сведи лопатки вниз и назад — тело чуть поднимется.", "Руки не сгибай: работают только лопатки.", "Вернись в вис медленно. Это база любого подтягивания."] },
      { n: "Австралийские подтягивания", t: "reps", steps: [[3, 6], [3, 8], [3, 10], [3, 12], [3, 15]],
        how: ["Низкая перекладина на уровне пояса (или стол, кольца, турник пониже).", "Ляг под неё, тело прямое, пятки на полу, хват обратный.", "Тянись грудью к перекладине, опускайся медленно. Чем ниже перекладина — тем тяжелее."] },
      { n: "Подтягивания с прыжка", t: "reps", steps: [[3, 3], [3, 4], [3, 5], [3, 6], [3, 8]],
        how: ["Встань под турником, возьмись обратным хватом.", "Оттолкнись ногами и помоги себе руками подняться подбородком над перекладиной.", "Опускайся медленно, 2–3 секунды. Ноги помогают меньше с каждой неделей."] },
      { n: "Негативы", t: "reps", steps: [[3, 2], [3, 3], [3, 4], [3, 5], [3, 6]],
        how: ["Запрыгни или встань на опору так, чтобы подбородок был над перекладиной.", "Опускайся максимально медленно: считай до 5.", "Внизу встань на ноги и повтори. Именно негативы быстрее всего дают первое подтягивание."] },
      { n: "Подтягивания обратным хватом", t: "reps", steps: [[3, 1], [3, 2], [3, 3], [3, 4], [3, 5], [3, 6], [3, 8], [3, 10]],
        how: ["Из виса на прямых руках сначала сведи лопатки, потом тянись.", "Подбородок над перекладиной, без рывков и раскачки.", "Опускайся до прямых рук. Не получается последний повтор — сделай его негативом."] },
    ],
  },
  dip: {
    n: "Отжимания на брусьях", short: "Брусья",
    note: "Безопасная глубина — пока плечо не окажется на уровне локтя (угол 90°). Глубже не нужно.",
    stages: [
      { n: "Упор на брусьях", t: "sec", steps: [[3, 10], [3, 15], [3, 20], [3, 30]],
        how: ["Запрыгни в упор на прямых руках.", "Плечи опущены вниз, грудь вперёд, корпус прямой.", "Держи позицию. Это учит плечи стабильности."] },
      { n: "Обратные отжимания от скамьи", t: "reps", steps: [[3, 8], [3, 10], [3, 12], [3, 15]],
        how: ["Руки на скамье или стуле сзади, ноги согнуты, пятки на полу.", "Опускайся, сгибая локти назад, до 90°.", "Выпрямляй руки. Выпрямишь ноги — станет тяжелее."] },
      { n: "Негативы на брусьях", t: "reps", steps: [[3, 3], [3, 4], [3, 5], [3, 6]],
        how: ["Из упора на прямых руках опускайся медленно, считая до 4–5.", "Остановись, когда плечо на уровне локтя.", "Встань на ноги, снова запрыгни в упор и повтори."] },
      { n: "Брусья в половину амплитуды", t: "reps", steps: [[3, 3], [3, 5], [3, 6], [3, 8]],
        how: ["Опускайся только наполовину — локти примерно 120°.", "Поднимайся до прямых рук без рывка.", "С каждой неделей опускайся чуть глубже."] },
      { n: "Отжимания на брусьях", t: "reps", steps: [[3, 3], [3, 4], [3, 5], [3, 6], [3, 8], [3, 10], [3, 12]],
        how: ["Опускайся, пока плечо не на уровне локтя (90°).", "Корпус слегка наклонён вперёд, локти назад, не в стороны.", "Поднимайся до прямых рук. Боль в плече — сразу стоп."] },
    ],
  },
};

const st = () => { const S = X.S(); return (S.strength = S.strength || { on: false, pull: null, dip: null, log: [] }); };
export const strengthOn = () => !!(X.S().strength && X.S().strength.on);
const cur = k => st()[k];
const stage = k => PROGRAMS[k].stages[cur(k).stage];
const target = k => stage(k).steps[cur(k).step];
const fmt = (t, [sets, v]) => `${sets} × ${v}${t === "sec" ? " сек" : ""}`;
const lastDate = () => (st().log || []).map(l => l.date).sort().pop() || null;
/** Сегодня день турника? Тренировка — через день (48 часов отдыха). */
export function strengthDue() {
  if (!strengthOn()) return false;
  const l = lastDate();
  if (!l) return true;
  if (l === X.today()) return false;
  return X.addDays(l, REST_DAYS) <= X.today();
}
export const strengthDoneToday = () => (st().log || []).some(l => l.date === X.today());
export function strengthXpByDate() {
  const r = {};
  for (const l of st().log || []) if (l.xp) r[l.date] = (r[l.date] || 0) + l.xp;
  return r;
}
/** Короткая строка для экрана «Сегодня». */
export function strengthSummary() {
  if (!strengthOn()) return "";
  return ["pull", "dip"].filter(k => cur(k)).map(k => `${PROGRAMS[k].short}: ${stage(k).n.toLowerCase()} ${fmt(stage(k).t, target(k))}`).join(" · ");
}

/* ---------- первый запуск: проверка уровня ---------- */
const START = {
  pull: [["Не могу провисеть 15 секунд", 0], ["Вишу, но подтянуться не могу", 2], ["Подтягиваюсь только с прыжка", 3], ["1–2 раза сам", 5], ["3 и больше", 5]],
  dip: [["Не могу удержаться в упоре", 0], ["Держусь в упоре, но опуститься не могу", 2], ["Опускаюсь только чуть-чуть", 3], ["1–3 полных раза", 4], ["4 и больше", 4]],
};
const START_STEP = { pull: { "3 и больше": 2 }, dip: { "4 и больше": 1 } };

export function openStrength() {
  const S = st();
  if (!S.on) return openSetup();
  X.sheet(`<div id="str"></div>`, (el, close) => draw(el, close));
}

function openSetup() {
  const pick = { pull: null, dip: null };
  X.sheet(`<div id="str-setup"></div>`, (el, close) => {
    const d = () => {
      el.querySelector("#str-setup").innerHTML = `<div class="tag-sys">НОВАЯ ПРОГРАММА</div><h2 style="margin:6px 0 4px">Турник и брусья</h2>
        <div class="small muted mb">Система подберёт ступень под твой уровень и будет повышать нагрузку, только когда ты действительно готов. Тренировка — через день, 15–20 минут.</div>
        ${["pull", "dip"].map(k => `<div class="win"><div class="win-h">${PROGRAMS[k].n}</div><div class="tiny muted mb">Что получается сейчас?</div>
          <div class="onb-chips">${START[k].map(([n]) => `<button class="chip-b ${pick[k] === n ? "on" : ""}" data-sp="${k}" data-sv="${X.esc(n)}">${X.esc(n)}</button>`).join("")}
          <button class="chip-b ${pick[k] === "skip" ? "on" : ""}" data-sp="${k}" data-sv="skip">Нет доступа</button></div></div>`).join("")}
        <button class="btn-epic block mt" id="str-go" style="width:100%" ${pick.pull && pick.dip && !(pick.pull === "skip" && pick.dip === "skip") ? "" : "disabled"}>Начать программу</button>`;
      el.querySelectorAll("[data-sp]").forEach(b => b.onclick = () => { pick[b.dataset.sp] = b.dataset.sv; d(); });
      const go = el.querySelector("#str-go");
      go.onclick = () => {
        const S = st(); S.on = true; S.log = S.log || [];
        for (const k of ["pull", "dip"]) {
          if (pick[k] === "skip") { S[k] = null; continue; }
          const stg = START[k].find(x => x[0] === pick[k])[1];
          S[k] = { stage: stg, step: (START_STEP[k] || {})[pick[k]] || 0, ok: 0, hard: 0 };
        }
        X.save(); close(); X.render();
        X.system({ kind: "achv", tag: "ПРОГРАММА ПРИНЯТА", head: "Турник и брусья",
          body: ["pull", "dip"].filter(k => S[k]).map(k => `${PROGRAMS[k].short}: «${stage(k).n}» — ${fmt(stage(k).t, target(k))}`).join("\n") + "\n\nТренируйся через день. Сделал все подходы дважды — Система поднимет норму.", btn: "Начать" });
        openStrength();
      };
    };
    d();
  });
}

/* ---------- тренировка ---------- */
function draw(el, close) {
  const S = st(), today = X.today(), due = strengthDue(), doneToday = strengthDoneToday();
  const sets = S._sets && S._sets.date === today ? S._sets : (S._sets = { date: today, pull: [], dip: [] });
  const block = k => {
    if (!S[k]) return "";
    const P = PROGRAMS[k], sg = stage(k), [n, v] = target(k), total = sg.steps.length, done = sets[k] || [];
    const stageNo = S[k].stage + 1, stages = P.stages.length;
    return `<div class="win str-win"><div class="win-h">${P.n}<span class="right">ступень ${stageNo}/${stages}</span></div>
      <div class="str-stage">${X.esc(sg.n)}</div>
      <div class="str-target">${fmt(sg.t, [n, v])}<span class="tiny muted"> · норма ${S[k].step + 1}/${total}</span></div>
      <div class="str-ladder">${P.stages.map((s2, i) => `<i class="${i < S[k].stage ? "past" : i === S[k].stage ? "now" : ""}" title="${X.esc(s2.n)}"></i>`).join("")}</div>
      <details class="rule"><summary>Как делать</summary><ol class="small">${sg.how.map(h => `<li>${X.esc(h)}</li>`).join("")}</ol>${P.note ? `<div class="tiny muted">${X.esc(P.note)}</div>` : ""}</details>
      <div class="tiny muted mt mb">Отметь каждый подход:</div>
      <div class="str-sets">${Array.from({ length: n }, (_, i) => `<button class="str-set ${done[i] ? "on" : ""}" data-set="${k}" data-i="${i}">${done[i] ? "✓" : `${i + 1}`}<small>${v}${sg.t === "sec" ? "с" : ""}</small></button>`).join("")}</div>
      <div class="tiny muted mt">Отдых между подходами 1,5–2 минуты.</div></div>`;
  };
  el.querySelector("#str").innerHTML = `<div class="tag-sys">СИЛА · ПРОГРЕССИЯ</div><h2 style="margin:6px 0 4px">Турник и брусья</h2>
    <div class="small ${due || doneToday ? "muted" : "bad"} mb">${doneToday ? "Сегодня тренировка уже засчитана. Завтра — отдых." : due ? "Сегодня день силы. 15–20 минут." : `Сегодня отдых: мышцы растут, пока ты восстанавливаешься. Следующая тренировка — ${X.addDays(lastDate(), REST_DAYS) === X.addDays(today, 1) ? "завтра" : "послезавтра"}.`}</div>
    ${block("pull")}${block("dip")}
    ${doneToday ? "" : `<button class="btn-epic block mt" id="str-done" style="width:100%">Завершить тренировку</button>
    <button class="btn ghost block mt" id="str-hard">Было слишком тяжело</button>`}
    <button class="btn ghost block mt" id="str-reset" style="opacity:.7">Изменить уровень / выключить программу</button>`;
  el.querySelectorAll("[data-set]").forEach(b => b.onclick = () => {
    const k = b.dataset.set, i = +b.dataset.i; sets[k] = sets[k] || []; sets[k][i] = !sets[k][i]; X.save(); draw(el, close);
  });
  const fin = el.querySelector("#str-done"); if (fin) fin.onclick = () => finish(false, close);
  const hard = el.querySelector("#str-hard"); if (hard) hard.onclick = () => finish(true, close);
  el.querySelector("#str-reset").onclick = () => {
    if (!confirm("Пройти проверку уровня заново? Текущие ступени сбросятся (история и XP останутся).")) return;
    const S2 = st(); S2.on = false; S2.pull = null; S2.dip = null; X.save(); close(); X.render(); openSetup();
  };
}

function finish(hardAll, close) {
  const S = st(), today = X.today(), sets = S._sets || { pull: [], dip: [] };
  const res = {}, ups = [];
  for (const k of ["pull", "dip"]) {
    if (!S[k]) continue;
    const [n] = target(k), done = (sets[k] || []).filter(Boolean).length, all = done >= n;
    res[k] = { stage: S[k].stage, step: S[k].step, done, of: n };
    if (all && !hardAll) {
      S[k].ok++; S[k].hard = 0;
      if (S[k].ok >= 2) {
        S[k].ok = 0;
        if (S[k].step < stage(k).steps.length - 1) { S[k].step++; ups.push(`${PROGRAMS[k].short}: норма выросла — ${fmt(stage(k).t, target(k))}`); }
        else if (S[k].stage < PROGRAMS[k].stages.length - 1) { S[k].stage++; S[k].step = 0; ups.push(`${PROGRAMS[k].short}: новая ступень — «${stage(k).n}» ${fmt(stage(k).t, target(k))}`); }
        else ups.push(`${PROGRAMS[k].short}: вершина программы. Держи форму или добавь вес.`);
      }
    } else {
      S[k].ok = 0; S[k].hard++;
      if (S[k].hard >= 2) {
        S[k].hard = 0;
        if (S[k].step > 0) { S[k].step--; ups.push(`${PROGRAMS[k].short}: норма чуть снижена — ${fmt(stage(k).t, target(k))}. Это нормально: шаг назад, чтобы прыгнуть дальше.`); }
      }
    }
  }
  const any = Object.values(res).some(r => r.done > 0);
  if (!any && !hardAll) return X.toast("Отметь хотя бы один сделанный подход", true);
  S.log = S.log || [];
  S.log.push({ date: today, res, hard: hardAll, xp: XP_SESSION });
  S._sets = null;
  X.save(); close(); X.render();
  X.system({ kind: ups.some(u => u.includes("ступень")) ? "levelup" : "quest", tag: "СИЛА", head: ups.some(u => u.includes("ступень")) ? "Новая ступень" : "Тренировка засчитана",
    body: `+${XP_SESSION} XP\n\n${ups.length ? ups.join("\n") : hardAll ? "Тяжело — значит, нагрузка настоящая. Ещё одна такая тренировка — и Система снизит норму." : "Сделай так же в следующий раз — и норма вырастет."}\n\nЗавтра отдых: сила растёт во время восстановления.`, btn: "Принять" });
}
