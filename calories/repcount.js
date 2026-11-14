// Подсчёт повторов по позе (33 точки BlazePose). Чистая логика без камеры — проверяется тестами на синтетических движениях.
// Повтор = переход «нижняя фаза → верхняя фаза» по углу сустава с гистерезисом, сглаживанием и минимальным временем.

const P = { lS: 11, rS: 12, lE: 13, rE: 14, lW: 15, rW: 16, lH: 23, rH: 24, lK: 25, rK: 26, lA: 27, rA: 28 };

export const EXERCISES = {
  // угол: a-b-c, вершина в b
  squat: { n: "Приседания", side: s => [s.H, s.K, s.A], up: 160, down: 105, need: s => [s.H, s.K, s.A],
    hint: "Встань боком к камере, чтобы были видны бедро, колено и стопа" },
  push: { n: "Отжимания", side: s => [s.S, s.E, s.W], up: 150, down: 100, need: s => [s.S, s.E, s.W, s.H],
    horizontal: true, hint: "Прими упор лёжа боком к камере: видны плечо, локоть, кисть и таз" },
  abs: { n: "Скручивания", side: s => [s.S, s.H, s.K], up: 122, down: 100, invert: true, need: s => [s.S, s.H, s.K],
    hint: "Ляг боком к камере, колени согнуты: видны плечо, таз и колено" },
};

const sides = {
  l: { S: P.lS, E: P.lE, W: P.lW, H: P.lH, K: P.lK, A: P.lA },
  r: { S: P.rS, E: P.rE, W: P.rW, H: P.rH, K: P.rK, A: P.rA },
};
export function angle(a, b, c, aspect = 1) {
  const abx = (a.x - b.x) * aspect, aby = a.y - b.y, cbx = (c.x - b.x) * aspect, cby = c.y - b.y;
  const d = Math.hypot(abx, aby) * Math.hypot(cbx, cby);
  if (!d) return 180;
  return Math.acos(Math.max(-1, Math.min(1, (abx * cbx + aby * cby) / d))) * 180 / Math.PI;
}
const vis = p => (p && (p.visibility ?? 1)) || 0;

export class RepCounter {
  constructor(kind, { minRepMs = 350, minVis = 0.5 } = {}) {
    this.ex = EXERCISES[kind]; this.kind = kind; this.count = 0;
    this.phase = "up"; this.smooth = null; this.lastRep = -1e9; this.lowSeen = false;
    this.minRepMs = minRepMs; this.minVis = minVis;
  }
  /** lm — массив 33 точек {x,y,visibility}; t — мс; aspect — ширина/высота кадра. */
  update(lm, t, aspect = 1) {
    if (!lm || lm.length < 29) return { count: this.count, ok: false, hint: "Тело не видно в кадре" };
    // выбираем сторону, которую камера видит лучше
    const score = s => this.ex.need(sides[s]).reduce((a, i) => a + vis(lm[i]), 0);
    const side = sides[score("l") >= score("r") ? "l" : "r"];
    if (this.ex.need(side).some(i => vis(lm[i]) < this.minVis)) return { count: this.count, ok: false, hint: this.ex.hint };
    if (this.ex.horizontal) {
      const sh = lm[side.S], hip = lm[side.H];
      const tilt = Math.abs(Math.atan2(hip.y - sh.y, (hip.x - sh.x) * aspect) * 180 / Math.PI);
      const fromHoriz = Math.min(tilt, 180 - tilt);
      if (fromHoriz > 45) return { count: this.count, ok: false, hint: "Прими упор лёжа — корпус должен быть горизонтально" };
    }
    const [a, b, c] = this.ex.side(side);
    const raw = angle(lm[a], lm[b], lm[c], aspect);
    this.smooth = this.smooth == null ? raw : this.smooth * 0.5 + raw * 0.5;
    const ang = this.smooth, ex = this.ex;
    let rep = false;
    // для скручиваний «работа» — уменьшение угла в тазу, для остальных — сгибание
    if (this.phase === "up" && ang <= ex.down) { this.phase = "down"; this.lowSeen = true; }
    else if (this.phase === "down" && ang >= ex.up) {
      this.phase = "up";
      if (this.lowSeen && t - this.lastRep >= this.minRepMs) { this.count++; this.lastRep = t; rep = true; }
      this.lowSeen = false;
    }
    return { count: this.count, ok: true, angle: Math.round(ang), phase: this.phase, rep };
  }
}

/** Линии скелета для отрисовки. */
export const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]];
