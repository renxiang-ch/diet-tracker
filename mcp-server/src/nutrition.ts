// 从 index.html 移植的营养计算逻辑，保证和网页端结果完全一致。
// 对应网页函数：itemNutrition (index.html:1729), maybeSaveCustomFood (index.html:1696),
// getPersonDay (index.html:1664)

export interface Food {
  name: string;
  cal: number;
  protein: number;
  carbs: number;
  fat: number;
  unit: "g" | "ml" | "个";
  serving: number;
  custom?: boolean;
}

export interface DiaryItem {
  id: number;
  food: string;
  weight?: number | string;
  calPer?: number | string;
  protein?: number | string;
  carbs?: number | string;
  fat?: number | string;
  unit?: "g" | "ml" | "个";
  serving?: number | string;
  servingMode?: boolean;
}

export interface Meal {
  name: string;
  icon: string;
  items: DiaryItem[];
}

export interface PersonDay {
  meals: Meal[];
  note: string;
}

export const MEAL_SLOTS: Array<{ name: string; icon: string }> = [
  { name: "早餐", icon: "☀️" },
  { name: "午餐", icon: "🌤️" },
  { name: "晚餐", icon: "🌙" },
  { name: "加餐", icon: "🍎" },
];

export const DEFAULT_GOALS = { cal: 2000, protein: 75, carbs: 250, fat: 60, weightTarget: 0 };

export function defaultPersonDay(): PersonDay {
  return {
    meals: MEAL_SLOTS.map((m) => ({ name: m.name, icon: m.icon, items: [] })),
    note: "",
  };
}

// Workers 跑在 UTC，这里用东八区计算“今天”，对齐网页 todayStr() 的本地时间语义
export function todayInShanghai(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function lookupFood(customFoods: Food[], name: string): Food | undefined {
  const n = name.trim().toLowerCase();
  return customFoods.find((f) => f.name.toLowerCase() === n);
}

export function searchFoods(customFoods: Food[], query: string, limit = 12): Food[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return customFoods.filter((f) => f.name.toLowerCase().includes(q)).slice(0, limit);
}

export interface NutritionResult {
  cal: number;
  protein: number;
  carbs: number;
  fat: number;
}

// 对应 index.html:1729 itemNutrition —— 食物库里有记录时，库里的值始终优先
export function itemNutrition(item: DiaryItem, food: Food | undefined): NutritionResult {
  const serving = food
    ? food.unit === "个"
      ? 1
      : food.serving || 100
    : item.unit === "个"
      ? 1
      : parseFloat(String(item.serving)) || 100;

  const cp = food ? food.cal : parseFloat(String(item.calPer));
  if (isNaN(cp)) return { cal: 0, protein: 0, carbs: 0, fat: 0 };

  const w = parseFloat(String(item.weight));
  const pp = food ? food.protein : parseFloat(String(item.protein));
  const cbp = food ? food.carbs : parseFloat(String(item.carbs));
  const fp = food ? food.fat : parseFloat(String(item.fat));

  if (item.servingMode && food && food.unit !== "个") {
    const servings = isNaN(w) || w <= 0 ? 1 : w;
    return {
      cal: Math.round(servings * cp),
      protein: isNaN(pp) ? 0 : Math.round(servings * pp * 10) / 10,
      carbs: isNaN(cbp) ? 0 : Math.round(servings * cbp * 10) / 10,
      fat: isNaN(fp) ? 0 : Math.round(servings * fp * 10) / 10,
    };
  }

  const effectiveW = isNaN(w) || w <= 0 ? serving : w;
  return {
    cal: Math.round((effectiveW * cp) / serving),
    protein: isNaN(pp) ? 0 : Math.round(((effectiveW * pp) / serving) * 10) / 10,
    carbs: isNaN(cbp) ? 0 : Math.round(((effectiveW * cbp) / serving) * 10) / 10,
    fat: isNaN(fp) ? 0 : Math.round(((effectiveW * fp) / serving) * 10) / 10,
  };
}

// 对应 index.html:1696 maybeSaveCustomFood —— 更新已有食物时保留原 unit/serving
export function upsertCustomFood(
  customFoods: Food[],
  input: { name: string; cal: number; protein?: number; carbs?: number; fat?: number; unit?: "g" | "ml" | "个"; serving?: number }
): Food[] {
  const name = input.name.trim();
  const idx = customFoods.findIndex((f) => f.name.toLowerCase() === name.toLowerCase());
  const existing = idx >= 0 ? customFoods[idx] : null;
  const unit = existing ? existing.unit : input.unit || "g";
  const serving = existing ? existing.serving : unit === "个" ? 1 : input.serving || 100;
  const entry: Food = {
    name,
    cal: input.cal || 0,
    protein: input.protein || 0,
    carbs: input.carbs || 0,
    fat: input.fat || 0,
    unit,
    serving,
    custom: true,
  };
  const next = [...customFoods];
  if (idx >= 0) next[idx] = entry;
  else next.push(entry);
  return next;
}

export function sumNutrition(items: NutritionResult[]): NutritionResult {
  return items.reduce(
    (acc, n) => ({
      cal: acc.cal + n.cal,
      protein: Math.round((acc.protein + n.protein) * 10) / 10,
      carbs: Math.round((acc.carbs + n.carbs) * 10) / 10,
      fat: Math.round((acc.fat + n.fat) * 10) / 10,
    }),
    { cal: 0, protein: 0, carbs: 0, fat: 0 }
  );
}
