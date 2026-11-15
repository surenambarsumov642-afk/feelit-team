// Ingot — сканер штрихкодов: задняя камера + ZXing (WebAssembly), всё на телефоне.
let zx = null;
function loadZX() {
  if (zx) return zx;
  zx = new Promise((res, rej) => {
    const base = new URL("./vendor/zxing/", import.meta.url).href;
    const s = document.createElement("script");
    s.src = base + "zxing_reader.js";
    s.onload = () => {
      try {
        window.ZXingWASM.prepareZXingModule({ overrides: { locateFile: (p) => base + p }, fireImmediately: true }).then(() => res(window.ZXingWASM), rej);
      } catch (e) { rej(e); }
    };
    s.onerror = () => rej(new Error("Не удалось загрузить сканер"));
    document.head.appendChild(s);
  });
  zx.catch(() => { zx = null; });
  return zx;
}
const OPTS = { formats: ["EAN13", "EAN8", "UPCA", "UPCE"], tryHarder: true, maxNumberOfSymbols: 1 };

/** Найти штрихкод на картинке (ImageData). Возвращает строку цифр или "". */
export async function decode(imageData) {
  const Z = await loadZX();
  const r = await Z.readBarcodes(imageData, OPTS);
  const hit = r.find(x => x.isValid && /^\d{8,14}$/.test(x.text));
  return hit ? hit.text : "";
}

/** o: { esc, onCode(code), onManual() } */
export function openScanner(o) {
  const ov = document.createElement("div");
  ov.className = "cam-ov scan-ov";
  ov.innerHTML = `<video playsinline muted autoplay></video>
    <div class="cam-top"><button class="icon-btn" id="sc-x">✕</button><div class="grow"><div class="cam-ex">Штрихкод</div>
      <div class="cam-st" id="sc-st">Включаю камеру…</div></div></div>
    <div class="scan-frame"><i></i></div>
    <div class="cam-bottom"><div class="tiny" id="sc-hint">Наведи камеру на штрихкод упаковки. Держи ровно, 10–20 см.</div>
      <button class="btn ghost block mt" id="sc-man">⌨ Ввести цифры вручную</button></div>`;
  document.body.appendChild(ov);
  const video = ov.querySelector("video"), $ = id => ov.querySelector("#" + id);
  const cv = document.createElement("canvas"), g = cv.getContext("2d", { willReadFrequently: true });
  let stream = null, stopped = false, timer = 0, busy = false;
  const stop = () => { stopped = true; clearTimeout(timer); if (stream) stream.getTracks().forEach(t => t.stop()); ov.remove(); };
  $("sc-x").onclick = stop;
  $("sc-man").onclick = () => { stop(); o.onManual(); };

  const tick = async () => {
    if (stopped) return;
    timer = setTimeout(tick, 220);
    if (busy || video.readyState < 2) return;
    busy = true;
    try {
      const vw = video.videoWidth, vh = video.videoHeight;
      // центральная полоса кадра, где рамка
      const w = Math.round(vw * 0.85), h = Math.round(Math.min(vh, vw) * 0.5);
      cv.width = w; cv.height = h;
      g.drawImage(video, (vw - w) / 2, (vh - h) / 2, w, h, 0, 0, w, h);
      const code = await decode(g.getImageData(0, 0, w, h));
      if (code && !stopped) {
        try { navigator.vibrate && navigator.vibrate(60); } catch {}
        stop(); o.onCode(code);
      }
    } catch (e) {
      $("sc-st").textContent = "Ошибка сканера: " + (e.message || e); $("sc-st").classList.add("bad");
    } finally { busy = false; }
  };

  (async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("Камера недоступна в этом браузере");
      const [s] = await Promise.all([
        navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }),
        loadZX(),
      ]);
      stream = s;
      if (stopped) return stream.getTracks().forEach(t => t.stop());
      video.srcObject = stream; await video.play().catch(() => {});
      $("sc-st").textContent = "Ищу штрихкод…";
      tick();
    } catch (e) {
      $("sc-st").textContent = (e && e.name === "NotAllowedError") ? "Нет доступа к камере. Разреши камеру для Ingot в настройках iPhone." : (e.message || String(e));
      $("sc-st").classList.add("bad");
    }
  })();
  return { stop };
}
