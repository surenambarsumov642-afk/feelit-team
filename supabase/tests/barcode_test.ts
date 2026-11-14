// Проверка штрихкодов: Open Food Facts (известные товары) и чтение этикетки ИИ (реальное фото с Wikimedia).
import { offLookup, ai, LABEL_SYSTEM, LABEL_SCHEMA } from "../functions/arise/index.ts";
import { encodeBase64 } from "jsr:@std/encoding/base64";

let ok = true;
for (const code of ["3017620422003", "5449000000996", "4600494000105"]) {
  const p = await offLookup(code);
  console.log(code, "→", p ? `${p.name} (${p.brand ?? "—"}) ${p.kcal} ккал · Б ${p.p} Ж ${p.f} У ${p.c} · упаковка ${p.serving ?? "—"}` : "нет в Open Food Facts");
  if (code === "3017620422003" && !(p && p.kcal > 400 && p.kcal < 600)) ok = false; // Nutella ~539 ккал
}
const UA = { "User-Agent": "ARISE-ci/1.0 (github actions)" };
const q = "https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=" + encodeURIComponent("nutrition facts label") +
  "&gsrnamespace=6&gsrlimit=6&prop=imageinfo&iiprop=url|mime&iiurlwidth=1024&format=json";
const pages = Object.values((await (await fetch(q, { headers: UA })).json()).query?.pages ?? {}) as any[];
let tried = 0;
for (const pg of pages) {
  const ii = pg.imageinfo?.[0];
  if (!ii || !/jpeg|png/.test(ii.mime) || tried >= 2) continue;
  tried++;
  const bytes = new Uint8Array(await (await fetch(ii.thumburl, { headers: UA })).arrayBuffer());
  const image = `data:${ii.mime};base64,${encodeBase64(bytes)}`;
  try {
    const r = await ai([{ image }, { text: "Прочитай таблицу пищевой ценности на этикетке." }], LABEL_SYSTEM, LABEL_SCHEMA, { maxTokens: 800 });
    console.log("этикетка:", pg.title, "→", JSON.stringify(r));
    if (tried === 1 && r.found && !(r.kcal >= 0 && r.kcal < 950)) ok = false;
  } catch (e) { console.log("этикетка:", pg.title, "ошибка:", (e as Error).message); ok = false; }
}
if (!ok) Deno.exit(1);
console.log("barcode OK");
Deno.exit(0);
