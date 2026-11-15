// Ingot — «Выход в мир»: применение навыка для других людей и первые деньги.
// Ступени по уровню навыка: 1 — на себе и своих; 2 — карта применения, портфолио, предложение, тренажёр, первые сообщения;
// 3 — первые проекты и первые деньги; 4+ — рост. Без спама и обещаний дохода: сообщения отправляет сам человек.

let X; // { S(), save, api, sheet, system, toast, esc, today, addDays, render, postEvent }
export function initWorld(ctx) { X = ctx; }
const e = s => X.esc(s);
const ask = (kind, ctx) => X.api("skill", { token: X.S().player.token, kind, ctx });

const STATUSES = [["plan", "В планах"], ["sent", "Написал"], ["replied", "Ответил"], ["talk", "Переговоры"], ["deal", "Заказ"], ["no", "Отказ"]];
const SN = Object.fromEntries(STATUSES);
const TIERS = [
  null,
  { n: "На себе и своих", d: "Навык должен работать в жизни, а не в тетради. Сначала — для себя и близких." },
  { n: "Карта и первые шаги", d: "Кому это нужно, сколько стоит, где искать. Портфолио, предложение, первые сообщения." },
  { n: "Первые деньги", d: "Первые проекты для других людей, отзывы и первый платный заказ." },
  { n: "Рост", d: "Стабильные заказы, постоянные клиенты, цена выше." },
];

function W(chain) {
  const S = X.S(); S.world = S.world || {};
  return S.world[chain] = S.world[chain] || { quests: {}, contacts: [], sims: [], debriefs: [], map: null };
}
const skillsOf = chain => (X.S().skills || []).filter(s => (s.chain || s.id) === chain && s.plan);
const tierOf = chain => Math.min(4, Math.max(1, ...skillsOf(chain).filter(s => s.status === "done" || (s.status === "active" && (s.level || 1) > 1)).map(s => s.level || 1)));
const paid = w => w.debriefs.filter(d => d.paid > 0);

/** Квесты реального мира. auto(w) — выполняется сам по данным; иначе нужно доказательство. */
const QUESTS = [
  { id: "w_self", t: 1, xp: 30, n: "Применить навык для себя", d: "Сделай реальную вещь, которой пользуешься сам. Опиши, что сделал." },
  { id: "w_friend", t: 1, xp: 40, n: "Помочь близкому", d: "Сделай что-то полезное другу или родственнику своим навыком." },
  { id: "w_show3", t: 1, xp: 30, n: "Показать трём людям", d: "Покажи результат трём людям и спроси честное мнение. Что сказали?" },
  { id: "w_map", t: 2, xp: 20, n: "Составить карту применения", d: "Кому нужен навык, сколько стоит, где искать.", auto: w => !!w.map },
  { id: "w_portfolio", t: 2, xp: 60, n: "Собрать портфолио", d: "3 лучшие работы в одном месте (Telegram-канал, Instagram, папка). Ссылка или описание." },
  { id: "w_offer", t: 2, xp: 40, n: "Сформулировать предложение", d: "Короткий текст: что делаешь, для кого, результат, цена. Вставь свой текст." },
  { id: "w_sim", t: 2, xp: 60, n: "Переговоры в тренажёре на 70+", d: "Проведи переговоры с ИИ-клиентом и получи 70 баллов.", auto: w => w.sims.some(x => x.score >= 70) },
  { id: "w_send5", t: 2, xp: 80, n: "Отправить 5 предложений", d: "Сам, вежливо, без спама. Учёт — в «Контактах».", auto: w => w.contacts.filter(c => c.status !== "plan").length >= 5 },
  { id: "w_reply", t: 2, xp: 60, n: "Получить первый ответ", d: "Отметь в «Контактах», когда кто-то ответит.", auto: w => w.contacts.some(c => ["replied", "talk", "deal"].includes(c.status)) },
  { id: "w_project", t: 3, xp: 100, n: "Первый проект для другого человека", d: "Можно бесплатно или за отзыв. Засчитается после разбора работы.", auto: w => w.debriefs.length >= 1 },
  { id: "w_review", t: 3, xp: 80, n: "Получить отзыв", d: "Попроси клиента написать пару слов. Вставь текст отзыва." },
  { id: "w_paid", t: 3, xp: 200, n: "Первый платный заказ", d: "Засчитается после разбора работы с суммой оплаты.", auto: w => paid(w).length >= 1 },
  { id: "w_paid3", t: 4, xp: 200, n: "Три платных заказа", d: "Стабильность важнее одного успеха.", auto: w => paid(w).length >= 3 },
  { id: "w_price", t: 4, xp: 150, n: "Поднять цену", d: "Возьми заказ дороже первого.", auto: w => paid(w).length >= 2 && Math.max(...paid(w).slice(1).map(d => d.paid)) > paid(w)[0].paid },
  { id: "w_regular", t: 4, xp: 150, n: "Постоянный клиент", d: "Два заказа от одного клиента.", auto: w => { const m = {}; for (const d of w.debriefs) { const k = (d.client || "").trim().toLowerCase(); if (k) m[k] = (m[k] || 0) + 1; } return Object.values(m).some(v => v >= 2); } },
];

