import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "./env";
import { getKv, upsertKv } from "./supabase";
import {
  DEFAULT_GOALS,
  currentTimeForPerson,
  defaultPersonDay,
  itemNutrition,
  lookupFood,
  searchFoods,
  sumNutrition,
  todayForPerson,
  timeZoneForPerson,
  upsertCustomFood,
  type DiaryItem,
  type Food,
  type PersonDay,
} from "./nutrition";

type DietData = Record<string, Record<string, PersonDay>>;
type FitnessGoals = Record<string, typeof DEFAULT_GOALS>;
type WeightLogs = Record<string, Record<string, number>>;
type PoopEntry = { time: string; note: string };
type PoopLogs = Record<string, Record<string, PoopEntry[]>>;
type PeriodCycle = { id: number; startDate: string; endDate: string | null };

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
        return ok({
          people: names.map((name, person) => ({
            person,
            name,
            time_zone: timeZoneForPerson(person),
          })),
        });
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
      "edit_food_library",
      {
        title: "修改食物库",
        description:
          "修改食物库中一个已存在的食物，可更改名称、营养值、单位或每份大小。只需传要修改的字段；如果修改名称，会同步更新历史饮食记录中的同名食物。",
        inputSchema: {
          current_name: z.string().min(1).describe("食物库中当前的准确名称；不确定时先调用 search_food_library"),
          new_name: z.string().min(1).optional().describe("修改后的食物名称；不改名则留空"),
          cal: z.number().min(0).optional().describe("修改后的每份/每100g（或100ml）热量 kcal"),
          protein: z.number().min(0).optional().describe("修改后的每份/每100g 蛋白质 g"),
          carbs: z.number().min(0).optional().describe("修改后的每份/每100g 碳水化合物 g"),
          fat: z.number().min(0).optional().describe("修改后的每份/每100g 脂肪 g"),
          unit: z.enum(["g", "ml", "个"]).optional().describe("修改后的单位：g、ml 或个"),
          serving: z.number().positive().optional().describe("修改后的一份对应多少 g/ml；单位为“个”时固定为 1"),
        },
      },
      withErrors(async ({ current_name, new_name, cal, protein, carbs, fat, unit, serving }) => {
        const hasChange =
          new_name !== undefined ||
          cal !== undefined ||
          protein !== undefined ||
          carbs !== undefined ||
          fat !== undefined ||
          unit !== undefined ||
          serving !== undefined;
        if (!hasChange) return fail("至少提供一个要修改的字段");

        const kv = await getKv(this.env, ["custom_foods", "diet_data2"]);
        const customFoods = (kv.custom_foods as Food[] | undefined) ?? [];
        const data = (kv.diet_data2 as DietData | undefined) ?? {};
        const current = lookupFood(customFoods, current_name);
        if (!current) return fail(`食物库中没有“${current_name.trim()}”，请先调用 search_food_library 确认名称`);

        const nextName = new_name?.trim() ?? current.name;
        const duplicate = lookupFood(customFoods, nextName);
        if (duplicate && duplicate !== current) return fail(`食物库中已存在“${nextName}”，不能重命名为重复名称`);

        const nextUnit = unit ?? current.unit;
        const updated: Food = {
          ...current,
          name: nextName,
          cal: cal ?? current.cal,
          protein: protein ?? current.protein,
          carbs: carbs ?? current.carbs,
          fat: fat ?? current.fat,
          unit: nextUnit,
          serving: nextUnit === "个" ? 1 : serving ?? current.serving ?? 100,
          custom: true,
        };
        const nextFoods = customFoods.map((food) => (food === current ? updated : food));

        let renamed_diary_items = 0;
        if (nextName.toLowerCase() !== current.name.toLowerCase()) {
          for (const peopleByDate of Object.values(data)) {
            for (const personDay of Object.values(peopleByDate)) {
              for (const meal of personDay.meals) {
                for (const item of meal.items) {
                  if (item.food.trim().toLowerCase() === current.name.toLowerCase()) {
                    item.food = nextName;
                    renamed_diary_items++;
                  }
                }
              }
            }
          }
        }

        await upsertKv(this.env, "custom_foods", nextFoods);
        if (renamed_diary_items > 0) await upsertKv(this.env, "diet_data2", data);
        return ok({
          updated: true,
          previous_name: current.name,
          food: updated,
          renamed_diary_items,
        });
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
          date: z.string().optional().describe("日期 YYYY-MM-DD，缺省为该使用者所在时区的今天"),
          meal: z.enum(["早餐", "午餐", "晚餐", "加餐"]).describe("记录到哪一餐"),
          items: z.array(FoodItemInput).min(1).describe("本次要记录的食物列表"),
        },
      },
      withErrors(async ({ person, date, meal, items }) => {
        const kv = await getKv(this.env, ["diet_data2", "custom_foods"]);
        const data = (kv.diet_data2 as DietData | undefined) ?? {};
        let customFoods = (kv.custom_foods as Food[] | undefined) ?? [];

        const d = date ?? todayForPerson(person);
        const pKey = String(person);
        if (!data[d]) data[d] = {};
        if (!data[d][pKey]) data[d][pKey] = defaultPersonDay();
        const personDay = data[d][pKey];
        const mealSlot = personDay.meals.find((m) => m.name === meal);
        if (!mealSlot) return fail(`未知的餐次: ${meal}`);

        const logged: Array<{ item_id: number; food: string; nutrition: ReturnType<typeof itemNutrition> }> = [];
        for (const raw of items) {
          let existing = lookupFood(customFoods, raw.food);
          if (!existing) {
            customFoods = upsertCustomFood(customFoods, { ...raw, name: raw.food });
            existing = lookupFood(customFoods, raw.food);
          }
          const diaryItem = toDiaryItem(raw, existing);
          mealSlot.items.push(diaryItem);
          logged.push({ item_id: diaryItem.id, food: diaryItem.food, nutrition: itemNutrition(diaryItem, existing) });
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
      "edit_meal_item",
      {
        title: "修改或删除饮食记录",
        description:
          "根据 get_diary 返回的 item_id 精确修改或删除一条已有饮食记录。修改食物营养值时会同步更新食物库；也可以修改重量或把记录移动到另一餐。",
        inputSchema: {
          action: z.enum(["update", "delete"]).describe("update 修改记录；delete 删除记录"),
          person: z.number().int().min(0).max(1).describe("记录属于哪个人，0 或 1"),
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("记录日期 YYYY-MM-DD"),
          item_id: z.number().describe("get_diary 返回的 item_id"),
          meal: z.enum(["早餐", "午餐", "晚餐", "加餐"]).optional().describe("修改后要归入的餐次；不填则保留原餐次"),
          food: z.string().min(1).optional().describe("修改后的食物名称"),
          weight: z.number().min(0).optional().describe("修改后的实际重量、毫升数、个数或份数"),
          cal: z.number().min(0).optional().describe("修改后的每份/每100g热量 kcal"),
          protein: z.number().min(0).optional().describe("修改后的每份/每100g蛋白质 g"),
          carbs: z.number().min(0).optional().describe("修改后的每份/每100g碳水 g"),
          fat: z.number().min(0).optional().describe("修改后的每份/每100g脂肪 g"),
          unit: z.enum(["g", "ml", "个"]).optional().describe("修改后的单位"),
          serving: z.number().positive().optional().describe("修改后的一份对应多少 g/ml"),
          serving_mode: z.boolean().optional().describe("weight 是否表示份数，仅适用于 g/ml 食物"),
        },
      },
      withErrors(async ({ action, person, date, item_id, meal, food, weight, cal, protein, carbs, fat, unit, serving, serving_mode }) => {
        const kv = await getKv(this.env, ["diet_data2", "custom_foods"]);
        const data = (kv.diet_data2 as DietData | undefined) ?? {};
        let customFoods = (kv.custom_foods as Food[] | undefined) ?? [];
        const personDay = data[date]?.[String(person)];
        if (!personDay) return fail(`未找到 ${date} 的 person ${person} 饮食记录`);

        const sourceMeal = personDay.meals.find((slot) => slot.items.some((item) => item.id === item_id));
        const itemIndex = sourceMeal?.items.findIndex((item) => item.id === item_id) ?? -1;
        if (!sourceMeal || itemIndex < 0) return fail(`未找到 item_id=${item_id} 的饮食记录，请先调用 get_diary 获取最新 item_id`);
        const item = sourceMeal.items[itemIndex];

        if (action === "delete") {
          sourceMeal.items.splice(itemIndex, 1);
          await upsertKv(this.env, "diet_data2", data);
          return ok({ deleted: true, person, date, meal: sourceMeal.name, item_id, food: item.food });
        }

        const nextFoodName = food?.trim() ?? item.food;
        const existingFood = lookupFood(customFoods, nextFoodName);
        const nutritionChanged = cal !== undefined || protein !== undefined || carbs !== undefined || fat !== undefined;
        if (!existingFood && food !== undefined && cal === undefined) {
          return fail(`食物库中没有“${nextFoodName}”，修改为新食物时必须同时提供 cal`);
        }

        item.food = nextFoodName;
        if (weight !== undefined) item.weight = weight;
        if (unit !== undefined) item.unit = unit;
        if (serving !== undefined) item.serving = serving;
        if (serving_mode !== undefined) item.servingMode = serving_mode;

        if (nutritionChanged || (!existingFood && cal !== undefined)) {
          const baseCal = (cal ?? existingFood?.cal ?? Number(item.calPer)) || 0;
          const baseProtein = (protein ?? existingFood?.protein ?? Number(item.protein)) || 0;
          const baseCarbs = (carbs ?? existingFood?.carbs ?? Number(item.carbs)) || 0;
          const baseFat = (fat ?? existingFood?.fat ?? Number(item.fat)) || 0;
          customFoods = upsertCustomFood(customFoods, {
            name: nextFoodName,
            cal: baseCal,
            protein: baseProtein,
            carbs: baseCarbs,
            fat: baseFat,
            unit: unit ?? item.unit,
            serving: (serving ?? Number(item.serving)) || 100,
          });
          item.calPer = baseCal;
          item.protein = baseProtein;
          item.carbs = baseCarbs;
          item.fat = baseFat;
        }

        let targetMeal = sourceMeal;
        if (meal && meal !== sourceMeal.name) {
          const destination = personDay.meals.find((slot) => slot.name === meal);
          if (!destination) return fail(`未知的餐次: ${meal}`);
          sourceMeal.items.splice(itemIndex, 1);
          destination.items.push(item);
          targetMeal = destination;
        }

        await upsertKv(this.env, "diet_data2", data);
        if (nutritionChanged || (!existingFood && cal !== undefined)) {
          await upsertKv(this.env, "custom_foods", customFoods);
        }
        const savedFood = lookupFood(customFoods, item.food);
        return ok({
          updated: true,
          person,
          date,
          meal: targetMeal.name,
          item: {
            item_id: item.id,
            food: item.food,
            weight: item.weight,
            nutrition: itemNutrition(item, savedFood),
          },
        });
      })
    );

    this.server.registerTool(
      "get_diary",
      {
        title: "查看某天的饮食日记",
        description: "返回某人某天各餐的食物明细、计算后的营养值、当天总计以及目标达成百分比",
        inputSchema: {
          person: z.number().int().min(0).max(1).describe("查看哪个人的记录"),
          date: z.string().optional().describe("日期 YYYY-MM-DD，缺省为该使用者所在时区的今天"),
        },
      },
      withErrors(async ({ person, date }) => {
        const kv = await getKv(this.env, ["diet_data2", "custom_foods", "fitness_goals"]);
        const data = (kv.diet_data2 as DietData | undefined) ?? {};
        const customFoods = (kv.custom_foods as Food[] | undefined) ?? [];
        const goalsAll = (kv.fitness_goals as FitnessGoals | undefined) ?? {};
        const goals = goalsAll[String(person)] ?? DEFAULT_GOALS;

        const d = date ?? todayForPerson(person);
        const personDay = data[d]?.[String(person)] ?? defaultPersonDay();

        const meals = personDay.meals.map((m) => {
          const items = m.items.map((it) => ({
            item_id: it.id,
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
          end_date: z.string().optional().describe("统计截止日期 YYYY-MM-DD，缺省为该使用者所在时区的今天"),
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

        const end = end_date ?? todayForPerson(person);
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
      "log_poop",
      {
        title: "记录大便",
        description: "给指定使用者记录一次大便，数据写入网页共用的 poop_logs；日期和时间不填时使用该使用者所在时区的当前日期和时间。",
        inputSchema: {
          person: z.number().int().min(0).max(1).describe("记录给哪个人，0 或 1；不确定就先调用 list_people"),
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("日期 YYYY-MM-DD，缺省为该使用者所在时区的今天"),
          time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().describe("时间 HH:MM，24 小时制；缺省为该使用者所在时区的当前时间"),
          note: z.string().max(50).optional().describe("备注，最多 50 个字符，例如正常、偏稀、便秘"),
        },
      },
      withErrors(async ({ person, date, time, note }) => {
        const kv = await getKv(this.env, ["poop_logs"]);
        const logs = (kv.poop_logs as PoopLogs | undefined) ?? {};
        const personKey = String(person);
        const d = date ?? todayForPerson(person);
        const entry = { time: time ?? currentTimeForPerson(person), note: note?.trim() ?? "" };

        if (!logs[personKey]) logs[personKey] = {};
        if (!logs[personKey][d]) logs[personKey][d] = [];
        logs[personKey][d].push(entry);
        await upsertKv(this.env, "poop_logs", logs);

        return ok({ recorded: true, person, date: d, entry, count_for_day: logs[personKey][d].length });
      })
    );

    this.server.registerTool(
      "get_poop_logs",
      {
        title: "查看大便记录",
        description: "查询指定使用者截至某天的近期大便记录，返回每天的次数、时间和备注。",
        inputSchema: {
          person: z.number().int().min(0).max(1).describe("查看哪个人的记录，0 或 1"),
          end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("查询截止日期 YYYY-MM-DD，缺省为该使用者所在时区的今天"),
          days: z.number().int().min(1).max(90).optional().describe("查询最近多少天，默认 7，最多 90"),
        },
      },
      withErrors(async ({ person, end_date, days }) => {
        const kv = await getKv(this.env, ["poop_logs"]);
        const logs = (kv.poop_logs as PoopLogs | undefined) ?? {};
        const end = end_date ?? todayForPerson(person);
        const n = days ?? 7;
        const dates = Array.from({ length: n }, (_, i) => shiftDate(end, -(n - 1 - i)));
        const records = dates.map((date) => {
          const entries = logs[String(person)]?.[date] ?? [];
          return { date, count: entries.length, entries };
        });
        return ok({
          person,
          range: { start: dates[0], end: dates[dates.length - 1] },
          total_count: records.reduce((sum, day) => sum + day.count, 0),
          days: records,
        });
      })
    );

    this.server.registerTool(
      "start_period",
      {
        title: "记录月经开始",
        description: "为第二位使用者（person 1）记录一次月经开始日期。仅允许同时存在一个尚未结束的周期。",
        inputSchema: {
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("开始日期 YYYY-MM-DD，缺省为 person 1 所在时区的今天"),
        },
      },
      withErrors(async ({ date }) => {
        const kv = await getKv(this.env, ["period_logs"]);
        const cycles = (kv.period_logs as PeriodCycle[] | undefined) ?? [];
        const active = cycles.find((cycle) => !cycle.endDate);
        if (active) return fail(`已有进行中的周期，开始于 ${active.startDate}，请先记录结束日期`);

        const cycle: PeriodCycle = { id: Date.now() + Math.random(), startDate: date ?? todayForPerson(1), endDate: null };
        cycles.push(cycle);
        await upsertKv(this.env, "period_logs", cycles);
        return ok({ recorded: true, person: 1, cycle });
      })
    );

    this.server.registerTool(
      "end_period",
      {
        title: "记录月经结束",
        description: "为第二位使用者（person 1）结束当前进行中的月经周期。",
        inputSchema: {
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("结束日期 YYYY-MM-DD，缺省为 person 1 所在时区的今天"),
        },
      },
      withErrors(async ({ date }) => {
        const kv = await getKv(this.env, ["period_logs"]);
        const cycles = (kv.period_logs as PeriodCycle[] | undefined) ?? [];
        const active = [...cycles].sort((a, b) => b.startDate.localeCompare(a.startDate)).find((cycle) => !cycle.endDate);
        if (!active) return fail("当前没有进行中的月经周期");

        const endDate = date ?? todayForPerson(1);
        if (endDate < active.startDate) return fail(`结束日期不能早于开始日期 ${active.startDate}`);
        active.endDate = endDate;
        await upsertKv(this.env, "period_logs", cycles);
        return ok({ recorded: true, person: 1, cycle: active });
      })
    );

    this.server.registerTool(
      "get_period_history",
      {
        title: "查看月经周期记录",
        description: "查询第二位使用者（person 1）的月经周期历史，包括开始、结束、持续天数和进行中状态。",
        inputSchema: {
          limit: z.number().int().min(1).max(24).optional().describe("返回最近多少个周期，默认 12，最多 24"),
        },
      },
      withErrors(async ({ limit }) => {
        const kv = await getKv(this.env, ["period_logs"]);
        const cycles = ((kv.period_logs as PeriodCycle[] | undefined) ?? [])
          .slice()
          .sort((a, b) => b.startDate.localeCompare(a.startDate))
          .slice(0, limit ?? 12)
          .map((cycle) => ({
            ...cycle,
            ongoing: !cycle.endDate,
            duration_days: cycle.endDate
              ? Math.round((Date.parse(`${cycle.endDate}T00:00:00Z`) - Date.parse(`${cycle.startDate}T00:00:00Z`)) / 86400000) + 1
              : null,
          }));
        return ok({ person: 1, count: cycles.length, cycles });
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
