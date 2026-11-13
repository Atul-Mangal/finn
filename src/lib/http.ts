// Small fetch helpers: browser-like headers, timeouts, and polite retries.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  { retries = 2, timeoutMs = 25000, passStatus = false }: { retries?: number; timeoutMs?: number; passStatus?: boolean } = {},
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        ...init,
        headers: { "User-Agent": UA, Accept: "*/*", ...(init.headers || {}) },
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!passStatus && (res.status === 429 || res.status >= 500)) {
        lastErr = new Error(`HTTP ${res.status} for ${url}`);
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      return res;
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
      await sleep(800 * 2 ** attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetchWithRetry(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return (await res.json()) as T;
}

export async function fetchText(url: string, init: RequestInit = {}): Promise<{ status: number; text: string }> {
  const res = await fetchWithRetry(url, init);
  return { status: res.status, text: await res.text() };
}

export async function fetchBuffer(url: string, init: RequestInit = {}, timeoutMs = 40000): Promise<ArrayBuffer> {
  const res = await fetchWithRetry(url, init, { retries: 2, timeoutMs });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.arrayBuffer();
}

/** Run async work over items with bounded concurrency (free-tier rate limits). */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
