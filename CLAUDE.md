# 饮食记录项目 (Diet Tracker)

## 项目概述
单文件 HTML 饮食记录 Web 应用，支持双人共同记录、AI 热量估算、食物库管理、健身计划、大便记录和 Supabase 云同步。

## 部署信息
- **GitHub 仓库**: `https://github.com/renxiang-ch/diet-tracker`
- **线上地址**: `https://renxiang-ch.github.io/diet-tracker/`
- **本地文件**: `/Users/ethan/diet-tracker/index.html`
- 部署方式：GitHub Pages，push 后自动部署

## 技术栈
- 纯单文件 HTML/CSS/JS，无框架无构建工具
- **数据存储**：Supabase（云端）+ localStorage（本地缓存）
- **AI**：OpenAI GPT-4o，使用 function calling 自动保存食物到食物库
- **图表**：HTML Canvas API

## 页面结构（5 个 mode）
| mode | 面板 ID | 说明 |
|------|---------|------|
| `diary` | `.container` | 饮食日记主页面 |
| `ai` | `#ai-panel` | AI 估算聊天 |
| `lib` | `#lib-panel` | 食物库管理 |
| `fitness` | `#fitness-panel` | 健身计划 + 体重趋势 |
| `poop` | `#poop-panel` | 大便记录 |

切换用 `setMode(mode)`，person tabs 在 diary、fitness、poop 模式下显示。

## localStorage 键（本地缓存，同时同步到 Supabase）
```
"diet_data2"      → data[dateStr][personIndex] = { meals: [{name, icon, items:[]}], note }
"person_names"    → ["我", "TA"]
"custom_foods"    → [{name, cal, protein, carbs, fat, unit, serving, custom:true}]
"fitness_goals"   → {"0": {cal, protein, carbs, fat, weightTarget}, "1": {...}}
"weight_logs"     → {"0": {"2026-05-16": 72.5, ...}, "1": {...}}
"poop_logs"       → {"0": {"2026-05-16": [{time:"08:30", note:""}], ...}, "1": {...}}
"openai_api_key"  → string（不同步到云端）
"sb_url"          → Supabase 项目 URL（不同步到云端）
"sb_key"          → Supabase Anon/Publishable Key（不同步到云端）
```

## Supabase 云同步
- **表名**：`kv_store`，结构：`key TEXT PRIMARY KEY, value JSONB, updated_at TIMESTAMPTZ`
- **同步的键**：`diet_data2`, `custom_foods`, `fitness_goals`, `weight_logs`, `person_names`, `poop_logs`
- **实时同步**：通过 Supabase Realtime（需在 Publications → supabase_realtime 中开启 kv_store）
- 两人使用同一个 Supabase URL 和 Key，数据实时互通
- 云端按整个 key 的 JSON 覆盖存储，不是按条目增量更新

## 食物数据结构
```js
// 食物库 custom_foods 条目
{ name, cal, protein, carbs, fat, unit, serving, custom: true }
// unit: "g" | "ml" | "个"
// serving: 营养数据对应的基准量（默认100，个=1，自定义如220）

// 日记 item
{ id, food, weight, calPer, protein, carbs, fat, unit, servingMode }
// servingMode: true 时 weight 表示份数，false/undefined 时 weight 表示实际克/毫升/个数
// weight 为空或 0 时 effectiveW = serving（自动按 1 份计算）
```

## 营养计算逻辑（itemNutrition）
```js
serving = food.unit === "个" ? 1 : (food.serving || 100)

// 份数模式（servingMode=true）
cal = weight × calPer

// 重量模式（默认）
effectiveW = weight || serving   // 空/0 时默认 1 份
cal = effectiveW × calPer / serving
```

## 关键函数
- `itemNutrition(item)` — 计算单条食物的热量和宏量营养素（支持 servingMode）
- `maybeSaveCustomFood(item)` — 自动保存食物到食物库（读取 item.unit，个=serving:1）
- `setMode(mode)` — 切换页面模式
- `render()` — 重新渲染饮食日记
- `renderFitness()` — 重新渲染健身计划页
- `renderLib()` — 重新渲染食物库
- `renderPoop()` — 重新渲染大便记录页
- `renderPoopWeekGrid(p, days, dayLabels)` — 渲染健身计划内的本周大便次数格子
- `cloudSave(key, value)` — 保存到 localStorage + Supabase（异步，fire-and-forget）
- `cloudPull()` — 从 Supabase 拉取所有数据并覆盖本地
- `cloudPush()` — 把本地数据全量上传到 Supabase
- `executeLibrarySave(foods)` — AI function calling 回调，批量保存食物到库
- `todayStr()` — 返回本地时区今日日期字符串（用 getFullYear/getMonth/getDate，非 UTC）

## AI 功能
- 模型：GPT-4o，支持图片上传
- 使用 OpenAI tools API（function calling），工具名：`save_foods_to_library`
- AI 估算食物热量后自动调用工具将食物保存到食物库
- 保存成功后在聊天界面显示绿色卡片确认

## 双人支持
- `currentPerson`：0 或 1
- 所有数据按 person index 分开存储
- person tabs 点击时：diary 模式调 `render()`，fitness/poop 模式调对应 render 函数
- 人名存在 `personNames` 数组，修改时 input 事件只更新头像，blur 事件才保存

## 图表与可视化
- `drawBarChart(canvas, values, goal, labels)` — 每周热量柱状图（绿=达标，红=超标，蓝=未达标）
- `drawWeightTrendCanvas(canvas, entries, goalWeight)` — 长期体重折线图，支持 30/90/180/全部 天
- 健身计划页大便记录区：7 格网格，每格显示当天次数和 💩 emoji

## 日记行为细节
- 已保存食物：营养列显示计算后合计值（readonly input），随重量输入实时更新
- 未保存食物：营养列为可编辑 input，填入热量后自动保存到食物库
- 食物库中的已保存食物（g/ml）：重量列单位下拉支持切换「原单位 ↔ 份」
- 新食物（未保存）：单位下拉支持 g/ml/个，保存时携带 unit 和 serving

## 常用 Git 命令
```bash
git add index.html
git commit -m "描述"
git push
```