/** Засчитать квест (один раз): XP через корректировки, событие в ленту, окно Системы. */
function complete(w, q, proof) {
  if (w.quests[q.id]) return false;
  w.quests[q.id] = { at: X.today(), proof: proof || "" };
  const S = X.S(); S.adj = S.adj || [];
  S.adj.push({ date: X.today(), xp: q.xp, why: "Выход в мир: " + q.n });
  X.postEvent && X.postEvent("world", `выполнил квест реального мира: ${q.n}`);
  X.system({ kind: q.t >= 3 ? "rank" : "achv", rarity: q.t + 1, icon: "🌍", tag: "КВЕСТ РЕАЛЬНОГО МИРА", head: q.n, body: `+${q.xp} XP\n\nМир заметил тебя. Это только начало.`, btn: "Дальше" });
  return true;
}
function autoCheck(chain) {
  const w = W(chain), tier = tierOf(chain); let ch = false;
  for (const q of QUESTS) if (q.t <= tier && q.auto && q.auto(w) && complete(w, q)) ch = true;
  if (ch) X.save();
}

/** Напоминания по контактам на сегодня (для экрана «Статус»). */
export function worldDue() {
  const td = X.today(), out = [];
  for (const [chain, w] of Object.entries(X.S().world || {})) for (const c of w.contacts || [])
    if (c.next && c.next <= td && !["deal", "no"].includes(c.status)) out.push({ chain, c });
  return out;
}

