import OAuthProvider from "@cloudflare/workers-oauth-provider";
import type { Env } from "./env";
import { DietTrackerMCP } from "./mcp-agent";

export { DietTrackerMCP };

function loginPage(encodedState: string, error?: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>饮食记录 MCP 授权</title>
<style>
  body { font-family: -apple-system, sans-serif; background: #f5f5f5; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
  form { background: #fff; padding: 32px; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,.08); width: 280px; }
  h1 { font-size: 18px; margin: 0 0 20px; }
  input { width: 100%; box-sizing: border-box; padding: 10px; font-size: 15px; border: 1px solid #ccc; border-radius: 6px; margin-bottom: 12px; }
  button { width: 100%; padding: 10px; font-size: 15px; background: #16a34a; color: #fff; border: none; border-radius: 6px; cursor: pointer; }
  .error { color: #dc2626; font-size: 13px; margin-bottom: 12px; }
</style>
</head>
<body>
  <form method="POST">
    <h1>连接饮食记录数据</h1>
    ${error ? `<div class="error">${error}</div>` : ""}
    <input type="hidden" name="state" value="${encodedState}" />
    <input type="password" name="password" placeholder="访问密码" autofocus required />
    <button type="submit">授权</button>
  </form>
</body>
</html>`;
}

const defaultHandler = {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/authorize") {
      if (request.method === "GET") {
        const oauthReqInfo = await env.OAUTH_PROVIDER.parseAuthRequest(request);
        const encodedState = btoa(JSON.stringify(oauthReqInfo));
        return new Response(loginPage(encodedState), { headers: { "content-type": "text/html; charset=utf-8" } });
      }

      if (request.method === "POST") {
        const form = await request.formData();
        const password = form.get("password");
        const encodedState = String(form.get("state") ?? "");
        const oauthReqInfo = JSON.parse(atob(encodedState));

        if (password !== env.MCP_PASSWORD) {
          return new Response(loginPage(encodedState, "密码错误，请重试"), {
            status: 401,
            headers: { "content-type": "text/html; charset=utf-8" },
          });
        }

        const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
          request: oauthReqInfo,
          userId: "owner",
          metadata: { label: "diet-tracker" },
          scope: oauthReqInfo.scope,
          props: {},
        });
        return Response.redirect(redirectTo, 302);
      }
    }

    return new Response("Not found", { status: 404 });
  },
};

export default new OAuthProvider<Env>({
  apiRoute: "/mcp",
  apiHandler: DietTrackerMCP.serve("/mcp"),
  defaultHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});
