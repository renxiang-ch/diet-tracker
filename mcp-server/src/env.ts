export interface Env {
  SB_URL: string;
  SB_KEY: string;
  MCP_PASSWORD: string;
  OAUTH_KV: KVNamespace;
  MCP_OBJECT: DurableObjectNamespace;
  OAUTH_PROVIDER: {
    parseAuthRequest(request: Request): Promise<any>;
    completeAuthorization(options: {
      request: any;
      userId: string;
      metadata: unknown;
      scope: string[];
      props: unknown;
    }): Promise<{ redirectTo: string }>;
  };
}
