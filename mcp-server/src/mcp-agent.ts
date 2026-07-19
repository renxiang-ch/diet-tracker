import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "./env";
import { getKv, upsertKv } from "./supabase";
import {
  DEFAULT_GOALS,
  defaultPersonDay,
  itemNutrition,
  lookupFood,
  searchFoods,
  sumNutrition,
  todayInShanghai,
  upsertCustomFood,
  type DiaryItem,
  type Food,
  type PersonDay,
} from "./nutrition";

type DietData = Record<string, Record<string, PersonDay>>;
type FitnessGoals = Record<string, typeof DEFAULT_GOALS>;
type WeightLogs = Record<string, Record<string, number>>;

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function fail(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

// registerTool 的默认错误处理会把抛出的异常折叠成一句不含细节的 "internal error"，
// 这里统一捕获后把真实错误信息带回给调用方（ChatGPT），方便它判断是重试还是告知用户。
function withErrors<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (err) {
      console.error("[diet-tracker-mcp] tool error:", err);
      return fail(err instanceof Error ? err.message : String(err));
    }
  };
}

const FoodItemInput = z.object({
  food: z.string().describe("食物或菜品名称，中文，简洁，用于匹配/保存食物库"),
  weight: z.number().optional().describe("本次实际食用量：g/ml 食物填克数或毫升数，“个”为单位的食物填个数；留空按 1 份计算"),
  unit: z.enum(["g", "ml", "个"]).optional().describe("固体用 g，液体用 ml，按个计数用个；若该食物已在库中，会使用库里保存的单位"),
  cal: z.number().describe("每份 / 每100g（或100ml）热量 kcal；若食物已在库中会被库里保存的值覆盖"),
  protein: z.number().optional().describe("每份 / 每100g 蛋白质 g，默认 0"),
  carbs: z.number().optional().describe("每份 / 每100g 碳水化合物 g，默认 0"),
  fat: z.number().optional().describe("每份 / 每100g 脂肪 g，默认 0"),
  serving: z.number().optional().describe("一份对应多少 g/ml，默认 100（“个”为单位时固定为 1）"),
  serving_mode: z.boolean().optional().describe("true 表示 weight 填的是“份数”而不是重量，仅对已在库中的 g/ml 食物有效"),
});

function toDiaryItem(input: z.infer<typeof FoodItemInput>, existing: Food | undefined): DiaryItem {
  return {
    id: Date.now() + Math.random(),
    food: input.food.trim(),
    weight: input.weight ?? "",
    calPer: input.cal,
    protein: input.protein ?? 0,
    carbs: input.carbs ?? 0,
    fat: input.fat ?? 0,
    unit: existing?.unit ?? input.unit ?? "g",
    serving: existing?.serving ?? input.serving ?? 100,
    servingMode: input.serving_mode ?? false,
  };
}

