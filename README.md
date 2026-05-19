# 🥗 饮食记录 Diet Tracker

一个单文件 HTML 饮食记录 Web 应用，支持双人共同记录、AI 热量估算、食物库管理、健身计划、大便记录和 Supabase 云实时同步。

**线上地址：** https://renxiang-ch.github.io/diet-tracker/

---

## 功能特性

### 饮食日记
- 按日期记录早餐、午餐、晚餐
- 支持自定义餐次（每个 person 独立）
- 食物名称自动补全（来自食物库）
- 营养数据直接在日记行编辑，自动同步到食物库
- 支持按重量（g/ml）或按份数记录
- 支持"个"单位（如 1 个苹果）
- 自定义每份量（如 220ml 为一份）
- 每餐合计热量/蛋白质/碳水/脂肪实时更新
- 每日总热量与目标对比展示

### 食物库
- 保存常用食物的营养数据（热量/蛋白质/碳水/脂肪）
- 支持 g、ml、个 三种单位
- 支持自定义每份量（如按 220ml 标注的饮料）
- 在日记行直接新增或修改食物数据，实时同步到库

### AI 估算（GPT-4o）
- 描述食物或上传图片，AI 自动估算热量和营养
- 使用 function calling 自动将新食物保存到食物库
- 聊天界面显示保存结果确认卡片

### 健身计划
- 设置每日热量/蛋白质/碳水/脂肪目标
- 设置目标体重，记录每日体重
- 每周热量柱状图（绿=达标，红=超标，蓝=未达标）
- 长期体重折线图（30/90/180/全部 天范围切换）
- 本周大便次数概览网格

### 大便记录
- 按日期记录大便时间和备注
- 支持日期导航，查看历史记录
- 双人独立记录

### 双人支持
- 两人共用同一个 Supabase，数据实时互通
- person tabs 独立切换，各自的饮食/健身/大便数据完全分开

### 云同步（Supabase）
- 使用 Supabase `kv_store` 表存储所有数据
- Supabase Realtime 实时推送，两台设备数据自动同步
- 本地 localStorage 作为缓存，断网也可使用

---

## 使用方式

1. 打开 https://renxiang-ch.github.io/diet-tracker/
2. 点击右上角 ☁ 图标，填入 Supabase URL 和 Anon Key
3. 点击「上传本地数据」或「拉取云端数据」完成初次同步
4. （可选）填入 OpenAI API Key 以启用 AI 估算功能

### Supabase 数据库配置
在 Supabase 项目中创建以下表：
```sql
CREATE TABLE kv_store (
  key TEXT PRIMARY KEY,
  value JSONB,
  updated_at TIMESTAMPTZ DEFAULT now()
);
```
并在 Database → Publications → supabase_realtime 中开启 `kv_store` 表的实时订阅。

---

## 技术栈

- 纯单文件 HTML/CSS/JS，无框架，无构建工具
- 数据存储：Supabase（云端）+ localStorage（本地缓存）
- AI：OpenAI GPT-4o，function calling
- 图表：HTML Canvas API
- 部署：GitHub Pages（push 后自动部署）

---

## 本地运行

直接用浏览器打开 `index.html` 文件即可，无需任何构建步骤。

```bash
open index.html
```
