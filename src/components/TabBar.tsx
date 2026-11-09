"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Brief", icon: (
    <path d="M5 6h14M5 11h14M5 16h9" strokeLinecap="round" />
  ) },
  { href: "/tripwires", label: "Tripwires", icon: (
    <path d="M3 15l4-5 4 3 5-7 5 6" strokeLinecap="round" strokeLinejoin="round" />
  ) },
  { href: "/research", label: "Research", icon: (
    <><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" strokeLinecap="round" /></>
  ) },
];

export function TabBar() {
  const path = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-rule bg-stone/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex max-w-[520px]">
        {TABS.map((t) => {
          const active = t.href === "/" ? path === "/" : path.startsWith(t.href);
          return (
            <Link key={t.href} href={t.href} aria-current={active ? "page" : undefined}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[12px] ${active ? "text-ink font-semibold" : "text-faint"}`}>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.7} aria-hidden>
                {t.icon}
              </svg>
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