/* ============================ экран ============================ */
export function renderWorld($app, chain, back) {
  const sk = skillsOf(chain).sort((a, b) => (b.level || 1) - (a.level || 1))[0];
  if (!sk) { back(); return; }
  autoCheck(chain);
  const w = W(chain), tier = tierOf(chain), td = X.today();
  const due = w.contacts.filter(c => c.next && c.next <= td && !["deal", "no"].includes(c.status));
  const earned = paid(w).reduce((a, d) => a + d.paid, 0);
  const tierQ = t => QUESTS.filter(q => q.t === t);
  $app.innerHTML = `<div class="screen-title"><button class="icon-btn" id="w-back">‹</button><h1 style="margin-left:8px">Выход в мир</h1><span class="sub">${e(sk.plan.skill_name)}</span></div>
    <div class="win world-hero"><div class="tag-sys">СТУПЕНЬ ${tier} · ${e(TIERS[tier].n.toUpperCase())}</div>
      <div class="small mt">${e(TIERS[tier].d)}</div>
      <div class="world-stats"><div><b>${Object.keys(w.quests).length}</b><span>квестов</span></div><div><b>${w.contacts.filter(c => c.status !== "plan").length}</b><span>предложений</span></div>
        <div><b>${w.debriefs.length}</b><span>проектов</span></div><div><b>${earned ? earned.toLocaleString("ru") : 0}</b><span>заработано</span></div></div>
      <div class="tiny dim mt">Никакого спама и обещаний дохода. Сообщения отправляешь ты сам, честно о своём уровне.</div></div>
    ${due.length ? `<div class="win" style="border-color:rgba(255,194,74,.6)"><div class="win-h" style="color:#ffd77a">Сегодня написать</div>
      ${due.map(c => `<div class="recent" data-ct="${c.id}"><span class="nm">${e(c.name)} <span class="tiny muted">${SN[c.status]}</span></span><span class="kc">${e(c.where || "")}</span><span class="muted">›</span></div>`).join("")}</div>` : ""}
    ${[1, 2, 3, 4].map(t => `<div class="win ${t > tier ? "locked" : ""}"><div class="win-h">Ступень ${t}: ${e(TIERS[t].n)}${t > tier ? `<span class="right">🔒 Ур. ${t} навыка</span>` : ""}</div>
      ${tierQ(t).map(q => { const done = w.quests[q.id]; return `<div class="wq ${done ? "done" : ""}">
        <div class="wq-c">${done ? "✓" : q.auto ? "◇" : "○"}</div>
        <div class="grow"><div class="wq-n">${e(q.n)} <span class="tiny" style="color:var(--violet2)">+${q.xp} XP</span></div><div class="tiny muted">${e(q.d)}</div>
          ${done && done.proof ? `<div class="tiny dim">«${e(done.proof.slice(0, 120))}»</div>` : ""}</div>
        ${!done && !q.auto && t <= tier ? `<button class="btn sm" data-wq="${q.id}">Сдать</button>` : ""}</div>`; }).join("")}</div>`).join("")}
    ${tier >= 2 ? mapWin(w) : ""}
    ${tier >= 2 ? `<div class="win"><div class="win-h">Тренажёр переговоров<span class="right">${w.sims.length ? "лучший: " + Math.max(...w.sims.map(s => s.score)) : ""}</span></div>
      <div class="small mb">ИИ играет клиента: сомневается, торгуется, возражает. Научись отвечать до того, как напишет настоящий.</div>
      <button class="btn violet block" id="w-sim">Начать переговоры</button></div>` : ""}
    <div class="win"><div class="win-h">Контакты<span class="right">${w.contacts.length}</span></div>
      ${w.contacts.length ? w.contacts.map(c => `<div class="recent" data-ct="${c.id}"><span class="nm">${e(c.name)}<span class="tiny muted"> · ${e(c.where || "")}</span></span>
        <span class="kc st-${c.status}">${SN[c.status]}${c.next && !["deal", "no"].includes(c.status) ? " · " + c.next.slice(5).split("-").reverse().join(".") : ""}</span><span class="muted">›</span></div>`).join("")
        : `<div class="tiny muted mb">Каждый, кому предложил услугу. Система напомнит написать снова.</div>`}
      <button class="btn ghost block mt" id="w-add">+ Контакт</button></div>
    ${tier >= 2 ? `<div class="win"><div class="win-h">Разборы работ<span class="right">${w.debriefs.length}</span></div>
      ${w.debriefs.slice().reverse().map(d => `<div class="small mb"><b>${e(d.client || "клиент")}</b> · ${e(d.what)}${d.paid ? ` · <span class="ok">${d.paid.toLocaleString("ru")} ${e(d.cur || "")}</span>` : ""}
        ${d.ai ? `<div class="tiny muted">${e(d.ai.feedback)}</div>` : ""}</div>`).join("")}
      <button class="btn block" id="w-deb">Сделал работу — разобрать</button></div>` : ""}`;
  $app.querySelector("#w-back").onclick = back;
  $app.querySelectorAll("[data-wq]").forEach(b => b.onclick = () => submitQuest(chain, QUESTS.find(q => q.id === b.dataset.wq)));
  $app.querySelectorAll("[data-ct]").forEach(b => b.onclick = () => editContact(chain, w.contacts.find(c => c.id === b.dataset.ct)));
  $app.querySelector("#w-add").onclick = () => editContact(chain, null);
  const g = id => $app.querySelector("#" + id);
  if (g("w-map")) g("w-map").onclick = () => buildMap(chain, sk, g("w-map"));
  if (g("w-sim")) g("w-sim").onclick = () => openSim(chain, sk);
  if (g("w-deb")) g("w-deb").onclick = () => openDebrief(chain, sk);
  $app.querySelectorAll("[data-copy]").forEach(b => b.onclick = () => {
    const t = b.closest(".msg").querySelector(".msg-t").textContent;
    (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => X.toast("Скопировано"), () => X.toast("Выдели текст и скопируй", true));
  });
}

