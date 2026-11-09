// Pluggable key-value cache.
//
// - Pipeline scripts (GitHub Actions) use a JSON file that gets committed, so a
//   filing is classified/extracted exactly once, ever.
// - Serverless routes use process memory plus Upstash Redis when configured
//   (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN). Without Upstash the
//   app still works; it just recomputes after a cold start.

export interface CacheStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlSec?: number): Promise<void>;
}

const mem = new Map<string, { v: unknown; exp: number }>();

const memoryStore: CacheStore = {
  async get<T>(key: string) {
    const hit = mem.get(key);
    if (!hit) return undefined;
    if (hit.exp && hit.exp < Date.now()) {
      mem.delete(key);
      return undefined;
    }
    return hit.v as T;
  },
  async set(key, value, ttlSec) {
    mem.set(key, { v: value, exp: ttlSec ? Date.now() + ttlSec * 1000 : 0 });
  },
};

function upstashStore(url: string, token: string): CacheStore {
  const h = { Authorization: `Bearer ${token}` };
  return {
    async get<T>(key: string) {
      const local = await memoryStore.get<T>(key);
      if (local !== undefined) return local;
      try {
        const r = await fetch(`${url}/get/${encodeURIComponent(key)}`, { headers: h, cache: "no-store" });
        const j = (await r.json()) as { result: string | null };
        if (j.result == null) return undefined;
        const v = JSON.parse(j.result) as T;
        await memoryStore.set(key, v, 3600);
        return v;
      } catch {
        return undefined;
      }
    },
    async set(key, value, ttlSec = 60 * 60 * 24 * 30) {
      await memoryStore.set(key, value, ttlSec);
      try {
        await fetch(`${url}/set/${encodeURIComponent(key)}?EX=${ttlSec}`, {
          method: "POST",
          headers: h,
          body: JSON.stringify(value),
        });
      } catch {
        /* cache is best-effort */
      }
    },
  };
}

let store: CacheStore =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? upstashStore(process.env.UPSTASH_REDIS_REST_URL, process.env.UPSTASH_REDIS_REST_TOKEN)
    : memoryStore;

export function setCacheStore(s: CacheStore) {
  store = s;
}

export const cache = {
  get: <T>(key: string) => store.get<T>(key),
  set: <T>(key: string, value: T, ttlSec?: number) => store.set<T>(key, value, ttlSec),
};

/** Stable short hash for cache keys (FNV-1a, 64-bit via two 32-bit lanes). */
export function hashKey(s: string): string {
  let h1 = 0x811c9dc5,
    h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x811c9dc5) >>> 0;
  }
  return h1.toString(36) + h2.toString(36);
}
