# Public release plan

The repository currently contains a working personal Diet Tracker MCP deployment. It is not yet safe to offer the hosted endpoint as a public, multi-user service.

## Current architecture

- One Cloudflare Worker hosts the MCP and OAuth endpoints.
- `MCP_PASSWORD` authorizes a single owner.
- One Supabase `kv_store` contains the complete shared dataset.
- The web app and MCP server use the same Supabase project and keys.

## Required before public submission

1. Replace the shared-password authorization page with a real OAuth identity provider.
2. Derive an immutable application user ID from the authenticated identity and include it in every database query.
3. Migrate `kv_store` to rows keyed by both `user_id` and `key`, with a composite primary key.
4. Enforce Row Level Security so one user cannot read or write another user's rows.
5. Stop exposing a broadly writable Supabase anon policy. The Worker should use a server-side credential; the web app should use authenticated, user-scoped access.
6. Add account deletion, data export, privacy policy, terms of service, support contact, monitoring, rate limits, and abuse controls.
7. Add automated tests for authorization, cross-user isolation, duplicate writes, concurrent writes, and recovery from upstream failures.
8. Test the packaged plugin in a private or repository marketplace before submitting it to the universal plugin directory.

## Deployment choices

### Hosted service

The publisher operates Cloudflare and Supabase. End users install the plugin, sign in, and use it immediately. Users do not configure Supabase. This is the required model for a searchable, low-friction public plugin.

### Self-hosted service

Each user deploys their own Worker and Supabase project and configures the three Worker secrets. This is suitable for an open-source template, but it is not a direct-install consumer experience.

The checked-in plugin manifest currently points to the existing personal deployment for development testing only. Do not submit it publicly until the hosted service implements the isolation and policy requirements above.
