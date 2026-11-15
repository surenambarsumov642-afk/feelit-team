// Фразы «Системы» (собственные, в духе Solo Leveling — без дословных цитат из аниме) и звуки (синтез WebAudio, без файлов).

export const PHRASES = {
  // экран входа — коротко, мощно, до мурашек
  intro: [
    "Ты был слабейшим. Это больше не важно.\nВажно лишь то, кем ты станешь.",
    "Мир не изменится ради тебя.\nПоэтому изменишься ты.",
    "Никто не придёт тебя спасать.\nИ это лучшая новость: ты справишься сам.",
    "Каждый день ты выбираешь:\nостаться тем же — или стать сильнее.",
    "Боль пройдёт.\nСила останется.",
    "Тот, кто сдался, уже проиграл.\nТот, кто встал, — ещё в игре.",
    "Ты не обязан быть лучшим.\nТы обязан быть лучше, чем вчера.",
    "Они смеялись над слабым.\nПусть теперь смотрят.",
    "Сила не даётся при рождении.\nОна выковывается. День за днём.",
    "Тени собираются вокруг тех,\nкто не отступает.",
    "Предел существует, пока ты в него веришь.",
    "Сегодняшняя боль —\nзавтрашняя броня.",
    "Не жди, когда станет легче.\nСтановись сильнее.",
    "Ты один.\nНо этого достаточно.",
    "Встань.\nСистема ещё не закончила с тобой.",
    "Каждый повтор — удар по тому,\nкем ты был.",
    "Дисциплина — это когда ты выполняешь обещание,\nкоторое дал себе.",
    "Монарх не рождается.\nМонарх поднимается с колен.",
  ],
  // короткое «слово дня» на экране статуса
  daily: [
    "Мотивация уходит. Дисциплина остаётся.",
    "Каждый охотник ранга S когда-то был ранга E.",
    "Уровень не дают. Уровень берут.",
    "Сила копится тихо. День за днём.",
    "Пока другие ищут оправдания — ты ищешь способ.",
    "Не сравнивай себя с другими. Сравнивай с тем, кем был вчера.",
    "Тяжело? Значит, ты растёшь.",
    "Слабость — стартовая точка, а не приговор.",
    "Один день — ничто. Тридцать дней — другой человек.",
    "Ты не устал. Ты просто ещё не закончил.",
    "Никто не увидит твоих тренировок. Все увидят результат.",
    "Дорога к силе пуста. Там нет толпы.",
    "Сделай сегодня то, за что завтра скажешь себе спасибо.",
    "Твоё тело слышит каждое твоё решение.",
    "Каждое отжимание — голос против прежнего тебя.",
    "Сила — это привычка, а не вспышка.",
    "Не бойся медленного прогресса. Бойся стоять на месте.",
    "Тени не спят. И ты не сдавайся.",
    "Победа над собой — единственная, которая считается.",
    "Сегодняшний ты строит завтрашнего.",
  ],
  morning: [
    "Новый день. Ежедневный квест получен.",
    "Ты проснулся. Значит, у тебя есть ещё один шанс стать сильнее.",
    "Система не ждёт настроения. Система ждёт действия.",
    "Вчерашний ты — твой единственный соперник.",
    "Сегодня никто не заставит тебя. Именно поэтому это важно.",
    "Ты здесь не случайно. Ты сам выбрал этот путь.",
    "Пока другие спят, Система считает твои шаги.",
    "Начни с малого. Но начни сегодня.",
    "Сегодня — ещё одна ступень. Не пропусти её.",
    "Новый день — новые Врата. Войди в них первым.",
    "Солнце встало. Воин тоже.",
    "Мир не ждёт. Тени — тоже.",
  ],
  quest: [
    "Задание выполнено. Система зафиксировала.",
    "Ещё один шаг. Ещё немного силы.",
    "Хорошо. Но это только начало дня.",
    "Ты доказал, что можешь. Теперь докажи, что можешь каждый день.",
    "Маленькая победа — тоже победа.",
    "Сила откликается. Продолжай.",
    "Система видит. Система помнит.",
    "Ещё одна цепь на прошлом тебе разорвана.",
  ],
  allQuests: [
    "Все задания выполнены. Ты сильнее, чем был утром.",
    "Идеальный день. Из таких дней складывается Легенда.",
    "Система довольна вашей дисциплиной.",
    "Сегодня ты победил лень. Завтра она вернётся — будь готов.",
    "Каждый закрытый день — уровень, который у тебя никто не отнимет.",
    "Сегодня ты был тем, кем обещал стать.",
    "Прежний ты не узнал бы себя.",
  ],
  levelup: [
    "Вы стали сильнее.",
    "Ты больше не тот, кем начинал.",
    "Предел — это то, что ты ещё не преодолел.",
    "Сила растёт у тех, кто не сдаётся на скучных днях.",
    "Новый уровень. Новые требования. Система повышает планку.",
    "Ты чувствуешь? Это сила, которую ты заработал сам.",
    "Те, кто смеялся, уже позади.",
    "Ещё одна ступень. Лестница бесконечна.",
  ],
  rank: [
    "Мир признал твою силу.",
    "Ты поднялся туда, куда другие боятся даже смотреть.",
    "Ранг не дарят. Ты его вырвал.",
    "Теперь ты — тот, на кого равняются.",
    "Слабейший ушёл. Остался охотник.",
  ],
  achv: [
    "Система признаёт твоё достижение.",
    "Этот титул не купить. Его можно только заслужить.",
    "Имя, которое ты заработал.",
    "Твоя история становится легендой.",
  ],
  penalty: [
    "Система не прощает слабость. Но даёт второй шанс.",
    "Ты упал. Важно не это. Важно — встанешь ли ты завтра.",
    "Штраф — не конец пути. Это напоминание, зачем ты начал.",
    "Слабость сегодня — это выбор. Завтра выбери иначе.",
    "Даже охотники ранга S проигрывали. Они просто не останавливались.",
    "Боль поражения — топливо. Используй его.",
  ],
  comeback: [
    "Ты вернулся. Это уже больше, чем делают многие.",
    "Пропуск — не поражение. Поражение — не вернуться.",
    "Система ждала тебя. Продолжим с того места, где ты остановился.",
    "Падать — нормально. Лежать — нет. Вставай.",
  ],
  exam: [
    "Экзамен — не наказание. Это доказательство.",
    "Ранг не дарят. Ранг подтверждают.",
    "Одна ошибка — и всё сначала. Так рождаются сильные.",
    "Те, кто прошёл, тоже хотели сдаться. Они просто не сдались.",
  ],
};
export const phrase = cat => { const a = PHRASES[cat] || PHRASES.morning; return a[Math.floor(Math.random() * a.length)]; };
/** Одна и та же фраза весь день (для «слова дня»). */
export const dailyPhrase = date => { const a = PHRASES.daily; let h = 0; for (const ch of date) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return a[h % a.length]; };

