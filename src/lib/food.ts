import { db, Food, startOfDay } from './db';
import { generateJson, userWithFile } from './gemini';
import { logFoodToNotion } from './integrations/secondBrain';

export type MealEstimate = {
  description: string;
  items: { name: string; portion: string }[];
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fibre: number;
  gl: 'low' | 'medium' | 'high';
  note: string;
};

export async function analyseMeal(base64: string, mimeType = 'image/jpeg', hint = ''): Promise<MealEstimate> {
  return generateJson<MealEstimate>(
    [
      userWithFile(
        `Estimate this meal's nutrition. kirthi manages PCOS without medication, focusing on insulin sensitivity and fat loss. ${hint ? `They say: "${hint}".` : ''}
Return JSON: {"description": "short name of the meal", "items": [{"name": "", "portion": ""}], "kcal": 0, "protein": 0, "carbs": 0, "fat": 0, "fibre": 0, "gl": "low|medium|high", "note": "one practical PCOS tip about this meal, max 140 characters"}`,
        mimeType,
        base64,
      ),
    ],
    { temperature: 0.2 },
  );
}

export async function saveMeal(m: MealEstimate, photoUri?: string) {
  await (await db()).runAsync(
    'INSERT INTO food_log(description, kcal, protein, carbs, fat, fibre, gl, note, photo_uri, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    m.description,
    m.kcal,
    m.protein,
    m.carbs,
    m.fat,
    m.fibre,
    m.gl,
    m.note,
    photoUri ?? null,
    Date.now(),
  );
  logFoodToNotion({
    name: m.description,
    day: new Date().toLocaleDateString('en-CA'),
    kcal: m.kcal,
    protein: m.protein,
    carbs: m.carbs,
    fat: m.fat,
    fibre: m.fibre,
    items: m.items?.map((i) => `${i.name} (${i.portion})`).join(', '),
    note: m.note,
    source: 'photo',
  }).catch(() => {});
}

export async function mealsToday(): Promise<Food[]> {
  return (await db()).getAllAsync<Food>('SELECT * FROM food_log WHERE created_at >= ? ORDER BY created_at DESC', startOfDay());
}

export async function recentMeals(limit = 30): Promise<Food[]> {
  return (await db()).getAllAsync<Food>('SELECT * FROM food_log ORDER BY created_at DESC LIMIT ?', limit);
}

export function totals(meals: Food[]) {
  const sum = (k: 'kcal' | 'protein' | 'carbs' | 'fat' | 'fibre') => Math.round(meals.reduce((a, m) => a + (m[k] ?? 0), 0));
  return { kcal: sum('kcal'), protein: sum('protein'), carbs: sum('carbs'), fat: sum('fat'), fibre: sum('fibre') };
}

export async function deleteMeal(id: number) {
  await (await db()).runAsync('DELETE FROM food_log WHERE id = ?', id);
}
