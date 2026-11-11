import fs from "node:fs";
import path from "node:path";
import { SLOW, WORKED } from "../../src/lib/llm";

/** Record the models that answered in this run, so the next run and the app start with them. */
export function saveWorkingModels() {
  const file = path.join(process.cwd(), "data", "models.json");
  let cur: Record<string, unknown> = {};
  try {
    cur = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {}
  // models that answered this run are no longer "slow"; ones that hung are
  const prevSlow = ((cur.slow as string[]) || []).filter((m) => !Object.values(WORKED).includes(m));
  const next = { ...cur, ...WORKED, slow: [...new Set([...prevSlow, ...SLOW])] };
  if (JSON.stringify(next) !== JSON.stringify(cur)) fs.writeFileSync(file, JSON.stringify(next, null, 1) + "\n");
}
