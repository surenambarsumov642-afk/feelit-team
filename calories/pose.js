// ARISE — камера Системы: распознаёт позу на телефоне (MediaPipe, видео никуда не отправляется) и считает повторы.
import { RepCounter, EXERCISES, BONES } from "./repcount.js";

let landmarker = null, loading = null;
async function getLandmarker() {
  if (landmarker) return landmarker;
  if (loading) return loading;
  loading = (async () => {
    const vision = await import("./vendor/mediapipe/vision_bundle.mjs");
    const files = await vision.FilesetResolver.forVisionTasks(new URL("./vendor/mediapipe/wasm", import.meta.url).href);
    const opts = d => ({ baseOptions: { modelAssetPath: new URL("./vendor/mediapipe/pose_landmarker_lite.task", import.meta.url).href, delegate: d },
      runningMode: "VIDEO", numPoses: 1, minPoseDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
    try { landmarker = await vision.PoseLandmarker.createFromOptions(files, opts("GPU")); }
    catch { landmarker = await vision.PoseLandmarker.createFromOptions(files, opts("CPU")); }
    return landmarker;
  })();
  try { return await loading; } finally { loading = null; }
}

/**
 * Открыть камеру для упражнения.
 * o: { kind: "push"|"squat"|"abs", target, esc, sfx, onFinish(reps), race?: { seconds, startAt(ms), poll(): Promise<{opp, oppName}> , push(reps) } }
 */
export function openCamera(o) {
  const ex = EXERCISES[o.kind], esc = o.esc;
  const ov = document.createElement("div");
  ov.className = "cam-ov";
  ov.innerHTML = `<video playsinline muted autoplay></video><canvas></canvas>
    <div class="cam-top"><button class="icon-btn" id="cam-x">✕</button><div class="grow"><div class="cam-ex">${esc(ex.n)}</div>
      <div class="cam-st" id="cam-st">Загрузка Системы…</div></div></div>
    ${o.race ? `<div class="cam-race"><div><b id="cam-me">0</b><span>ты</span></div><div class="cam-timer" id="cam-timer">—</div><div><b id="cam-opp">0</b><span id="cam-oppn">соперник</span></div></div>` : ""}
    <div class="cam-count"><b id="cam-n">0</b>${o.target ? `<span>/ ${o.target}</span>` : ""}</div>
    <div class="cam-bottom"><div class="tiny" id="cam-hint">${esc(ex.hint)}. Поставь телефон на пол или к стене в 2–3 метрах.</div>
      ${o.race ? "" : `<button class="btn-epic block mt" id="cam-done">Готово</button>`}</div>`;
  document.body.appendChild(ov);
  const video = ov.querySelector("video"), canvas = ov.querySelector("canvas"), g = canvas.getContext("2d");
  const $ = id => ov.querySelector("#" + id);
  const counter = new RepCounter(o.kind);
  let stream = null, raf = 0, stopped = false, lastT = 0, finished = false, raceTimer = 0;

  const stop = () => {
    stopped = true; cancelAnimationFrame(raf); clearInterval(raceTimer);
    if (stream) stream.getTracks().forEach(t => t.stop());
    ov.remove();
  };
  const finish = () => {
    if (finished) return; finished = true;
    const n = counter.count; stop(); o.onFinish(n);
  };
  $("cam-x").onclick = () => {
    if (o.race) { if (confirm("Выйти из дуэли? Засчитается то, что уже насчитано.")) finish(); return; }
    if (counter.count && confirm(`Сохранить ${counter.count} повторов?`)) return finish();
    stop();
  };
  const done = $("cam-done"); if (done) done.onclick = finish;

  const draw = lm => {
    g.clearRect(0, 0, canvas.width, canvas.height);
    if (!lm) return;
    const W = canvas.width, H = canvas.height;
    g.lineWidth = 4; g.strokeStyle = "rgba(95,240,255,.9)"; g.shadowColor = "#5ff0ff"; g.shadowBlur = 12;
    for (const [a, b] of BONES) {
      if ((lm[a].visibility ?? 1) < 0.4 || (lm[b].visibility ?? 1) < 0.4) continue;
      g.beginPath(); g.moveTo(lm[a].x * W, lm[a].y * H); g.lineTo(lm[b].x * W, lm[b].y * H); g.stroke();
    }
    g.fillStyle = "#fff";
    for (const i of [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) if ((lm[i].visibility ?? 1) >= 0.4) { g.beginPath(); g.arc(lm[i].x * W, lm[i].y * H, 5, 0, 7); g.fill(); }
  };

  const loop = () => {
    if (stopped) return;
    raf = requestAnimationFrame(loop);
    const now = performance.now();
    if (now - lastT < 66 || video.readyState < 2) return; // ~15 кадров/с
    lastT = now;
    if (o.race && (Date.now() < o.race.startAt || finished)) return;
    let res;
    try { res = landmarker.detectForVideo(video, now); } catch { return; }
    const lm = res && res.landmarks && res.landmarks[0];
    draw(lm);
    const r = counter.update(lm, now, video.videoWidth / Math.max(1, video.videoHeight));
    $("cam-st").textContent = r.ok ? (r.phase === "down" ? "▼ вниз" : "▲ вверх") : r.hint;
    $("cam-st").classList.toggle("bad", !r.ok);
    if (r.rep) {
      $("cam-n").textContent = r.count; ov.querySelector(".cam-count").classList.remove("pop"); void ov.offsetWidth; ov.querySelector(".cam-count").classList.add("pop");
      try { o.sfx && o.sfx(o.target && r.count === o.target ? "achv" : "tap"); } catch {}
      if (navigator.vibrate) navigator.vibrate(30);
      if (o.race) $("cam-me").textContent = r.count;
      if (o.target && r.count === o.target) $("cam-hint").textContent = "Цель достигнута. Можно продолжать или нажать «Готово».";
    }
  };

  (async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("Камера недоступна в этом браузере");
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      if (stopped) return stream.getTracks().forEach(t => t.stop());
      video.srcObject = stream; await video.play().catch(() => {});
      await new Promise(r => video.readyState >= 2 ? r() : video.onloadeddata = r);
      canvas.width = video.videoWidth || 640; canvas.height = video.videoHeight || 480;
      $("cam-st").textContent = "Загрузка модели позы…";
      await getLandmarker();
      if (stopped) return;
      $("cam-st").textContent = "Система видит тебя. Начинай.";
      if (o.race) startRace();
      loop();
    } catch (e) {
      $("cam-st").textContent = (e && e.name === "NotAllowedError") ? "Нет доступа к камере. Разреши камеру для ARISE в настройках iPhone." : "Ошибка камеры: " + (e.message || e);
      $("cam-st").classList.add("bad");
    }
  })();

  function startRace() {
    const R = o.race;
    const tick = async () => {
      const left = Math.ceil((R.startAt + R.seconds * 1000 - Date.now()) / 1000), pre = Math.ceil((R.startAt - Date.now()) / 1000);
      $("cam-timer").textContent = pre > 0 ? `старт через ${pre}` : `${Math.max(0, left)} с`;
      $("cam-timer").classList.toggle("go", pre <= 0);
      try { await R.push(counter.count); const s = await R.poll(); $("cam-opp").textContent = s.opp; if (s.oppName) $("cam-oppn").textContent = s.oppName; } catch { /* сеть */ }
      if (pre <= 0 && left <= 0) finish();
    };
    tick(); raceTimer = setInterval(tick, 1000);
  }
  return { stop };
}
export const CAMERA_KINDS = Object.keys(EXERCISES);
/** Заранее скачать и запустить модель позы (перед живой дуэлью). */
export const preloadPose = () => getLandmarker().catch(() => {});
