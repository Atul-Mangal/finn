import type { SeriesPoint } from "@/lib/types";

/** Tiny bar chart. Negative values hang below the baseline in the down colour. */
export function Bars({ points, height = 56, highlightLast = true, unit = "" }: { points: SeriesPoint[]; height?: number; highlightLast?: boolean; unit?: string }) {
  const vals = points.map((p) => p.value ?? 0);
  const max = Math.max(...vals.map(Math.abs), 1e-9);
  const hasNeg = vals.some((v) => v < 0);
  const base = hasNeg ? height / 2 : height;
  const w = 100 / Math.max(points.length, 1);
  return (
    <figure>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="h-14 w-full" role="img"
        aria-label={points.map((p) => `${p.label}: ${p.value ?? "n/a"}${unit}`).join(", ")}>
        {points.map((p, i) => {
          const v = p.value ?? 0;
          const h = (Math.abs(v) / max) * (hasNeg ? height / 2 - 1 : height - 1);
          const last = highlightLast && i === points.length - 1;
          return (
            <rect key={i} x={i * w + w * 0.15} width={w * 0.7} y={v >= 0 ? base - h : base} height={Math.max(h, p.value == null ? 0 : 0.6)}
              className={v < 0 ? "fill-down" : last ? "fill-ink" : "fill-ink/30"} />
          );
        })}
        {hasNeg && <line x1="0" x2="100" y1={base} y2={base} className="stroke-rule" strokeWidth="0.5" />}
      </svg>
      <figcaption className="mt-1 flex justify-between text-[11px] text-faint">
        <span>{points[0]?.label}</span>
        <span>{points[points.length - 1]?.label}</span>
      </figcaption>
    </figure>
  );
}

export function Line({ values, className = "stroke-ink" }: { values: number[]; className?: string }) {
  if (values.length < 2) return null;
  const min = Math.min(...values), max = Math.max(...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${30 - ((v - min) / (max - min || 1)) * 28 - 1}`).join(" ");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-8 w-24" aria-hidden>
      <polyline points={pts} fill="none" className={className} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
