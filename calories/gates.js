// ARISE — «Врата недели»: каждую неделю у всех открываются одни и те же Врата (по номеру недели) + один рейд для команды.
// Прогресс считается по дням недели после входа. Награда — XP и редкий титул, провал — «Прорыв подземелья» (штраф).

let X; // { S(), save, api, esc, today, addDays, parseD, system, toast, render, postEvent, sheet }
export function initGates(ctx) { X = ctx; }

const RANK_XP = { E: 50, D: 90, C: 130, B: 180, A: 260, S: 450 };
export const GATES = [
  { id: "soda", rank: "E", n: "Врата Сахарной Реки", d: "3 дня без газировки и сладких напитков", type: "check", need: 3 },
  { id: "log4", rank: "E", n: "Пещера Летописца", d: "4 дня с учётом питания", type: "auto", key: "log", need: 4 },
  { id: "sweet", rank: "D", n: "Логово Сладкого Демона", d: "5 дней без сладкого", type: "check", need: 5 },
  { id: "train3", rank: "D", n: "Тренировочный Лабиринт", d: "3 тренировки Системы за неделю", type: "auto", key: "workout", need: 3 },
  { id: "fast", rank: "C", n: "Пещера Фастфуда", d: "5 дней без фастфуда", type: "check", need: 5 },
  { id: "norm5", rank: "C", n: "Испытание Баланса", d: "5 дней в норме калорий", type: "auto", key: "norm", need: 5 },
  { id: "train5", rank: "B", n: "Кузница Тела", d: "5 тренировок Системы за неделю", type: "auto", key: "workout", need: 5 },
  { id: "sleep", rank: "B", n: "Врата Тьмы", d: "6 дней отбой до 00:00", type: "check", need: 6 },
  { id: "perfect", rank: "A", n: "Цитадель Дисциплины", d: "5 идеальных дней (все квесты)", type: "auto", key: "all", need: 5 },
  { id: "iron", rank: "S", n: "Красные Врата", d: "7 дней: все квесты и ни грамма сладкого", type: "combo", key: "all", need: 7 },
];
export const RAIDS = [
  { id: "raid_ant", rank: "A", n: "Рейд: Остров Муравьёв", d: "Каждый участник — 4 тренировки Системы за неделю", type: "auto", key: "workout", need: 4, raid: true },
  { id: "raid_castle", rank: "A", n: "Рейд: Замок Демонов", d: "Каждый участник — 5 дней в норме калорий", type: "auto", key: "norm", need: 5, raid: true },
  { id: "raid_metro", rank: "B", n: "Рейд: Подземка", d: "Каждый участник — 6 дней с учётом питания", type: "auto", key: "log", need: 6, raid: true },
];
const gateXp = g => RANK_XP[g.rank] + (g.raid ? 80 : 0);

/* ---------- неделя и выбор Врат ---------- */
export function weekStart(d) { const wd = (X.parseD(d).getDay() + 6) % 7; return X.addDays(d, -wd); }
function seeded(n) { let x = Math.sin(n * 9301 + 49297) * 233280; return x - Math.floor(x); }
export function weekGates(ws) {
  const n = Math.round(X.parseD(ws).getTime() / 6048e5);
  const pick = (list, k) => list[Math.floor(seeded(n * 7 + k) * list.length)];
  return [
    pick(GATES.filter(g => "ED".includes(g.rank)), 1),
    pick(GATES.filter(g => "CB".includes(g.rank)), 2),
    pick(GATES.filter(g => "AS".includes(g.rank)), 3),
    pick(RAIDS, 4),
  ].map(g => ({ ...g, key: `${g.id}@${ws}`, ws, we: X.addDays(ws, 6), xp: gateXp(g) }));
}

/* ---------- прогресс ---------- */
function dayOk(g, run, d, P) {
  const day = P.days[d];
  const checked = (run.checks || []).includes(d);
  const auto = !!day && (g.key === "all" ? day.all : !!(day.q[g.key] && day.q[g.key].done));
  if (g.type === "check") return checked;
  if (g.type === "combo") return auto && checked;
  return auto;
}
export function gateProgress(g, run, P) {
  if (!run) return 0;
  const td = X.today(); let k = 0;
  for (let d = run.joined > g.ws ? run.joined : g.ws; d <= g.we && d <= td; d = X.addDays(d, 1)) if (dayOk(g, run, d, P)) k++;
  return k;
}
const daysLeft = (g, run) => { const td = X.today(); let n = 0; for (let d = td > g.ws ? td : g.ws; d <= g.we; d = X.addDays(d, 1)) n++; return n; };

