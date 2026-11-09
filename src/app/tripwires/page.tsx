"use client";
import Link from "next/link";
import { useMemo } from "react";
import { useFeed, useNow, usePrices, useSettings } from "@/lib/client";
import { DEFAULT_SETTINGS, filingTrips, priceTrips } from "@/lib/alerts";
import { CATEGORY_LABEL, ago, dayLabel, signedPct, toneOf } from "@/lib/format";
import { CATEGORIES, type Category } from "@/lib/types";
import { SampleBanner } from "@/components/SampleBanner";

const CALIBRATION_SESSIONS = 60;

export default function Tripwires() {
  const prices = usePrices();
  const feed = useFeed();
  const [s, set] = useSettings();
  const now = useNow();

  const history = useMemo(() => (prices.data ? priceTrips(prices.data, s, CALIBRATION_SESSIONS) : []), [prices.data, s]);
  const recent = history.filter((t) => {
    const dates = Object.values(prices.data?.series || {})[0]?.d || [];
    return dates.slice(-10).includes(t.date);
  });
  const names = Object.keys(prices.data?.series || {}).length;
  const perWeek = names ? (history.length / CALIBRATION_SESSIONS) * 5 : 0;
  const filings = useMemo(() => (feed.data ? filingTrips(feed.data, s, now - 7 * 864e5) : []), [feed.data, s, now]);

  const toggleCat = (c: Category) => set({ watch: s.watch.includes(c) ? s.watch.filter((x) => x !== c) : [...s.watch, c] });
  const toggleMute = (sym: string) => set({ muted: s.muted.includes(sym) ? s.muted.filter((x) => x !== sym) : [...s.muted, sym] });

  return (
    <main className="pt-2">
      <h1 className="text-[22px] font-extrabold tracking-tight">Tripwires</h1>
      <p className="mt-1 text-[14px] text-graphite">You decide what counts as unusual. FINN checks after every market close.</p>
      {prices.data?.sample && <div className="mt-3"><SampleBanner what="prices" /></div>}

      <section className="mt-6 rounded-xl bg-paper p-4">
        <Slider label="Volume spike" value={s.volMult} min={1.2} max={5} step={0.1} suffix="× average"
          onChange={(v) => set({ volMult: v })} />
        <Slider label="Averaged over" value={s.volLookback} min={5} max={60} step={1} suffix=" trading days"
          onChange={(v) => set({ volLookback: v })} />
        <Slider label="Daily price move" value={s.pricePct} min={1} max={12} step={0.5} suffix="% either way"
          onChange={(v) => set({ pricePct: v })} />
        <p className="mt-4 border-t border-rule pt-3 text-[14px]">
          {prices.data ? (
            <>
              With these settings you&apos;d get <span className="mark num font-semibold">about {perWeek.toFixed(perWeek < 10 ? 1 : 0)} alerts a week</span>{" "}
              <span className="text-graphite">across {names} holdings ({history.length} in the last {CALIBRATION_SESSIONS} sessions).</span>
            </>
          ) : (
            <span className="text-graphite">Loading price history…</span>
          )}
        </p>
        <button className="mt-2 text-[13px] text-link" onClick={() => set({ volMult: DEFAULT_SETTINGS.volMult, volLookback: DEFAULT_SETTINGS.volLookback, pricePct: DEFAULT_SETTINGS.pricePct })}>
          Reset to 2× volume, ±4% price
        </button>
      </section>

      <section className="mt-6">
        <h2 className="text-[13px] font-semibold">Fired in the last 10 sessions</h2>
        {recent.length === 0 ? (
          <p className="mt-2 text-[14px] text-graphite">Nothing crossed your thresholds.</p>
        ) : (
          <ul className="mt-1">
            {recent.map((t) => (
              <li key={t.symbol + t.date} className="flex items-baseline justify-between border-t border-rule py-2 text-[14px] first:border-t-0">
                <Link href={`/research/${t.symbol}`} className="font-semibold">{t.symbol}</Link>
                <span className="num flex-1 px-3 text-graphite">
                  {t.kind === "price" ? "price move" : t.kind === "both" ? `volume ${t.volX.toFixed(1)}× and price` : `volume ${t.volX.toFixed(1)}×`}
                </span>
                <span className={`num w-16 text-right ${toneOf(t.ret)}`}>{signedPct(t.ret)}</span>
                <span className="num w-16 text-right text-faint">{dayLabel(t.date)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-7">
        <h2 className="text-[13px] font-semibold">Filings that trip an alert</h2>
        <p className="mt-0.5 text-[13px] text-graphite">Watched types also rank higher in your brief.</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {CATEGORIES.filter((c) => c !== "unclassified").map((c) => {
            const on = s.watch.includes(c);
            return (
              <button key={c} onClick={() => toggleCat(c)} aria-pressed={on}
                className={`rounded-full px-3 py-1.5 text-[13px] ${on ? "bg-ink text-stone" : "bg-paper text-graphite"}`}>
                {CATEGORY_LABEL[c]}
              </button>
            );
          })}
        </div>
        {filings.length > 0 && (
          <ul className="mt-3">
            {filings.slice(0, 8).map((i) => (
              <li key={i.id} className="flex justify-between gap-3 border-t border-rule py-2 text-[14px]">
                <span className="min-w-0 truncate"><span className="font-semibold">{i.symbol}</span> <span className="text-graphite">{i.headline}</span></span>
                <span className="num shrink-0 text-[12px] text-faint">{ago(i.time)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-7">
        <h2 className="text-[13px] font-semibold">Holdings</h2>
        <p className="mt-0.5 text-[13px] text-graphite">Tap to mute a name everywhere.</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(feed.data?.portfolio || []).map((p) => {
            const muted = s.muted.includes(p.symbol);
            return (
              <button key={p.symbol} onClick={() => toggleMute(p.symbol)} aria-pressed={!muted} title={p.name}
                className={`rounded-md px-2.5 py-1 text-[13px] ${muted ? "bg-transparent text-faint line-through" : "bg-paper"}`}>
                {p.symbol}
              </button>
            );
          })}
        </div>
      </section>
    </main>
  );
}

function Slider({ label, value, min, max, step, suffix, onChange }: {
  label: string; value: number; min: number; max: number; step: number; suffix: string; onChange: (v: number) => void;
}) {
  return (
    <label className="mt-3 block first:mt-0">
      <span className="flex items-baseline justify-between text-[14px]">
        <span>{label}</span>
        <span className="num font-semibold">{value}{suffix}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-1.5 w-full" />
    </label>
  );
}
