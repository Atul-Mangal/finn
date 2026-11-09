// JSON-file cache for pipeline runs. Committed by the GitHub Action so each
// filing is downloaded, classified and extracted exactly once.

import fs from "node:fs";
import path from "node:path";
import type { CacheStore } from "../../src/lib/cache";

export function fileCache(file: string): CacheStore & { save(): void; size(): number } {
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    data = {};
  }
  return {
    async get<T>(key: string) {
      return data[key] as T | undefined;
    },
    async set(key, value) {
      data[key] = value;
    },
    save() {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(data));
    },
    size: () => Object.keys(data).length,
  };
}
