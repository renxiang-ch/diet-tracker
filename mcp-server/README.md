# diet-tracker-mcp

把 [diet-tracker](../index.html) 的记录/查询功能封装成一个远程 MCP Server，部署在 Cloudflare Workers 上，供 ChatGPT 的自定义连接器（Connector）接入。数据读写走的是网页已经在用的同一个 Supabase `kv_store` 表，两边数据完全互通。

## 它能做什么

ChatGPT 自己负责看图/估算营养（本项目不调用 OpenAI），通过下面 14 个工具把结果读写进 Supabase：

- `list_people` —— 查两位使用者的名字，确定 person 编号（0/1）
- `search_food_library` —— 按名字搜食物库，估算前先查一下，避免和历史记录不一致
- `save_food_to_library` —— 单独把一个食物存进库，不记某一餐
- `edit_food_library` —— 修改食物库中已有食物的名称、营养值、单位或每份大小
- `log_meal` —— 核心工具：把食物记进某天某一餐
- `edit_meal_item` —— 按 `item_id` 修改或删除已有饮食记录
- `get_diary` —— 查某天的完整日记 + 达标百分比
- `get_weekly_summary` —— 查最近 N 天的汇总 + 体重趋势
- `log_poop` —— 记录一次大便（日期、时间、备注），与网页大便记录同步
- `get_poop_logs` —— 查询某人最近 N 天的大便次数和明细
- `start_period` —— 为第二位使用者记录月经开始日期
- `end_period` —— 为第二位使用者结束当前月经周期
- `get_period_history` —— 查询第二位使用者的月经周期历史
- `get_dashboard_link` —— 返回网页看板地址 `https://renxiang-ch.github.io/diet-tracker/`

## 部署步骤

```bash
cd mcp-server
npm install
npx wrangler login

# 1. 创建 KV namespace（用于存 OAuth token），把返回的 id 填进 wrangler.toml 的 OAUTH_KV.id
npx wrangler kv namespace create OAUTH_KV

# 2. 设置密钥（SB_URL / SB_KEY 和网页"云同步"设置面板里填的值完全一样）
npx wrangler secret put SB_URL
npx wrangler secret put SB_KEY
npx wrangler secret put MCP_PASSWORD   # 自己定一个密码，连接 ChatGPT 时要输入

# 3. 部署
npx wrangler deploy
```

部署成功后会得到一个形如 `https://diet-tracker-mcp.<你的子域名>.workers.dev` 的地址。

## 接入 ChatGPT

1. ChatGPT 设置 → Connectors（连接器）→ 开启 Developer mode / 添加自定义连接器
2. 服务器地址填 `https://<你的worker地址>/mcp`
3. Authentication 选 **OAuth**
4. 走一次授权：会跳到一个简单的密码输入页，输入你在 `MCP_PASSWORD` 里设置的密码即可

> ChatGPT 自定义连接器目前只支持"无鉴权"或"OAuth"两种方式，不支持简单的 API Key/Bearer Token，所以这里用 `@cloudflare/workers-oauth-provider` 自建了一个单用户密码式的极简 OAuth 授权页（见 `src/index.ts`），不接第三方登录。

### 建议给 ChatGPT 项目/对话加的自定义指令

可以直接粘贴到 ChatGPT 项目设置的"自定义指令"里（可根据实际情况调整）：

```
你连接了一个饮食记录 MCP 工具。当用户发来食物图片或文字描述时：
1. 自己估算每种食物的营养成分（每100g或每份的热量kcal、蛋白质、碳水、脂肪），风格参考营养数据库，合理但不用过度精确。
2. 记录前先调用 search_food_library 看这个食物是否已经存过，如果存过就沿用库里的数值，不要自己重新估算。
   用户要求纠正食物库中的名称、营养值、单位或份量时，先搜索确认准确名称，再调用 edit_food_library；不要用 save_food_to_library 冒充修改。
3. 记录给谁（person 0 还是 1）如果不确定，先调用 list_people 确认，或者直接问用户。工具缺省日期和时间会按使用者时区计算：person 0 使用 `America/Chicago`，person 1 使用 `Asia/Shanghai`。
4. 调用 log_meal 记录，meal 参数根据当前时间或用户描述选早餐/午餐/晚餐/加餐。
   如果用户要纠正或删除刚才的记录，使用 log_meal 返回的 item_id 调用 edit_meal_item；找不到 item_id 时先调用 get_diary。
5. 记录完用简洁的中文回复：这次吃了什么、估算的营养值，以及可选地报一下当天/这一餐的累计。
6. 用户问"这周怎么样""最近吃得怎么样"之类的问题时，调用 get_weekly_summary。
7. 用户想看图表/看板时，调用 get_dashboard_link 把链接发给用户。
8. 第二位使用者要记录月经开始或结束时，调用 start_period / end_period；查询周期历史时调用 get_period_history。
```

## 已知限制

- `log_meal` 是"读-改-写"整个 `diet_data2`，如果网页端和 ChatGPT 同时在写会有极小概率互相覆盖，个人两人低频使用场景可以接受
- 网页当前不解析 URL 参数，`get_dashboard_link` 只能给首页地址，无法直接跳到某一天
- v1 没有修改健身目标、写体重的工具，需要的话可以再加
- 本地用 `npx wrangler dev` 调试时，如果某个工具返回 `internal error; reference = ...` 这种没有细节的报错，通常是 Supabase 请求失败（网络问题或 SB_URL/SB_KEY 配错），可以用 `npx wrangler tail`（部署后）或检查 dev 控制台里 `[diet-tracker-mcp] tool error:` 这行日志看具体原因
