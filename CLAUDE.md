# 饮食记录项目 (Diet Tracker)

## 项目概述
单文件 HTML 饮食记录 Web 应用，支持双人共同记录、AI 热量估算、食物库管理、健身计划和 Supabase 云同步。

## 部署信息
- **GitHub 仓库**: `https://github.com/renxiang-ch/diet-tracker`
- **线上地址**: `https://renxiang-ch.github.io/diet-tracker/`
- **本地文件**: `/Users/ethan/diet-tracker/index.html`（即原 `diet-tracker.html`）
- 部署方式：GitHub Pages，push 后自动部署

## 技术栈
- 纯单文件 HTML/CSS/JS，无框架无构建工具
- **数据存储**：Supabase（云端）+ localStorage（本地缓存）
- **AI**：OpenAI GPT-4o，使用 function calling 自动保存食物到食物库
- **图表**：HTML Canvas API

## 页面结构（4 个 mode）
| mode | 面板 ID | 说明 |
|------|---------|------|
| `diary` | `.container` | 饮食日记主页面 |
| `ai` | `#ai-panel` | AI 估算聊天 |
| `lib` | `#lib-panel` | 食物库管理 |
| `fitness` | `#fitness-panel` | 健身计划 + 体重趋势 |

切换用 `setMode(mode)`，person tabs 在 diary 和 fitness 模式下显示。

## localStorage 键（本地缓存，同时同步到 Supabase）
```
"diet_data2"      → data[dateStr][personIndex] = { meals: [{name, icon, items:[]}], note }
"person_names"    → ["我", "TA"]
"custom_foods"    → [{name, cal, protein, carbs, fat, unit, custom:true, note?}]
"fitness_goals"   → {"0": {cal, protein, carbs, fat, weightTarget}, "1": {...}}
"weight_logs"     → {"0": {"2026-05-16": 72.5, ...}, "1": {...}}
"openai_api_key"  → string（不同步到云端）
"sb_url"          → Supabase 项目 URL（不同步到云端）
"sb_key"          → Supabase Anon/Publishable Key（不同步到云端）
```

## Supabase 云同步
- **表名**：`kv_store`，结构：`key TEXT PRIMARY KEY, value JSONB, updated_at TIMESTAMPTZ`
- **同步的键**：`diet_data2`, `custom_foods`, `fitness_goals`, `weight_logs`, `person_names`
- **实时同步**：通过 Supabase Realtime（需在 Publications → supabase_realtime 中开启 kv_store）
- 两人使用同一个 Supabase URL 和 Key，数据实时互通

## 食物数据结构
```js
// item = { id, food, weight, calPer, protein, carbs, fat }
// 所有营养值为每 100g 的含量
// weight 为空或 0 时 effectiveW = 100（适用于不需要称重的食物）
```

## 关键函数
- `itemNutrition(item)` — 计算单条食物的热量和宏量营养素
- `maybeSaveCustomFood(item)` — 自动保存食物到食物库（name + calPer 必填，其余默认 0）
- `setMode(mode)` — 切换页面模式
- `render()` — 重新渲染饮食日记
- `renderFitness()` — 重新渲染健身计划页（含更新 person tab 高亮）
- `renderLib()` — 重新渲染食物库
- `cloudSave(key, value)` — 保存到 localStorage + Supabase
- `cloudPull()` — 从 Supabase 拉取所有数据并刷新界面
- `cloudPush()` — 把本地数据全量上传到 Supabase
- `executeLibrarySave(foods)` — AI function calling 回调，批量保存食物到库

## AI 功能
- 模型：GPT-4o，支持图片上传
- 使用 OpenAI tools API（function calling），工具名：`save_foods_to_library`
- AI 估算食物热量后自动调用工具将食物保存到食物库
- 保存成功后在聊天界面显示绿色卡片确认

## 双人支持
- `currentPerson`：0 或 1
- 所有数据按 person index 分开存储
- person tabs 点击时：diary 模式调 `render()`，fitness 模式调 `renderFitness()`
- 人名存在 `personNames` 数组，修改时 input 事件只更新头像，blur 事件才保存（避免云端推回覆盖正在输入的内容）

## 热量图表
- `drawBarChart(canvas, values, goal, labels)` — 每周热量柱状图（绿=达标，红=超标，蓝=未达标）
- `drawWeightTrendCanvas(canvas, entries, goalWeight)` — 长期体重折线图，支持 30/90/180/全部 天范围

## 常用 Git 命令
```bash
# 更新文件
cp /Users/ethan/Desktop/健康记录项目/diet-tracker.html /Users/ethan/diet-tracker/index.html

# 推送更新
cd /Users/ethan/diet-tracker
git add index.html
git commit -m "更新功能"
git push
```
