// CI: распознавание позы на реальных фото (Wikimedia) в настоящем браузере + углы, которые видит счётчик повторов.
import { chromium } from "playwright";
import fs from "node:fs";
const UA = { "User-Agent": "ARISE-ci/1.0 (github actions)" };
async function search(q, n = 4) {
  const u = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(q)}&gsrnamespace=6&gsrlimit=${n}&prop=imageinfo&iiprop=url|mime&iiurlwidth=640&format=json`;
  const d = await (await fetch(u, { headers: UA })).json();
  return Object.values(d.query?.pages ?? {}).filter(p => /jpeg|png/.test(p.imageinfo?.[0]?.mime)).map(p => ({ title: p.title, url: p.imageinfo[0].thumburl }));
}
const sets = { squat: await search("squat exercise person"), push: await search("push-up exercise person") };
const b = await chromium.launch();
const page = await b.newPage();
await page.goto("http://localhost:8080/calories/tests/pose_ci.html");
let found = 0, total = 0;
for (const [kind, imgs] of Object.entries(sets)) for (const img of imgs) {
  total++;
  const buf = Buffer.from(await (await fetch(img.url, { headers: UA })).arrayBuffer());
  const r = await page.evaluate(async ([b64, kind]) => window.analyze(b64, kind), [buf.toString("base64"), kind]);
  if (r.found) found++;
  console.log(`${kind.padEnd(5)} | ${r.found ? "поза найдена" : "позы нет    "} | ${r.angle != null ? "угол " + r.angle + "°" : ""} ${r.hint ? "· " + r.hint : ""} | ${img.title}`);
}
await b.close();
console.log(`Итого: поза найдена на ${found} из ${total} фото`);
if (!found) process.exit(1);
