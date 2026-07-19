import type { Env } from "./env";

// 对应 index.html 里的 kv_store 表读写（cloudPull/cloudSave, index.html:3298/3307）。
// RLS policy 是完全开放的（USING (true) WITH CHECK (true)），网页用的 anon key 已有全部读写权限，
// 这里复用同一个 SB_URL / SB_KEY，不需要 service role key。

export const SYNC_KEYS = ["diet_data2", "custom_foods", "fitness_goals", "weight_logs", "person_names"] as const;
export type SyncKey = (typeof SYNC_KEYS)[number];

export async function getKv(env: Env, keys: SyncKey[]): Promise<Record<string, unknown>> {
  const url = `${env.SB_URL}/rest/v1/kv_store?key=in.(${keys.join(",")})&select=key,value`;
  const res = await fetch(url, {
    headers: {
      apikey: env.SB_KEY,
      Authorization: `Bearer ${env.SB_KEY}`,
    },
  });
  if (!res.ok) {
    throw new Error(`Supabase 读取失败: ${res.status} ${await res.text()}`);
  }
  const rows = (await res.json()) as Array<{ key: string; value: unknown }>;
  const out: Record<string, unknown> = {};
  for (const row of rows) out[row.key] = row.value;
  return out;
}

export async function upsertKv(env: Env, key: SyncKey, value: unknown): Promise<void> {
  const res = await fetch(`${env.SB_URL}/rest/v1/kv_store`, {
    method: "POST",
    headers: {
      apikey: env.SB_KEY,
      Authorization: `Bearer ${env.SB_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify([{ key, value, updated_at: new Date().toISOString() }]),
  });
  if (!res.ok) {
    throw new Error(`Supabase 写入失败: ${res.status} ${await res.text()}`);
  }
}
