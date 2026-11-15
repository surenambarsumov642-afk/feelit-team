// ARISE — экран входа: загрузка «Системы», фраза дня и пробуждение игрока. Касание «Войти» включает звук (iOS).
import { phrase, sfx, unlockAudio } from "./phrases.js";

const BOOT = ["Подключение к Системе", "Синхронизация с игроком", "Проверка статуса", "Загрузка ежедневных квестов"];
const wait = ms => new Promise(r => setTimeout(r, ms));

/** o: { name, level, rank, rankName, first, sound } → Promise, когда игрок вошёл. */
export function showIntro(o) {
  return new Promise(resolve => {
    const ov = document.createElement("div");
    ov.className = "intro";
    ov.innerHTML = `<div class="intro-in">
        <div class="intro-eb" id="ieb">◇ ИНИЦИАЛИЗАЦИЯ</div>
        <div class="intro-sys" data-text="[СИСТЕМА]">[СИСТЕМА]</div>
        <div class="intro-spacer"></div>
        <div class="intro-q" id="iq"></div>
        <div class="intro-p" id="ip"></div>
        <div class="intro-panel"><div class="intro-boot" id="ib"></div><div class="intro-bar"><i id="ibar"></i></div></div>
        <button class="intro-go" id="igo">${o.first ? "Пробудиться" : "Войти ›"}</button>
        <div class="intro-skip">коснись, чтобы пропустить</div>
      </div>`;
    document.body.appendChild(ov);
    const $ = id => ov.querySelector("#" + id);
    let skip = false, done = false;
    ov.addEventListener("click", e => { if (e.target.id !== "igo") skip = true; });

    const type = async (el, text, speed) => {
      for (let i = 1; i <= text.length; i++) { if (skip) { el.textContent = text; return; } el.textContent = text.slice(0, i); await wait(speed); }
    };
    $("igo").onclick = () => {
      if (done) return; done = true;
      try { unlockAudio(); if (o.sound) sfx("awaken"); } catch {}
      ov.classList.add("out");
      setTimeout(() => { ov.remove(); resolve(); }, 900);
    };
    (async () => {
      for (let i = 0; i < BOOT.length; i++) {
        const row = document.createElement("div"); row.innerHTML = `<span class="ok"></span>${BOOT[i]}<span class="dots">…</span>`;
        $("ib").appendChild(row);
        $("ibar").style.width = ((i + 1) / BOOT.length * 100) + "%";
        if (!skip) await wait(330);
        row.querySelector(".dots").textContent = "OK"; row.querySelector(".ok").textContent = "✓"; row.classList.add("done");
      }
      await wait(skip ? 0 : 250);
      ov.classList.add("lit"); ov.querySelector("#ieb").textContent = "◇ СИСТЕМА ГОТОВА";
      await type($("iq"), phrase("intro"), 38);
      await wait(skip ? 0 : 450);
      $("ip").innerHTML = o.first ? `<b>Новый игрок обнаружен</b>` :
        `ИГРОК <b>${o.name}</b> · LV. <b>${o.level}</b> · РАНГ <b>${o.rank}</b><div class="intro-rn">${o.rankName.toUpperCase()}</div>`;
      ov.classList.add("ready");
    })();
  });
}
