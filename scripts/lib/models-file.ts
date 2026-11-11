import fs from "node:fs";
import path from "node:path";
import { WORKED } from "../../src/lib/llm";

/** Record the models that answered in this run, so the next run and the app start with them. */
export function saveWorkingModels() {
  const file = path.join(process.cwd(), "data", "models.json");
  let cur: Record<string, string> = {};
  try {
    cur = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {}
  const next = { ...cur, ...WORKED };
  if (JSON.stringify(next) !== JSON.stringify(cur)) fs.writeFileSync(file, JSON.stringify(next, null, 1) + "\n");
}
