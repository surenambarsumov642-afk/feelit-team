// Подсчёт повторов по позе (33 точки BlazePose). Чистая логика без камеры — проверяется тестами на синтетических движениях.
// Повтор = переход «нижняя фаза → верхняя фаза» по углу сустава с гистерезисом, сглаживанием и минимальным временем.

const P = { lS: 11, rS: 12, lE: 13, rE: 14, lW: 15, rW: 16, lH: 23, rH: 24, lK: 25, rK: 26, lA: 27, rA: 28 };

export const EXERCISES = {
  // угол: a-b-c, вершина в b
  squat: { n: "Приседания", side: s => [s.H, s.K, s.A], up: 160, down: 105, need: s => [s.H, s.K, s.A],
    front: { track: "H", norm: "torso", down: 0.32, up: 0.14 },
    hint: "Встань в полный рост лицом или боком к камере в 2–3 метрах: видны таз, колени и стопы" },
  push: { n: "Отжимания", side: s => [s.S, s.E, s.W], up: 150, down: 100, need: s => [s.S, s.E, s.W, s.H],
    horizontal: true, front: { track: "S", norm: "sw", down: 0.28, up: 0.12 },
    hint: "Положи телефон на пол перед собой (1–1,5 м) или сбоку (2 м): должны быть видны плечи и руки" },
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
    // Два режима: «сбоку» (угол сустава) и «лицом к камере» (вертикальный ход плеч/таза).
    // Режим выбирается сам; чтобы не прыгать между ними посреди повтора, смена режима — только после 8 кадров подряд.
    const sideRes = this.sideCheck(lm, aspect), frontOk = this.ex.front && this.frontCheck(lm, aspect);
    const want = sideRes.ok ? "side" : frontOk ? "front" : null;
    if (want && want !== this.mode) {
      this.switchN = (this.switchTo === want ? this.switchN : 0) + 1; this.switchTo = want;
      if (!this.mode || this.switchN >= 8) { this.mode = want; this.phase = "up"; this.smooth = null; this.lowSeen = false; this.top = null; }
    } else this.switchN = 0;
    if (this.mode === "front" && frontOk) return this.stepFront(frontOk, t);
    if (this.mode === "side" && sideRes.ok) return this.stepSide(sideRes, t);
    return { count: this.count, ok: false, hint: sideRes.hint || this.ex.hint };
  }
  sideCheck(lm, aspect) {
    const score = s => this.ex.need(sides[s]).reduce((a, i) => a + vis(lm[i]), 0);
    const side = sides[score("l") >= score("r") ? "l" : "r"];
    if (this.ex.need(side).some(i => vis(lm[i]) < this.minVis)) return { ok: false, hint: this.ex.hint };
    if (this.ex.horizontal) {
      const sh = lm[side.S], hip = lm[side.H];
      const tilt = Math.abs(Math.atan2(hip.y - sh.y, (hip.x - sh.x) * aspect) * 180 / Math.PI);
      if (Math.min(tilt, 180 - tilt) > 45) return { ok: false, hint: "Прими упор лёжа" };
      // сбоку плечи почти совпадают; если плечи широко разведены — это вид спереди
      const sw = Math.hypot((lm[P.lS].x - lm[P.rS].x) * aspect, lm[P.lS].y - lm[P.rS].y), arm = Math.hypot((sh.x - lm[side.E].x) * aspect, sh.y - lm[side.E].y);
      if (vis(lm[P.lS]) > 0.5 && vis(lm[P.rS]) > 0.5 && sw > arm * 1.1) return { ok: false, hint: "" };
    }
    const [a, b, c] = this.ex.side(side);
    return { ok: true, raw: angle(lm[a], lm[b], lm[c], aspect) };
  }
  /** Вид спереди: нужны оба плеча (и оба таза для приседаний). Возвращает {y, unit} или null. */
  frontCheck(lm, aspect) {
    const f = this.ex.front, need = f.track === "H" ? [P.lS, P.rS, P.lH, P.rH] : [P.lS, P.rS];
    if (need.some(i => vis(lm[i]) < this.minVis)) return null;
    const mid = (i, j) => ({ x: (lm[i].x + lm[j].x) / 2, y: (lm[i].y + lm[j].y) / 2 });
    const S = mid(P.lS, P.rS), H = mid(P.lH, P.rH);
    const sw = Math.hypot((lm[P.lS].x - lm[P.rS].x) * aspect, lm[P.lS].y - lm[P.rS].y);
    const unit = f.norm === "torso" ? Math.hypot((S.x - H.x) * aspect, S.y - H.y) : sw;
    if (unit < 0.04) return null; // человек слишком далеко
    return { y: f.track === "H" ? H.y : S.y, unit };
  }
  stepSide(r, t) {
    this.smooth = this.smooth == null ? r.raw : this.smooth * 0.5 + r.raw * 0.5;
    const ang = this.smooth, ex = this.ex;
    let rep = false;
    if (this.phase === "up" && ang <= ex.down) { this.phase = "down"; this.lowSeen = true; }
    else if (this.phase === "down" && ang >= ex.up) {
      this.phase = "up";
      if (this.lowSeen && t - this.lastRep >= this.minRepMs) { this.count++; this.lastRep = t; rep = true; }
      this.lowSeen = false;
    }
    return { count: this.count, ok: true, mode: "side", angle: Math.round(ang), phase: this.phase, rep };
  }
  stepFront(r, t) {
    // Глубина = насколько плечи (таз) опустились от верхней точки, в долях ширины плеч (длины корпуса).
    this.smooth = this.smooth == null ? r.y : this.smooth * 0.5 + r.y * 0.5;
    this.unitS = this.unitS == null ? r.unit : this.unitS * 0.9 + r.unit * 0.1;
    const y = this.smooth, f = this.ex.front;
    if (this.top == null) this.top = y;
    // верхняя точка: в фазе «вверх» следует за самой высокой позицией и медленно сползает (если человек сдвинулся)
    if (this.phase === "up") this.top = Math.min(y, this.top + this.unitS * 0.0015);
    const depth = (y - this.top) / this.unitS;
    let rep = false;
    if (this.phase === "up" && depth >= f.down) { this.phase = "down"; this.lowSeen = true; }
    else if (this.phase === "down" && depth <= f.up) {
      this.phase = "up";
      if (this.lowSeen && t - this.lastRep >= this.minRepMs) { this.count++; this.lastRep = t; rep = true; }
      this.lowSeen = false;
    }
    return { count: this.count, ok: true, mode: "front", depth: Math.round(depth * 100) / 100, phase: this.phase, rep };
  }
}

/** Линии скелета для отрисовки. */
export const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]];