/* ---------- расчёт наград/штрафов (вызывается после computeProgress) ---------- */
let raidCache = { key: null, runs: [], at: 0 };
export async function settleGates(P) {
  const S = X.S(); S.gates = S.gates || {}; S.adj = S.adj || []; S.extraTitles = S.extraTitles || [];
  const td = X.today(); let changed = false;
  const weeks = [weekStart(td), weekStart(X.addDays(td, -7))];
  for (const ws of weeks) for (const g of weekGates(ws)) {
    const run = S.gates[g.key]; if (!run || run.status === "done" || run.status === "failed") continue;
    const prog = gateProgress(g, run, P);
    if (run.progress !== prog) { run.progress = prog; changed = true; if (g.raid) syncRaid(g, run); }
    if (!g.raid && prog >= g.need) { reward(g, run); changed = true; continue; }
    if (g.raid && prog >= g.need && run.own !== "done") { run.own = "done"; syncRaid(g, run); changed = true;
      X.system({ tag: "РЕЙД", head: "Твоя часть выполнена", body: `${g.n}\nЖдём остальных участников до конца недели.` }); }
    if (td > g.we) {
      if (g.raid) { await settleRaid(g, run); changed = true; }
      else { fail(g, run); changed = true; }
    }
  }
  if (changed) X.save();
}
function reward(g, run) {
  const S = X.S();
  run.status = "done"; run.doneAt = X.today();
  S.adj.push({ date: X.today(), xp: g.xp, why: `Врата: ${g.n}` });
  const tid = "gate_" + g.id;
  if (!S.extraTitles.some(t => t.id === tid)) S.extraTitles.push({ id: tid, ic: g.rank, n: g.raid ? `Рейдер: ${g.n.replace("Рейд: ", "")}` : `Покоритель: ${g.n}`, d: `Врата ранга ${g.rank}: ${g.d}` });
  X.system({ kind: "achv", tag: g.raid ? "РЕЙД ЗАВЕРШЁН" : "ВРАТА ЗАКРЫТЫ", head: g.n, body: `+${g.xp} XP\nНовый титул: «${g.raid ? "Рейдер" : "Покоритель"}: ${g.n.replace("Рейд: ", "")}»` });
  X.postEvent("gate", `${g.raid ? "завершил рейд" : "закрыл Врата ранга " + g.rank} «${g.n.replace("Рейд: ", "")}»`);
}
function fail(g, run) {
  const S = X.S(), pen = -Math.round(g.xp / 2);
  run.status = "failed";
  S.adj.push({ date: X.addDays(g.we, 1) <= X.today() ? X.addDays(g.we, 1) : X.today(), xp: pen, why: `Прорыв: ${g.n}` });
  X.system({ kind: "penalty", tag: "ПРОРЫВ ПОДЗЕМЕЛЬЯ", head: g.n, body: `Врата не закрыты вовремя.\n${pen} XP`, btn: "Понятно" });
  X.postEvent("gate", `провалил Врата «${g.n.replace("Рейд: ", "")}» — прорыв подземелья`);
}
async function settleRaid(g, run) {
  try {
    const d = await X.api("gate_runs", { keys: [g.key] });
    const runs = d.runs || [];
    const all = runs.length > 0 && runs.every(r => r.status === "done" || r.progress >= g.need);
    if (all) reward(g, run); else fail(g, run);
  } catch { /* офлайн — попробуем позже */ }
}
function syncRaid(g, run) {
  if (!X.S().player) return;
  X.api("gate_update", { token: X.S().player.token, key: g.key, progress: run.progress || 0, status: run.own === "done" ? "done" : "active" }).catch(() => {});
}
async function loadRaid(g) {
  if (raidCache.key === g.key && Date.now() - raidCache.at < 60000) return raidCache.runs;
  try { const d = await X.api("gate_runs", { keys: [g.key] }); raidCache = { key: g.key, runs: d.runs || [], at: Date.now() }; } catch { /* офлайн */ }
  return raidCache.runs;
}

