"use client";
// Client-side state: static data files and per-device settings.
// Settings live in localStorage (per viewer, per browser) — they're light
// preferences, wrapped so a blocked storage context never breaks the app.

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { DEFAULT_SETTINGS, type Settings } from "./alerts";
import type { Feed, Prices } from "./types";

export function useJson<T>(url: string | null): { data: T | null; error: string | null; loading: boolean } {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({
    data: null,
    error: null,
    loading: !!url,
  });
  useEffect(() => {
    if (!url) return;
    let alive = true;
    fetch(url, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 404 ? "not found" : `HTTP ${r.status}`);
        return (await r.json()) as T;
      })
      .then((d) => alive && setState({ data: d, error: null, loading: false }))
      .catch((e: Error) => alive && setState({ data: null, error: e.message, loading: false }));
    return () => {
      alive = false;
    };
  }, [url]);
  return state;
}

export const useFeed = () => useJson<Feed>("/data/feed.json");
export const usePrices = () => useJson<Prices>("/data/prices.json");

// ---- localStorage-backed stores ----
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? ({ ...fallback, ...JSON.parse(raw) } as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable: settings last for this session only */
  }
  cacheByKey.delete(key);
  emit();
}
const cacheByKey = new Map<string, unknown>();
function snapshot<T>(key: string, fallback: T): T {
  if (!cacheByKey.has(key)) cacheByKey.set(key, read(key, fallback));
  return cacheByKey.get(key) as T;
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const s = useSyncExternalStore(
    subscribe,
    () => snapshot("finn.settings", DEFAULT_SETTINGS),
    () => DEFAULT_SETTINGS,
  );
  const set = useCallback((patch: Partial<Settings>) => write("finn.settings", { ...snapshot("finn.settings", DEFAULT_SETTINGS), ...patch }), []);
  return [s, set];
}

interface Marks {
  done: Record<string, number>; // item id -> when marked handled
  lastVisit: number;
}
const EMPTY_MARKS: Marks = { done: {}, lastVisit: 0 };

export function useMarks(): [Marks, (id: string) => void, () => void] {
  const m = useSyncExternalStore(
    subscribe,
    () => snapshot("finn.marks", EMPTY_MARKS),
    () => EMPTY_MARKS,
  );
  const toggle = useCallback((id: string) => {
    const cur = snapshot("finn.marks", EMPTY_MARKS);
    const done = { ...cur.done };
    if (done[id]) delete done[id];
    else done[id] = Date.now();
    write("finn.marks", { ...cur, done });
  }, []);
  const visit = useCallback(() => {
    const cur = snapshot("finn.marks", EMPTY_MARKS);
    write("finn.marks", { ...cur, lastVisit: Date.now() });
  }, []);
  return [m, toggle, visit];
}

// ---- a clock that ticks once a minute (keeps render pure) ----
let nowVal = typeof window === "undefined" ? 0 : Date.now();
const nowSubs = new Set<() => void>();
if (typeof window !== "undefined") {
  setInterval(() => {
    nowVal = Date.now();
    nowSubs.forEach((f) => f());
  }, 60_000);
}
export function useNow(): number {
  return useSyncExternalStore(
    (l) => {
      nowSubs.add(l);
      return () => nowSubs.delete(l);
    },
    () => nowVal,
    () => 0,
  );
}

/** Last-visit time as it was when this page loaded (before we update it). */
export function initialLastVisit(): number {
  return read<Marks>("finn.marks", EMPTY_MARKS).lastVisit;
}
