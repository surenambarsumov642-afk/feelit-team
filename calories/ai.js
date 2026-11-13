// Распознавание еды по фото через Claude API (официальный SDK, собранный в vendor/).
import Anthropic, {
  AuthenticationError, PermissionDeniedError, RateLimitError,
  APIConnectionError, BadRequestError, InternalServerError, APIError,
} from "./vendor/anthropic.mjs";

const MODEL = "claude-opus-5-5";

const SYSTEM = `You are a professional nutritionist and food-recognition expert inside a calorie-tracking app.
The user sends a photo of food. Identify every distinct food or drink item that is visible and estimate,
as precisely as possible, the portion weight in grams and its calories, protein, fat and carbohydrates.

How to estimate well:
- Use visual scale cues (plate ~24-27 cm, fork, spoon, hand, cup, packaging) to judge portion size.
- Account for cooking method and hidden calories: oil, butter, sauces, dressings, sugar in drinks, breading.
- If a packaged product with a readable label is visible, prefer the label values.
- Use standard nutrition databases (USDA / Russian food composition tables) as reference values per 100 g, then scale to the estimated weight.
- Split composite dishes into sensible components only when that improves accuracy (e.g. "гречка", "куриная грудка", "соус"); keep a well-known dish whole (e.g. "борщ", "плов") when splitting would be guesswork.
- Calories must be consistent with macros (≈ 4·protein + 9·fat + 4·carbs, within ~10%).
- confidence: "high" when the item and portion are clear, "medium" when portion is uncertain, "low" when the item itself is uncertain.

Write all names, the summary and notes in Russian. Names should be short (1-4 words), lower-case except proper nouns.
If the image contains no food or drink, set is_food to false and return an empty items list.
The user may add a text hint (what the dish is, weight, ingredients) — trust it over your visual guess.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["is_food", "summary", "items", "notes"],
  properties: {
    is_food: { type: "boolean" },
    summary: { type: "string", description: "Short Russian name of the whole meal" },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "grams", "kcal", "protein", "fat", "carbs", "confidence"],
        properties: {
          name: { type: "string" },
          grams: { type: "number" },
          kcal: { type: "number" },
          protein: { type: "number" },
          fat: { type: "number" },
          carbs: { type: "number" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
      },
    },
    notes: { type: "string", description: "One short Russian sentence: assumptions made (oil, sauce, size). Empty if none." },
  },
};

export class AIError extends Error {}

/**
 * @param {string} apiKey
 * @param {string} base64Jpeg  (без префикса data:)
 * @param {string} hint        уточнение от пользователя
 * @param {"low"|"medium"|"high"} effort
 */
export async function analyzeFoodPhoto(apiKey, base64Jpeg, hint, effort = "medium") {
  if (!apiKey) throw new AIError("Не указан API-ключ. Добавь его в «Настройки → Ключ Claude API».");

  // Ключ хранится только на этом устройстве; приложение — личное, поэтому вызов идёт прямо из браузера.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2, timeout: 120_000 });

  const content = [
    { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64Jpeg } },
    { type: "text", text: hint && hint.trim()
        ? `Уточнение от пользователя: ${hint.trim()}\n\nОпредели продукты на фото и оцени КБЖУ.`
        : "Определи продукты на фото и оцени КБЖУ." },
  ];

  let response;
  try {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      output_config: { effort, format: { type: "json_schema", schema: SCHEMA } },
      // Если модель откажется по ошибке фильтра — запрос автоматически повторится на запасной модели.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{ role: "user", content }],
    });
  } catch (e) {
    if (e instanceof AuthenticationError) throw new AIError("Ключ API не принят. Проверь его в настройках.");
    if (e instanceof PermissionDeniedError) throw new AIError("Нет доступа к модели с этим ключом.");
    if (e instanceof RateLimitError) throw new AIError("Слишком много запросов или закончился баланс API. Попробуй позже.");
    if (e instanceof BadRequestError) throw new AIError("Запрос отклонён: " + (e.message || "неверные данные") );
    if (e instanceof InternalServerError) throw new AIError("Сервер Claude временно недоступен. Попробуй ещё раз.");
    if (e instanceof APIConnectionError) throw new AIError("Нет связи с сервером. Проверь интернет.");
    if (e instanceof APIError) throw new AIError("Ошибка API: " + e.message);
    throw new AIError("Неизвестная ошибка: " + (e && e.message || e));
  }

  if (response.stop_reason === "refusal") throw new AIError("Модель не смогла обработать это фото. Попробуй другое.");
  if (response.stop_reason === "max_tokens") throw new AIError("Ответ оборвался. Попробуй ещё раз.");

  const text = response.content.filter(b => b.type === "text").map(b => b.text).join("");
  let data;
  try { data = JSON.parse(text); } catch { throw new AIError("Не удалось разобрать ответ модели."); }

  data.items = (data.items || []).map(it => ({
    name: String(it.name || "продукт"),
    grams: Math.max(0, Math.round(+it.grams || 0)),
    kcal: Math.max(0, Math.round(+it.kcal || 0)),
    protein: Math.max(0, round1(+it.protein || 0)),
    fat: Math.max(0, round1(+it.fat || 0)),
    carbs: Math.max(0, round1(+it.carbs || 0)),
    confidence: ["high", "medium", "low"].includes(it.confidence) ? it.confidence : "medium",
  }));
  return data;
}

const round1 = x => Math.round(x * 10) / 10;
