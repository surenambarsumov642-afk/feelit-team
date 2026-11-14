// Проверка штрихкодов: Open Food Facts (известные товары) и чтение этикетки ИИ (реальное фото с Wikimedia).
import { offLookup, ai, LABEL_SYSTEM, LABEL_SCHEMA } from "../functions/arise/index.ts";
import { encodeBase64 } from "jsr:@std/encoding/base64";

let ok = true;
for (const code of ["3017620422003", "5449000000996", "4600494000105"]) {
  const p = await offLookup(code);
  console.log(code, "→", p ? `${p.name} (${p.brand ?? "—"}) ${p.kcal} ккал · Б ${p.p} Ж ${p.f} У ${p.c} · упаковка ${p.serving ?? "—"}` : "нет в Open Food Facts");
  if (code === "3017620422003" && !(p && p.kcal > 400 && p.kcal < 600)) ok = false; // Nutella ~539 ккал
}
// фото этикетки скачивает и уменьшает шаг workflow (label.jpg); пауза — чтобы не упереться в минутный лимит Groq после прошлых тестов
const file = Deno.args[0];
if (file) {
  await new Promise((r) => setTimeout(r, 30000));
  const image = `data:image/jpeg;base64,${encodeBase64(await Deno.readFile(file))}`;
  try {
    const r = await ai([{ image }, { text: "Прочитай таблицу пищевой ценности на этикетке." }], LABEL_SYSTEM, LABEL_SCHEMA, { maxTokens: 800 });
    console.log("этикетка →", JSON.stringify(r));
    if (!r.found || !(r.kcal > 0 && r.kcal < 950)) ok = false;
  } catch (e) { console.log("этикетка: ошибка", (e as Error).message); ok = false; }
}
if (!ok) Deno.exit(1);
console.log("barcode OK");
Deno.exit(0);