/* ---------- окно на «Статусе» ---------- */
export function gatesWin(P) {
  const S = X.S(), td = X.today(), list = weekGates(weekStart(td));
  const rows = list.map(g => {
    const run = (S.gates || {})[g.key];
    const prog = run ? gateProgress(g, run, P) : 0, left = daysLeft(g, run);
    const st = !run ? "new" : run.status === "done" ? "done" : run.status === "failed" ? "failed" : "active";
    const canCheck = run && st === "active" && (g.type === "check" || g.type === "combo") && !(run.checks || []).includes(td);
    return `<div class="gate-row ${st}">
      <div class="rank-mini rank-${g.rank}">${g.rank}</div>
      <div class="grow" style="min-width:0">
        <div class="gr-n">${X.esc(g.n)}</div>
        <div class="tiny muted">${X.esc(g.d)} · +${g.xp} XP</div>
        ${run ? `<div class="bar ${g.raid ? "violet" : ""}" style="margin-top:6px"><i style="width:${Math.min(100, prog / g.need * 100)}%"></i></div>
          <div class="tiny ${st === "done" ? "ok" : st === "failed" ? "bad" : "muted"}" style="margin-top:3px">${st === "done" ? "✓ Закрыты" : st === "failed" ? "✕ Прорыв" : `${prog}/${g.need} · осталось дней: ${left}`}${g.raid && run.own === "done" && st === "active" ? " · твоя часть готова" : ""}</div>` : ""}
        ${g.raid && run ? `<div class="raid-m" data-raid="${g.key}"></div>` : ""}
      </div>
      <div class="gr-act">
        ${st === "new" ? (left >= g.need ? `<button class="btn sm violet" data-gjoin="${g.key}">Войти</button>` : `<span class="tiny dim">не успеть</span>`) : ""}
        ${canCheck ? `<button class="btn sm" data-gcheck="${g.key}">Сегодня ✓</button>` : ""}
      </div></div>`;
  }).join("");
  return `<div class="win violet mt"><div class="win-h">Врата недели<span class="right">до ${X.parseD(list[0].we).getDate()}.${String(X.parseD(list[0].we).getMonth() + 1).padStart(2, "0")}</span></div>
    <div class="tiny muted mb">Закрыл — XP и редкий титул. Вошёл и не закрыл — прорыв подземелья (штраф). В рейде проигрывают все, если провалит хоть один.</div>${rows}</div>`;
}
export function bindGates($app, P) {
  const S = X.S(), td = X.today(), list = weekGates(weekStart(td));
  $app.querySelectorAll("[data-gjoin]").forEach(b => b.onclick = () => {
    const g = list.find(x => x.key === b.dataset.gjoin);
    X.sheet(`<div class="center"><div class="rank-mini rank-${g.rank}" style="margin:0 auto;width:48px;height:48px;font-size:24px">${g.rank}</div>
        <div class="sys-font mt" style="font-size:19px;color:#fff">${X.esc(g.n)}</div>
        <div class="small mt">${X.esc(g.d)}</div>
        <div class="notice mt" style="text-align:left">Награда: +${g.xp} XP и титул.<br>Если до воскресенья не закроешь — прорыв: ${-Math.round(g.xp / 2)} XP.${g.raid ? "<br>Рейд: проваливают все, если не справится хоть один участник." : ""}${g.type !== "auto" ? "<br>Каждый выполненный день отмечай кнопкой «Сегодня ✓» — честно." : "<br>Дни засчитываются автоматически."}</div>
        <button class="btn-epic block mt" id="gj-go">Войти во Врата</button><button class="btn ghost block mt" id="gj-no">Не сейчас</button></div>`, (el, close) => {
      el.querySelector("#gj-no").onclick = close;
      el.querySelector("#gj-go").onclick = () => {
        S.gates = S.gates || {};
        S.gates[g.key] = { joined: td, checks: [], status: "active", progress: 0 };
        X.save(); close();
        if (g.raid) syncRaid(g, S.gates[g.key]);
        X.postEvent("gate", `вошёл во Врата ранга ${g.rank} «${g.n.replace("Рейд: ", "")}»`);
        X.system({ tag: "ВРАТА ОТКРЫТЫ", head: g.n, body: "Пути назад нет. Закрой Врата до конца недели." });
        X.render();
      };
    });
  });
  $app.querySelectorAll("[data-gcheck]").forEach(b => b.onclick = () => {
    const run = S.gates[b.dataset.gcheck];
    if (!confirm("Подтверждаешь, что сегодня условие выполнено? Система доверяет охотникам.")) return;
    run.checks = [...new Set([...(run.checks || []), td])]; X.save(); X.render();
  });
  $app.querySelectorAll("[data-raid]").forEach(async el => {
    const g = list.find(x => x.key === el.dataset.raid);
    const runs = await loadRaid(g);
    el.innerHTML = runs.length ? runs.map(r => `<span class="raid-p ${r.status === "done" || r.progress >= g.need ? "ok" : ""}">${X.esc(r.players ? r.players.name : "?")} ${r.progress}/${g.need}</span>`).join("") : "";
  });
}