/* ---------- редкость титулов ---------- */
export const RARITY = [
  null,
  { id: "common", n: "Обычный", c: "#7fb6ff" },
  { id: "rare", n: "Редкий", c: "#3ad6ff" },
  { id: "epic", n: "Эпический", c: "#b48cff" },
  { id: "legend", n: "Легендарный", c: "#ffc24a" },
  { id: "myth", n: "Мифический", c: "#ff4d6d" },
];

/* ---------- звуки: синтез с реверберацией ---------- */
let ctx = null, master = null, rev = null;
function ac() {
  try {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
      master = ctx.createGain(); master.gain.value = 0.9; master.connect(comp).connect(ctx.destination);
      // простая реверберация: импульс из затухающего шума
      const len = ctx.sampleRate * 2.2, buf = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
      rev = ctx.createConvolver(); rev.buffer = buf;
      const rg = ctx.createGain(); rg.gain.value = 0.32; rev.connect(rg).connect(master);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  } catch { return null; }
}
/** Разблокировать звук (iOS разрешает только после касания). */
export const unlockAudio = () => { const c = ac(); if (c) { const o = c.createOscillator(), g = c.createGain(); g.gain.value = 0.0001; o.connect(g).connect(c.destination); o.start(); o.stop(c.currentTime + 0.01); } };

function tone(freq, start, dur, { type = "sine", vol = 0.12, slide = 0, attack = 0.015, wet = true, detune = 0 } = {}) {
  const c = ac(); if (!c) return;
  const t0 = c.currentTime + start, o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0); o.detune.value = detune;
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(master); if (wet) g.connect(rev);
  o.start(t0); o.stop(t0 + dur + 0.05);
}
function noise(start, dur, { vol = 0.1, from = 800, to = 4000, q = 1, wet = true } = {}) {
  const c = ac(); if (!c) return;
  const t0 = c.currentTime + start, n = c.sampleRate * dur, b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const s = c.createBufferSource(); s.buffer = b;
  const f = c.createBiquadFilter(); f.type = "bandpass"; f.Q.value = q; f.frequency.setValueAtTime(from, t0); f.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  const g = c.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + dur * 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  s.connect(f).connect(g); g.connect(master); if (wet) g.connect(rev);
  s.start(t0); s.stop(t0 + dur);
}
const boom = (t = 0, v = 0.5) => { tone(90, t, 1.1, { vol: v, slide: 0.35, attack: 0.005, wet: false }); noise(t, 0.5, { vol: v * 0.35, from: 300, to: 60 }); };
const chord = (fs, t, dur, o = {}) => fs.forEach(f => { tone(f, t, dur, { type: "sawtooth", vol: 0.035, attack: 0.25, detune: -7, ...o }); tone(f, t, dur, { type: "sawtooth", vol: 0.035, attack: 0.25, detune: 7, ...o }); });
const sparkle = (t, n = 6, base = 1760) => { for (let i = 0; i < n; i++) tone(base * Math.pow(1.122, i), t + i * 0.045, 0.35, { type: "triangle", vol: 0.05 }); };

