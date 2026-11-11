"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useFeed, useJson } from "@/lib/client";
import { ago } from "@/lib/format";

interface IndexEntry { symbol: string; name: string; generatedAt: string; sample?: boolean; scorecard?: string }

export default function ResearchHome() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const idx = useJson<IndexEntry[]>("/data/research/index.json");
  const feed = useFeed();
  const go = (s: string) => {
    const sym = s.trim().toUpperCase().replace(/\.(NS|BO)$/, "");
    if (sym) router.push(`/research/${encodeURIComponent(sym)}`);
  };
  const ready = idx.data || [];
  return (
    <main className="pt-2">
      <h1 className="text-[22px] font-extrabold tracking-tight">Research</h1>
      <p className="mt-1 text-[14px] text-graphite">
        Any NSE company, read from its own annual numbers and earnings-call transcripts. FINN checks what management promised against what was delivered.
      </p>
      <form className="mt-5 flex gap-2" onSubmit={(e) => { e.preventDefault(); go(q); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="NSE symbol, e.g. PIDILITIND" autoCapitalize="characters" autoCorrect="off" spellCheck={false}
          className="min-w-0 flex-1 rounded-lg border border-rule bg-paper px-3 py-2.5 text-[16px] uppercase placeholder:normal-case placeholder:text-faint" aria-label="NSE symbol" />
        <button className="rounded-lg bg-ink px-4 text-[15px] font-semibold text-stone">Research</button>
      </form>

      {ready.length > 0 && (
        <section className="mt-7">
          <h2 className="text-[13px] font-semibold">Ready to open</h2>
          <ul className="mt-1">
            {ready.map((e) => (
              <li key={e.symbol} className="border-t border-rule first:border-t-0">
                <Link href={`/research/${e.symbol}`} className="block py-2.5">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate"><span className="font-semibold">{e.symbol}</span> <span className="text-[14px] text-graphite">{e.name}</span></span>
                    <span className="num shrink-0 text-[12px] text-faint">{e.sample ? "sample" : `${ago(e.generatedAt)} ago`}</span>
                  </span>
                  {e.scorecard && <span className="mt-0.5 block text-[13px] leading-snug text-ink/80">{e.scorecard}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {feed.data && !feed.data.sample && (
        <section className="mt-7">
          <h2 className="text-[13px] font-semibold">Your holdings</h2>
          <p className="mt-0.5 text-[13px] text-graphite">Researched live, about a minute the first time.</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {feed.data.portfolio.map((p) => (
              <Link key={p.symbol} href={`/research/${p.symbol}`} className="rounded-md bg-paper px-2.5 py-1 text-[13px]">{p.symbol}</Link>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
