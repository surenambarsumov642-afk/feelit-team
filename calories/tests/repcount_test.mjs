// Синтетическая проверка счётчика повторов: отжимания сбоку и лицом к камере, приседания спереди.
// Запуск: node calories/tests/repcount_test.mjs
import { RepCounter } from "../repcount.js";
let ok = true;
const eq = (n, got, want) => { const g = got === want; if (!g) ok = false; console.log(`${g ? "OK " : "BAD"} ${n}: ${got}${g ? "" : " ≠ " + want}`); };
const blank = () => Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.05 }));
const put = (lm, i, x, y, v = 0.95) => { lm[i] = { x, y, visibility: v }; };
const wave = (t, period) => (1 - Math.cos(2 * Math.PI * t / period)) / 2; // 0 → 1 → 0

// 1) Отжимания лицом к камере: плечи разведены (0.40–0.60), опускаются на 0.3·ширины плеч
function frontPush(reps, depthFrac, jitter = 0.004) {
  const c = new RepCounter("push"); let last;
  for (let f = 0; f < reps * 30 + 20; f++) {
    const t = f * 66, k = f < 10 ? 0 : wave(f - 10, 30), lm = blank(), sw = 0.2, y = 0.45 + k * depthFrac * sw + (Math.random() - 0.5) * jitter;
    put(lm, 11, 0.40, y); put(lm, 12, 0.60, y); put(lm, 13, 0.34, y + 0.08); put(lm, 14, 0.66, y + 0.08); put(lm, 15, 0.34, 0.75); put(lm, 16, 0.66, 0.75);
    put(lm, 23, 0.45, y + 0.05, 0.2); put(lm, 24, 0.55, y + 0.05, 0.2);
    last = c.update(lm, t, 4 / 3);
  }
  return last;
}
let r = frontPush(5, 0.45); eq("front push 5 reps", r.count, 5); eq("front push mode", r.mode, "front");
eq("front push shallow (no reps)", frontPush(5, 0.12).count, 0);

// 2) Отжимания сбоку: угол в локте 170° ↔ 80°, корпус горизонтален
{
  const c = new RepCounter("push"); let last;
  for (let f = 0; f < 5 * 30 + 20; f++) {
    const t = f * 66, k = f < 10 ? 0 : wave(f - 10, 30), lm = blank();
    const ang = (170 - k * 90) * Math.PI / 180, S = { x: 0.35, y: 0.5 }, upper = 0.12;
    const E = { x: S.x + upper * 0.2, y: S.y + upper }; // локоть под плечом
    const dir = Math.atan2(S.y - E.y, (S.x - E.x) * 4 / 3) + ang; // кисть под углом ang к плечу
    put(lm, 11, S.x, S.y); put(lm, 12, S.x + 0.01, S.y, 0.3); put(lm, 13, E.x, E.y); put(lm, 15, E.x + Math.cos(dir) * upper * 0.75, E.y + Math.sin(dir) * upper);
    put(lm, 23, 0.7, 0.53); put(lm, 25, 0.85, 0.56); put(lm, 27, 0.97, 0.6);
    last = c.update(lm, t, 4 / 3);
  }
  eq("side push mode", last.mode, "side");
  eq("side push reps ≥ 4", last.count >= 4, true);
}

// 3) Приседания спереди: таз опускается на 0.5 длины корпуса
{
  const c = new RepCounter("squat"); let last;
  for (let f = 0; f < 4 * 36 + 20; f++) {
    const t = f * 66, k = f < 10 ? 0 : wave(f - 10, 36), lm = blank();
    const torso = 0.28, hy = 0.55 + k * 0.5 * torso, sy = hy - torso + k * 0.08;
    put(lm, 11, 0.43, sy); put(lm, 12, 0.57, sy); put(lm, 23, 0.46, hy); put(lm, 24, 0.54, hy);
    put(lm, 25, 0.45, 0.78, 0.4); put(lm, 26, 0.55, 0.78, 0.4); put(lm, 27, 0.45, 0.95, 0.3); put(lm, 28, 0.55, 0.95, 0.3);
    last = c.update(lm, t, 3 / 4);
  }
  eq("front squat 4 reps", last.count, 4); eq("front squat mode", last.mode, "front");
}
console.log(ok ? "\nRepCount: всё OK" : "\nRepCount: ЕСТЬ ОШИБКИ");
process.exit(ok ? 0 : 1);
