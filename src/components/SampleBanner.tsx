export function SampleBanner({ what = "data" }: { what?: string }) {
  return (
    <div role="status" className="mb-4 rounded-lg border border-dashed border-graphite/50 px-3 py-2 text-[13px] text-graphite">
      Showing sample {what} with fictional companies. Live filings and prices appear after the first scheduled pipeline run.
    </div>
  );
}