/** Звук по типу события. */
export function sfx(kind, rarity = 1) {
  if (!ac()) return;
  switch (kind) {
    case "awaken": // вход в приложение
      boom(0, 0.55); chord([110, 165, 220], 0.05, 2.4, { vol: 0.03 });
      noise(0.1, 1.4, { vol: 0.06, from: 200, to: 6000, q: 2 });
      sparkle(0.9, 7, 1320); tone(880, 1.2, 1.5, { vol: 0.05 }); break;
    case "boot": tone(1600, 0, 0.04, { vol: 0.03, wet: false }); break; // строки загрузки
    case "levelup":
      boom(0, 0.35);
      [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.05 + i * 0.08, 0.5, { type: "triangle", vol: 0.12 }));
      chord([523, 659, 784], 0.45, 1.6); sparkle(0.5, 6); break;
    case "rank": // повышение ранга — самое эпичное
      boom(0, 0.6); boom(0.5, 0.45);
      noise(0, 1.2, { vol: 0.08, from: 150, to: 5000, q: 1.5 });
      chord([196, 247, 294], 0.2, 1.4); chord([262, 330, 392, 523], 1.0, 2.6);
      [784, 988, 1175, 1568].forEach((f, i) => tone(f, 1.0 + i * 0.1, 1.2, { type: "triangle", vol: 0.08 })); sparkle(1.5, 8, 1568); break;
    case "achv": {
      const r = Math.max(1, Math.min(5, rarity));
      if (r >= 4) boom(0, 0.3 + r * 0.05);
      tone(880, 0, 0.25, { type: "triangle", vol: 0.1 }); tone(1319, 0.1, 0.5, { type: "triangle", vol: 0.1 });
      if (r >= 2) tone(1760, 0.22, 0.6, { type: "triangle", vol: 0.07 });
      if (r >= 3) chord([440, 554, 659], 0.25, 1.4);
      if (r >= 4) chord([587, 740, 880, 1175], 0.6, 2);
      sparkle(0.3, 3 + r * 2, r >= 5 ? 1046 : 1760);
      if (r >= 5) { boom(0.9, 0.5); noise(0.9, 1.5, { vol: 0.07, from: 6000, to: 200 }); } break;
    }
    case "quest": tone(988, 0, 0.18, { type: "triangle", vol: 0.1 }); tone(1480, 0.08, 0.4, { type: "triangle", vol: 0.09 }); sparkle(0.15, 3, 1976); break;
    case "all": [659, 784, 988, 1319].forEach((f, i) => tone(f, i * 0.07, 0.6, { type: "triangle", vol: 0.1 })); chord([659, 831, 988], 0.3, 1.5); sparkle(0.35, 7); break;
    case "penalty":
      tone(110, 0, 0.9, { type: "sawtooth", vol: 0.12, slide: 0.6, wet: false });
      [0, 0.22, 0.44].forEach(t => tone(466, t, 0.16, { type: "square", vol: 0.05 }));
      noise(0, 0.6, { vol: 0.1, from: 2000, to: 100 }); break;
    case "add": tone(1320, 0, 0.09, { type: "triangle", vol: 0.07 }); tone(1980, 0.06, 0.18, { type: "triangle", vol: 0.05 }); break;
    case "tab": noise(0, 0.12, { vol: 0.035, from: 1500, to: 5000, q: 3, wet: false }); tone(2400, 0, 0.03, { vol: 0.015, wet: false }); break;
    case "open": noise(0, 0.18, { vol: 0.03, from: 600, to: 3000, q: 2, wet: false }); break;
    case "tap": tone(1200, 0, 0.06, { vol: 0.04, wet: false }); break;
    default: tone(740, 0, 0.16, { type: "triangle", vol: 0.1 }); tone(1109, 0.1, 0.35, { type: "sine", vol: 0.08 });
  }
}
