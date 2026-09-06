# 🥗 Diet Tracker｜饮食记录

一个轻量、单文件的双人饮食与健康记录网页，支持 Supabase 实时同步，并提供远程 MCP 服务和 ChatGPT/Codex 插件包。

A lightweight, single-file diet and health tracker for two people, with Supabase realtime sync and a remote MCP integration for ChatGPT and Codex.

**在线使用 / Live:** [renxiang-ch.github.io/diet-tracker](https://renxiang-ch.github.io/diet-tracker/)

## 功能

- **饮食日记**：按日期和餐次记录食物，自动计算每日热量、蛋白质、碳水和脂肪。
- **食物库**：保存常用食物的营养数据、单位及自定义每份大小。
- **AI 营养估算**：通过文字或照片识别食物，将估算结果保存到食物库。
- **健身计划**：设置每日营养目标、记录体重、查看周热量和长期体重趋势。
- **排便记录**：按人员和日期保存时间及备注。
- **月经周期**：记录周期开始、结束和历史。
- **双人实时同步**：两位使用者可以通过同一个 Supabase 项目同步数据。
- **ChatGPT/Codex MCP**：从聊天中查询食物库、记录饮食、修改记录和查看汇总。

## 项目结构

```text
diet-tracker/
├── index.html                         # 单文件网页应用
├── mcp-server/                        # Cloudflare Workers MCP 服务
│   ├── src/
│   │   ├── index.ts                   # OAuth 和 Worker 入口
│   │   ├── mcp-agent.ts               # MCP 工具
│   │   ├── nutrition.ts               # 营养计算和时区逻辑
│   │   └── supabase.ts                # Supabase 数据访问
│   └── wrangler.toml                  # Cloudflare 配置
├── plugins/diet-tracker/              # ChatGPT/Codex 插件包
├── .agents/plugins/marketplace.json   # 仓库 Marketplace 清单
├── PUBLIC_RELEASE.md                  # 英文公开发布计划
└── PUBLIC_RELEASE.zh-CN.md            # 中文公开发布指南
```

## 快速开始：网页

1. 打开[在线页面](https://renxiang-ch.github.io/diet-tracker/)。
2. 点击右上角云朵按钮。
3. 填写 Supabase Project URL 和 Anon Key。
4. 首次使用时根据数据方向选择上传或拉取。
5. 如需网页内 AI 营养估算，可选填 OpenAI API Key。

网页会先将数据保存在浏览器 `localStorage`。完成 Supabase 配置后，可以在设备之间实时同步。

## Supabase 配置

在 Supabase SQL Editor 中创建数据表：

```sql
CREATE TABLE kv_store (
  key TEXT PRIMARY KEY,
  value JSONB,
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

还需要：

1. 为网页使用的 anon 角色配置必要的读取和写入策略；
2. 在 **Database → Publications → supabase_realtime** 中启用 `kv_store`；
3. 将相同的 Supabase URL 和 Key 配置到网页及个人版 MCP Worker。

> 当前数据结构面向个人或家庭共享。如果要向互不认识的公共用户提供服务，不能使用完全开放的匿名策略，必须加入用户身份和 Row Level Security。

## MCP 服务

MCP 服务位于 [`mcp-server/`](./mcp-server/)，包含 14 个工具：

- `list_people`
- `search_food_library`
- `save_food_to_library`
- `edit_food_library`
- `log_meal`
- `edit_meal_item`
- `get_diary`
- `get_weekly_summary`
- `log_poop`
- `get_poop_logs`
- `start_period`
- `end_period`
- `get_period_history`
- `get_dashboard_link`

安装和检查：

```bash
cd mcp-server
npm install
npm run typecheck
```

首次部署到 Cloudflare：

```bash
npx wrangler login
npx wrangler kv namespace create OAUTH_KV
npx wrangler secret put SB_URL
npx wrangler secret put SB_KEY
npx wrangler secret put MCP_PASSWORD
npx wrangler deploy
```

部署后的 MCP 地址格式为：

```text
https://<worker-name>.<account-subdomain>.workers.dev/mcp
```

详细说明见 [`mcp-server/README.md`](./mcp-server/README.md)。

## ChatGPT / Codex 插件

插件包位于 [`plugins/diet-tracker/`](./plugins/diet-tracker/)，包含标准 `.codex-plugin/plugin.json`、远程 MCP 配置和工具使用指引。

当前托管的 MCP 是**私人单用户版本**：

- 使用一个共享的 `MCP_PASSWORD`；
- 所有请求访问同一份 Supabase 数据；
- 只适合个人或可信家庭成员使用；
- 还不能作为公共多用户服务提交审核。

如果希望用户在 ChatGPT 中搜索到插件并安装后直接使用，应由发布者统一托管 Supabase 和 Worker，用户不需要自行配置数据库；但必须先实现 OAuth 用户登录、数据库隔离、RLS、隐私政策、数据导出和删除能力。

- [中文公开发布指南](./PUBLIC_RELEASE.zh-CN.md)
- [English public release plan](./PUBLIC_RELEASE.md)

## 开发验证

```bash
# 检查 MCP TypeScript
npm --prefix mcp-server run typecheck

# 检查网页内联 JavaScript 语法
sed -n '1541,3622p' index.html > /tmp/diet-tracker-inline.js
node --check /tmp/diet-tracker-inline.js
```

建议在每次部署后依次测试：

1. `list_people`：验证 OAuth 和数据库读取；
2. `get_diary`：验证日记读取；
3. `log_meal`：写入一条容易识别的测试记录；
4. 再次调用 `get_diary`：确认写入能够读回；
5. 使用 `edit_meal_item` 删除测试记录。

查看线上 Worker 日志：

```bash
cd mcp-server
npx wrangler tail
```

## 安全提示

- 不要把 Supabase Key、OpenAI API Key、OAuth secret、`MCP_PASSWORD` 或 GitHub Token 提交到仓库。
- Cloudflare secret 的值不能查看，只能使用 `wrangler secret put` 重新设置。
- 公共版本必须确保不同用户无法读取或修改彼此的饮食及健康数据。
- 饮食、体重、排便和月经周期属于敏感的个人健康相关信息，应避免写入普通日志。

## 更新记录

### 2026-09-06

- MCP 扩展到 14 个工具。
- 增加饮食记录修改与删除、食物库编辑、排便记录和月经周期工具。
- 根据两位使用者的独立时区计算默认日期和时间。
- 增加 ChatGPT/Codex 插件包及仓库 Marketplace。
- 增加中英文公共发布指南。

### 2026-05-23

- 修复营养输入过程中焦点丢失的问题。
- 修复 Chrome 将 API Key 输入框识别为密码的问题。
- 修复饮食记录与食物库营养数据不同步的问题。

### 2026-05-19

- 修复排便日期、日期导航和备注输入问题。
- 饮食营养字段支持直接编辑，并同步回食物库。
- 支持从日记中直接添加新食物。

### 2026-05-16

- 增加排便记录、自定义每份大小和按个计数。
- 增加按重量或份数记录食物的模式。
- 修复本地日期时区问题。

### 2026-05-14

- 增加双人支持、Supabase Realtime 和 AI 营养估算。

## License

本仓库目前尚未添加开源许可证。在明确许可证之前，代码默认保留所有权利。