function shiftDate(dateStr: string, deltaDays: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

export class DietTrackerMCP extends McpAgent<Env> {
  server = new McpServer({ name: "diet-tracker", version: "1.0.0" });

  async init() {
    this.server.registerTool(
      "list_people",
      {
        title: "获取记录人列表",
        description: "获取两位使用者的名字，用于确定后续工具里 person 参数（0 或 1）对应的是谁",
      },
      withErrors(async () => {
        const kv = await getKv(this.env, ["person_names"]);
        const names = (kv.person_names as string[] | undefined) ?? ["我", "TA"];
        return ok({ people: names.map((name, person) => ({ person, name })) });
      })
    );

    this.server.registerTool(
      "search_food_library",
      {
        title: "搜索食物库",
        description: "按名称模糊搜索已保存的食物库，返回每份/每100g的营养值。记录新食物前建议先搜索一次，避免和已有估算不一致。",
        inputSchema: {
          query: z.string().describe("食物名称关键词"),
        },
      },
      withErrors(async ({ query }) => {
        const kv = await getKv(this.env, ["custom_foods"]);
        const customFoods = (kv.custom_foods as Food[] | undefined) ?? [];
        return ok({ matches: searchFoods(customFoods, query) });
      })
    );

    this.server.registerTool(
      "save_food_to_library",
      {
        title: "保存食物到食物库",
        description: "单独把一个食物的每份/每100g营养值保存到食物库，不记录到具体某一餐。用于用户只想“教会”AI一个食物的场景。",
        inputSchema: {
          name: z.string().describe("食物名称"),
          cal: z.number().describe("每份/每100g（或100ml）热量 kcal"),
          protein: z.number().optional().describe("每份/每100g 蛋白质 g"),
          carbs: z.number().optional().describe("每份/每100g 碳水化合物 g"),
          fat: z.number().optional().describe("每份/每100g 脂肪 g"),
          unit: z.enum(["g", "ml", "个"]).optional().describe("固体 g，液体 ml，按个计数用个，默认 g"),
          serving: z.number().optional().describe("一份对应多少 g/ml，默认 100"),
        },
      },
      withErrors(async (input) => {
        const kv = await getKv(this.env, ["custom_foods"]);
        const customFoods = (kv.custom_foods as Food[] | undefined) ?? [];
        const next = upsertCustomFood(customFoods, input);
        await upsertKv(this.env, "custom_foods", next);
        return ok({ saved: lookupFood(next, input.name) });
      })
    );

    this.server.registerTool(
      "log_meal",
      {
        title: "记录一餐",
        description:
          "把估算好的食物营养数据记录到日记里的某一餐。同名食物如果已经在食物库中，库里保存的营养值会优先生效（忽略本次传入的 cal/protein/carbs/fat/unit/serving）；如果是新食物，会自动保存到食物库供以后复用，行为和网页端一致。",
        inputSchema: {
          person: z.number().int().min(0).max(1).describe("记录给哪个人，0 或 1；不确定就先调用 list_people"),
          date: z.string().optional().describe("日期 YYYY-MM-DD，缺省为今天（中国时区）"),
          meal: z.enum(["早餐", "午餐", "晚餐", "加餐"]).describe("记录到哪一餐"),
          items: z.array(FoodItemInput).min(1).describe("本次要记录的食物列表"),
        },
      },
      withErrors(async ({ person, date, meal, items }) => {
        const kv = await getKv(this.env, ["diet_data2", "custom_foods"]);
        const data = (kv.diet_data2 as DietData | undefined) ?? {};
        let customFoods = (kv.custom_foods as Food[] | undefined) ?? [];

        const d = date ?? todayInShanghai();
        const pKey = String(person);
        if (!data[d]) data[d] = {};
        if (!data[d][pKey]) data[d][pKey] = defaultPersonDay();
        const personDay = data[d][pKey];
        const mealSlot = personDay.meals.find((m) => m.name === meal);
        if (!mealSlot) return fail(`未知的餐次: ${meal}`);

        const logged: Array<{ food: string; nutrition: ReturnType<typeof itemNutrition> }> = [];
        for (const raw of items) {
          let existing = lookupFood(customFoods, raw.food);
          if (!existing) {
            customFoods = upsertCustomFood(customFoods, { ...raw, name: raw.food });
            existing = lookupFood(customFoods, raw.food);
          }
          const diaryItem = toDiaryItem(raw, existing);
          mealSlot.items.push(diaryItem);
          logged.push({ food: diaryItem.food, nutrition: itemNutrition(diaryItem, existing) });
        }

        await upsertKv(this.env, "diet_data2", data);
        await upsertKv(this.env, "custom_foods", customFoods);

        const mealTotal = sumNutrition(
          mealSlot.items.map((it) => itemNutrition(it, lookupFood(customFoods, it.food)))
        );
        const dayTotal = sumNutrition(
          personDay.meals.flatMap((m) => m.items.map((it) => itemNutrition(it, lookupFood(customFoods, it.food))))
        );

        return ok({ date: d, person, meal, logged, meal_total: mealTotal, day_total: dayTotal });
      })
    );

    this.server.registerTool(
      "get_diary",
      {
        title: "查看某天的饮食日记",
        description: "返回某人某天各餐的食物明细、计算后的营养值、当天总计以及目标达成百分比",
        inputSchema: {
          person: z.number().int().min(0).max(1).describe("查看哪个人的记录"),
          date: z.string().optional().describe("日期 YYYY-MM-DD，缺省为今天（中国时区）"),
        },
      },
      withErrors(async ({ person, date }) => {
        const kv = await getKv(this.env, ["diet_data2", "custom_foods", "fitness_goals"]);
        const data = (kv.diet_data2 as DietData | undefined) ?? {};
        const customFoods = (kv.custom_foods as Food[] | undefined) ?? [];
        const goalsAll = (kv.fitness_goals as FitnessGoals | undefined) ?? {};
        const goals = goalsAll[String(person)] ?? DEFAULT_GOALS;

        const d = date ?? todayInShanghai();
        const personDay = data[d]?.[String(person)] ?? defaultPersonDay();

        const meals = personDay.meals.map((m) => {
          const items = m.items.map((it) => ({
            food: it.food,
            weight: it.weight,
            nutrition: itemNutrition(it, lookupFood(customFoods, it.food)),
          }));
          return { name: m.name, icon: m.icon, items, total: sumNutrition(items.map((i) => i.nutrition)) };
        });
        const dayTotal = sumNutrition(meals.map((m) => m.total));

        return ok({
          date: d,
          person,
          meals,
          day_total: dayTotal,
          goal: goals,
          percent_of_goal: {
            cal: goals.cal ? Math.round((dayTotal.cal / goals.cal) * 100) : null,
            protein: goals.protein ? Math.round((dayTotal.protein / goals.protein) * 100) : null,
            carbs: goals.carbs ? Math.round((dayTotal.carbs / goals.carbs) * 100) : null,
            fat: goals.fat ? Math.round((dayTotal.fat / goals.fat) * 100) : null,
          },
        });
      })
    );

    this.server.registerTool(
      "get_weekly_summary",
      {
        title: "查看近期汇总",
        description: "返回某人最近 N 天（默认 7 天）每天的营养总计、平均值以及同期体重记录",
        inputSchema: {
          person: z.number().int().min(0).max(1).describe("查看哪个人的记录"),
          end_date: z.string().optional().describe("统计截止日期 YYYY-MM-DD，缺省为今天（中国时区）"),
          days: z.number().int().min(1).max(90).optional().describe("统计最近多少天，默认 7"),
        },
      },
      withErrors(async ({ person, end_date, days }) => {
        const kv = await getKv(this.env, ["diet_data2", "custom_foods", "fitness_goals", "weight_logs"]);
        const data = (kv.diet_data2 as DietData | undefined) ?? {};
        const customFoods = (kv.custom_foods as Food[] | undefined) ?? [];
        const goalsAll = (kv.fitness_goals as FitnessGoals | undefined) ?? {};
        const goals = goalsAll[String(person)] ?? DEFAULT_GOALS;
        const weightLogs = (kv.weight_logs as WeightLogs | undefined) ?? {};

        const end = end_date ?? todayInShanghai();
        const n = days ?? 7;
        const dates = Array.from({ length: n }, (_, i) => shiftDate(end, -(n - 1 - i)));

        const perDay = dates.map((d) => {
          const personDay = data[d]?.[String(person)];
          const total = personDay
            ? sumNutrition(personDay.meals.flatMap((m) => m.items.map((it) => itemNutrition(it, lookupFood(customFoods, it.food)))))
            : { cal: 0, protein: 0, carbs: 0, fat: 0 };
          const weight = weightLogs[String(person)]?.[d] ?? null;
          return { date: d, total, weight };
        });

        const daysWithData = perDay.filter((d) => d.total.cal > 0);
        const avgSource = daysWithData.length ? daysWithData : perDay;
        const average = sumNutrition(avgSource.map((d) => d.total));
        average.cal = Math.round(average.cal / avgSource.length);
        average.protein = Math.round((average.protein / avgSource.length) * 10) / 10;
        average.carbs = Math.round((average.carbs / avgSource.length) * 10) / 10;
        average.fat = Math.round((average.fat / avgSource.length) * 10) / 10;

        return ok({ person, range: { start: dates[0], end: dates[dates.length - 1] }, days: perDay, days_with_data: daysWithData.length, average, goal: goals });
      })
    );

    this.server.registerTool(
      "get_dashboard_link",
      {
        title: "获取网页看板链接",
        description: "返回饮食记录网页的线上地址，用户可以打开查看完整的图表看板（周热量柱状图、体重趋势等）。当前网页不支持通过链接参数直接跳到某一天，只能打开首页。",
      },
      withErrors(async () => {
        return ok({ url: "https://renxiang-ch.github.io/diet-tracker/" });
      })
    );
  }
}