function mapWin(w) {
  const m = w.map;
  if (!m) return `<div class="win violet"><div class="win-h">Карта применения</div>
    <div class="small mb">Система составит: кому нужен твой навык, какие услуги ты уже можешь делать и почём, где искать клиентов, готовые первые сообщения.</div>
    <button class="btn-epic block" id="w-map">Составить карту</button></div>`;
  return `<div class="win violet"><div class="win-h">Карта применения<span class="right"><a href="#" id="w-map" style="color:var(--violet2)">обновить</a></span></div>
    <div class="f">Кому это нужно</div>${m.who.map(x => `<div class="wm"><b>${e(x.who)}</b><div class="tiny">Боль: ${e(x.pain)}</div><div class="tiny muted">Где искать: ${e(x.where)}</div></div>`).join("")}
    <div class="f mt">Что ты уже можешь продать</div>${m.services.map(x => `<div class="kv"><span>${e(x.name)}<span class="tiny muted"> · ${e(x.time)}</span></span><b>${e(x.price)}</b></div>`).join("")}
    <div class="f mt">Портфолио без клиента</div><ul class="tiny">${m.portfolio.map(x => `<li>${e(x)}</li>`).join("")}</ul>
    <div class="f mt">Твоё предложение</div><div class="msg"><div class="msg-t small">${e(m.offer)}</div><button class="btn ghost sm" data-copy>Копировать</button></div>
    <div class="f mt">Первые сообщения</div>${m.messages.map(x => `<div class="msg"><div class="tiny" style="color:var(--violet2)">${e(x.to)}</div><div class="msg-t small">${e(x.text)}</div><button class="btn ghost sm" data-copy>Копировать</button></div>`).join("")}
    <div class="f mt">На этой неделе</div><ol class="tiny">${m.first_steps.map(x => `<li>${e(x)}</li>`).join("")}</ol>
    <div class="tiny warn mt">${e(m.warning)}</div></div>`;
}
async function buildMap(chain, sk, btn) {
  const w = W(chain);
  if (btn.tagName === "A") btn.textContent = "…"; else { btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> Система изучает рынок…`; }
  try {
    const done = skillsOf(chain).filter(s => s.status === "done");
    w.map = await ask("world_map", { skill: sk.plan.skill_name, level: sk.level || 1, mastery: Math.max(0, ...done.map(s => s.mastery || 0)),
      projects_done: done.map(s => s.plan.final_project.title), city: sk.answers.city || "Ташкент", device: sk.answers.device, direction: sk.answers.dir || "" });
    X.save(); X.render();
  } catch (err) { X.toast(err.message, true); X.render(); }
}

function submitQuest(chain, q) {
  X.sheet(`<h2>${e(q.n)}</h2><div class="small mb">${e(q.d)}</div>
    <label class="f">Доказательство<textarea class="in" id="wq-p" rows="4" placeholder="Что сделал, для кого, результат. Ссылка, если есть."></textarea></label>
    <div class="tiny dim">Система верит на слово. Но ты-то знаешь правду.</div>
    <button class="btn-epic block mt" id="wq-go">Сдать квест</button>`, (el, close) => {
    el.querySelector("#wq-go").onclick = () => {
      const p = el.querySelector("#wq-p").value.trim();
      if (p.length < 20) return X.toast("Опиши подробнее (хотя бы пару предложений)", true);
      complete(W(chain), q, p); X.save(); close(); X.render();
    };
  });
}

function editContact(chain, c) {
  const w = W(chain), isNew = !c;
  c = c || { id: Date.now().toString(36), name: "", where: "", status: "plan", next: X.addDays(X.today(), 1), note: "" };
  let st = c.status;
  X.sheet(`<h2>${isNew ? "Новый контакт" : e(c.name)}</h2>
    <label class="f">Кто<input class="in" id="ct-n" value="${e(c.name)}" placeholder="Кофейня «Бодрость», Дильноза (маникюр)…"></label>
    <label class="f">Где нашёл / как связаться<input class="in" id="ct-w" value="${e(c.where)}" placeholder="Instagram, Telegram, знакомый…"></label>
    <div class="f">Статус</div><div class="chips-row">${STATUSES.map(([k, n]) => `<button class="chip-b ${k === st ? "on" : ""}" data-st="${k}">${n}</button>`).join("")}</div>
    <label class="f mt">Напомнить<input class="in" id="ct-d" type="date" value="${c.next || ""}"></label>
    <label class="f">Заметка<textarea class="in" id="ct-t" rows="2">${e(c.note || "")}</textarea></label>
    <button class="btn block mt" id="ct-s">Сохранить</button>
    ${isNew ? "" : `<button class="btn ghost block mt" id="ct-del">Удалить</button>`}`, (el, close) => {
    el.querySelectorAll("[data-st]").forEach(b => b.onclick = () => {
      st = b.dataset.st; el.querySelectorAll("[data-st]").forEach(x => x.classList.toggle("on", x === b));
      // разумное напоминание по статусу
      const d = { plan: 1, sent: 3, replied: 1, talk: 2 }[st];
      el.querySelector("#ct-d").value = d ? X.addDays(X.today(), d) : "";
    });
    el.querySelector("#ct-s").onclick = () => {
      const name = el.querySelector("#ct-n").value.trim(); if (!name) return X.toast("Кто это?", true);
      Object.assign(c, { name, where: el.querySelector("#ct-w").value.trim(), status: st, next: el.querySelector("#ct-d").value || null, note: el.querySelector("#ct-t").value.trim() });
      if (isNew) w.contacts.push(c);
      X.save(); close(); X.render();
    };
    const del = el.querySelector("#ct-del");
    if (del) del.onclick = () => { if (!confirm("Удалить контакт?")) return; w.contacts = w.contacts.filter(x => x !== c); X.save(); close(); X.render(); };
  });
}

/* ---------- тренажёр переговоров ---------- */
function openSim(chain, sk) {
  const w = W(chain), m = w.map;
  const pool = m && m.who.length ? m.who : [{ who: "владелец небольшого бизнеса в Ташкенте", pain: "нет времени разбираться самому" }];
  const persona = pool[Math.floor(Math.random() * pool.length)];
  const service = { skill: sk.plan.skill_name, services: m ? m.services : [], offer: m ? m.offer : "" };
  const history = [];
  X.sheet(`<div class="tag-sys">ТРЕНАЖЁР</div><h2 style="margin-top:6px">Клиент: ${e(persona.who)}</h2>
    <div class="tiny muted mb">Узнай задачу, назови цену и сроки, ответь на возражения, договорись о следующем шаге.</div>
    <div class="chat" id="sim-c"></div>
    <div class="row mt" style="gap:8px"><textarea class="in grow" id="sim-i" rows="2" placeholder="Твой ответ клиенту…"></textarea><button class="btn" id="sim-s">➤</button></div>
    <button class="btn ghost block mt" id="sim-end" disabled>Завершить и получить оценку</button><div id="sim-r"></div>`, (el, close) => {
    const box = el.querySelector("#sim-c"), inp = el.querySelector("#sim-i"), send = el.querySelector("#sim-s"), end = el.querySelector("#sim-end");
    const draw = typing => {
      box.innerHTML = history.map(h => `<div class="bub ${h.role}">${e(h.text)}</div>`).join("") + (typing ? `<div class="bub client"><span class="spinner"></span></div>` : "");
      box.scrollTop = box.scrollHeight;
      end.disabled = history.filter(h => h.role === "me").length < 2;
    };
    const clientTurn = async () => {
      draw(true); send.disabled = true;
      try {
        const r = await ask("client_sim", { service, persona, history });
        history.push({ role: "client", text: r.reply }); draw(false);
        if (r.done) { inp.disabled = true; end.disabled = false; end.classList.replace("ghost", "violet"); }
      } catch (err) { X.toast(err.message, true); draw(false); }
      send.disabled = false;
    };
    send.onclick = () => {
      const t = inp.value.trim(); if (!t) return;
      history.push({ role: "me", text: t }); inp.value = ""; clientTurn();
    };
    end.onclick = async () => {
      end.disabled = true; send.disabled = true; inp.disabled = true;
      el.querySelector("#sim-r").innerHTML = `<div class="center mt"><span class="spinner"></span> <span class="small muted">Система оценивает переговоры…</span></div>`;
      try {
        const g = await ask("client_grade", { service, persona, history });
        w.sims.push({ score: Math.round(g.score), deal: g.deal, at: X.today() }); X.save();
        el.querySelector("#sim-r").innerHTML = `<div class="win mt"><div class="win-h">Оценка<span class="right sys-font" style="font-size:20px;color:#fff">${Math.round(g.score)}/100</span></div>
          <div class="small">${g.deal ? "✓ Договорились. " : "Сделки нет. "}${e(g.feedback)}</div>
          <ul class="tiny">${(g.better || []).map(x => `<li>${e(x)}</li>`).join("")}</ul>
          <button class="btn block mt" id="sim-ok">Готово</button></div>`;
        el.querySelector("#sim-ok").onclick = () => { close(); X.render(); };
      } catch (err) { el.querySelector("#sim-r").innerHTML = `<div class="small bad mt">${e(err.message)}</div>`; end.disabled = false; }
    };
    clientTurn();
  });
}

/* ---------- разбор после работы ---------- */
function openDebrief(chain, sk) {
  const w = W(chain);
  X.sheet(`<h2>Разбор работы</h2><div class="small muted mb">После каждой работы — честный разбор. Так растут быстрее всего.</div>
    <label class="f">Клиент<input class="in" id="db-c" placeholder="Кто заказал"></label>
    <label class="f">Что сделал<textarea class="in" id="db-w" rows="2"></textarea></label>
    <div class="grid2"><label class="f">Оплата<input class="in" id="db-p" inputmode="decimal" placeholder="0 — бесплатно"></label>
      <label class="f">Валюта<input class="in" id="db-cur" value="сум"></label></div>
    <label class="f">Что получилось<textarea class="in" id="db-g" rows="2"></textarea></label>
    <label class="f">Что было сложно / пошло не так<textarea class="in" id="db-b" rows="2"></textarea></label>
    <button class="btn-epic block mt" id="db-go">Разобрать</button><div id="db-r"></div>`, (el, close) => {
    const g = id => el.querySelector("#" + id);
    g("db-go").onclick = async () => {
      const d = { client: g("db-c").value.trim(), what: g("db-w").value.trim(), paid: Math.max(0, +String(g("db-p").value).replace(",", ".").replace(/\s/g, "") || 0),
        cur: g("db-cur").value.trim(), good: g("db-g").value.trim(), bad: g("db-b").value.trim(), at: X.today() };
      if (!d.what || d.what.length < 10) return X.toast("Опиши, что сделал", true);
      g("db-go").disabled = true; g("db-r").innerHTML = `<div class="center mt"><span class="spinner"></span></div>`;
      try { d.ai = await ask("debrief", { skill: sk.plan.skill_name, level: sk.level || 1, ...d, previous_jobs: w.debriefs.length }); } catch { d.ai = null; }
      w.debriefs.push(d);
      const S = X.S(); S.adj = S.adj || []; S.adj.push({ date: X.today(), xp: 30, why: "Разбор работы" });
      X.save();
      g("db-r").innerHTML = d.ai ? `<div class="win mt"><div class="small">${e(d.ai.feedback)}</div><ul class="tiny">${d.ai.lessons.map(x => `<li>${e(x)}</li>`).join("")}</ul>
        <div class="tiny" style="color:var(--violet2)">${e(d.ai.price_tip)}</div><button class="btn block mt" id="db-ok">Готово</button></div>` : `<button class="btn block mt" id="db-ok">Готово</button>`;
      g("db-ok").onclick = () => { close(); X.render(); };
    };
  });
}
