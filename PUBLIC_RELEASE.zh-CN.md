# Diet Tracker 插件公开发布指南

本仓库目前包含一个可以工作的个人版 Diet Tracker MCP 服务，以及可供开发测试的 ChatGPT/Codex 插件包。当前部署还不适合直接开放给所有用户，因为它使用单一密码和一份共享数据。

## 1. 用户是否需要配置 Supabase

取决于发布方式。

### 方案 A：由你托管，用户安装后直接使用

这是适合公开插件目录的方案。你负责运行 Cloudflare Worker、Supabase 和身份认证服务。用户只需要：

1. 在 ChatGPT 或 Codex 中找到并安装 Diet Tracker；
2. 登录或授权；
3. 开始记录饮食。

用户不需要创建 Supabase 项目，也不需要填写数据库密钥。

### 方案 B：用户自行部署

每位用户需要自行创建 Supabase 和 Cloudflare 项目、部署 Worker，并配置 MCP 地址。这适合作为开源模板，但不属于“搜索到后直接使用”的消费级体验。

## 2. 当前架构

```text
ChatGPT / Codex
      │ MCP + OAuth
      ▼
Cloudflare Worker：diet-tracker-mcp
      │ Supabase REST API
      ▼
Supabase：kv_store
      ▲
      │ Supabase JS + Realtime
Diet Tracker 网页
```

当前实现具有以下特点：

- `MCP_PASSWORD` 是所有授权共用的单一密码；
- OAuth 授权完成后固定使用 `owner` 作为用户标识；
- 所有数据存放在同一个 `kv_store`；
- 网页和 MCP 共用相同的 Supabase 数据；
- Supabase anon key 具有较宽的数据读写权限。

这适合个人或家庭使用，但不适合互不认识的公共用户。

## 3. 公开前必须完成的数据隔离

### 3.1 使用真实身份认证

将单一密码页面替换为标准 OAuth 身份提供商，例如 Auth0、Stytch 或其他支持 OAuth 2.1 的服务。授权成功后必须获得稳定、不可伪造的用户 ID。

不要使用邮箱地址作为数据库主键。使用身份提供商返回的不可变 subject/user ID。

### 3.2 调整数据库结构

建议将 `kv_store` 改为：

```sql
CREATE TABLE kv_store (
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
```

每次读取和写入都必须同时限定 `user_id` 和 `key`。不能只通过客户端传入的用户 ID 决定数据归属；用户 ID 必须来自已经验证的 OAuth 身份。

### 3.3 配置 Row Level Security

启用 Supabase RLS，并确保：

- 用户只能查询自己的行；
- 用户只能新增或更新自己的行；
- 普通客户端不能伪造其他用户的 `user_id`；
- 服务端凭据只保存在 Cloudflare Worker secret 中。

不要继续使用对所有匿名请求开放的 `USING (true)` 或 `WITH CHECK (true)` 策略。

### 3.4 修改 MCP 数据访问层

需要将 MCP 的数据接口调整为类似：

```ts
getKv(env, userId, keys)
upsertKv(env, userId, key, value)
```

所有工具都从已认证会话取得 `userId`，不能接受模型或用户直接传入任意数据库用户 ID。

## 4. 用户数据和隐私功能

公开前至少应提供：

- 隐私政策；
- 服务条款；
- 支持邮箱或问题反馈渠道；
- 用户数据导出；
- 删除账号及全部数据；
- OAuth Token 撤销；
- 日志脱敏；
- 请求限流和滥用保护；
- 数据保留及备份说明。

饮食、体重、排便和月经周期都属于敏感的个人健康相关信息，应避免写入普通应用日志。

## 5. 插件包结构

本仓库中的插件位于：

```text
plugins/diet-tracker/
├── .codex-plugin/
│   └── plugin.json
├── .mcp.json
└── skills/
    └── diet-tracker/
        └── SKILL.md
```

仓库 Marketplace 清单位于：

```text
.agents/plugins/marketplace.json
```

`.mcp.json` 当前连接现有个人部署，只适合开发测试。在完成多用户隔离之前，不要把该部署提交为公共插件服务。

## 6. 本地和私有测试

### 验证 MCP 服务端

```bash
cd mcp-server
npm install
npm run typecheck
```

### 验证插件清单

使用 Codex 的 plugin-creator 验证器检查：

```bash
python3 validate_plugin.py plugins/diet-tracker
```

### 推荐测试顺序

1. 调用 `list_people`，确认认证和数据库读取；
2. 调用 `get_diary`，确认现有数据可读；
3. 写入一条名称明显的测试记录；
4. 再次调用 `get_diary`，确认数据能够读回；
5. 使用返回的 `item_id` 删除测试记录；
6. 创建两个测试账号，确认双方绝对无法读取或修改对方数据。

跨用户隔离测试是公开发布前的硬性门槛。

## 7. 部署 Cloudflare Worker

个人版的基本部署流程：

```bash
cd mcp-server
npm install
npx wrangler login
npx wrangler kv namespace create OAUTH_KV
npx wrangler secret put SB_URL
npx wrangler secret put SB_KEY
npx wrangler secret put MCP_PASSWORD
npx wrangler deploy
```

公开版接入身份提供商后，还需要添加相应的 OAuth 客户端 ID、客户端 secret、issuer 和回调配置。

不要把任何密码、Supabase secret、OAuth secret 或 GitHub Token 提交到 GitHub。

## 8. 连接 ChatGPT 或 Codex

远程 MCP 地址格式为：

```text
https://<worker-name>.<account-subdomain>.workers.dev/mcp
```

Codex 开发测试可以使用：

```bash
codex mcp add diet-tracker --url https://<你的地址>/mcp
codex mcp login diet-tracker
codex mcp list
```

ChatGPT 中则通过插件或自定义 Connector 连接同一 `/mcp` 地址，并完成 OAuth 授权。

## 9. 提交公共插件目录

完成多用户版本后：

1. 准备稳定的生产 MCP HTTPS 地址；
2. 补充插件图标、Logo、截图和完整商店描述；
3. 在 `plugin.json` 中填写隐私政策和服务条款 URL；
4. 准备读取、写入、失败处理和拒绝场景的测试用例；
5. 在私有 Marketplace 中安装并测试；
6. 提交 OpenAI 插件审核；
7. 审核通过后，用户才能在通用插件目录中搜索并安装。

把代码上传到 GitHub 并不会自动出现在 ChatGPT 插件搜索结果中。GitHub Marketplace 适合开发、团队分发和测试；公共可搜索目录还需要平台提交及审核。

## 10. 故障排查

Worker 运行日志：

```bash
cd mcp-server
npx wrangler tail
```

常见情况：

- `401/403`：OAuth Token、密码或权限错误；
- `530`：通常表示上游数据库、DNS 或网关不可用，需要查看 Worker 日志中的原始响应；
- `540`：Supabase 项目已暂停；
- MCP 能连接但没有工具：检查 `/mcp` 路径、插件清单和新会话是否已经重新加载；
- 工具成功但网页没有更新：检查 Supabase Realtime publication 和双方是否指向同一数据库。

## 发布完成标准

只有同时满足以下条件，才能称为可公开直接使用：

- 用户无需配置 Supabase；
- 每位用户通过独立账号登录；
- 数据库和日志实现严格用户隔离；
- 支持导出和删除个人数据；
- MCP 读写及异常恢复测试通过；
- 隐私政策和服务条款上线；
- 插件通过 OpenAI 审核并进入公共目录。
