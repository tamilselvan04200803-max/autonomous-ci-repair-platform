"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AegisMark } from "./AegisMark";

const LINKS = [
  { href: "/pipeline", clause: "01", label: "Pipeline" },
  { href: "/proof-bundle", clause: "02", label: "Proof Bundle" },
  { href: "/runs", clause: "03", label: "Runs" },
  { href: "/verify", clause: "04", label: "Verify" },
  { href: "/architecture", clause: "05", label: "Architecture" },
  { href: "/setup", clause: "06", label: "Setup" },
];

export function SiteNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const [prevPathname, setPrevPathname] = useState(pathname);
  if (prevPathname !== pathname) {
    setPrevPathname(pathname);
    setOpen(false);
  }

  return (
    <header
      className={`sticky top-0 z-50 border-b transition-colors duration-300 ${
        scrolled
          ? "border-ink/15 bg-paper/95 backdrop-blur-md"
          : "border-transparent bg-paper"
      }`}
    >
      <div className="mx-auto flex max-w-[1360px] items-center justify-between gap-8 px-6 py-4 lg:px-12">
        <Link href="/" className="flex items-center gap-4" aria-label="Aegis Forge home">
          <AegisMark className="h-11 w-auto text-navy" />
          <span className="leading-none">
            <span className="block font-sans text-[19px] font-semibold tracking-[0.16em] uppercase">
              Aegis Forge
            </span>
            <span className="clause mt-1 hidden text-[13px] text-stone xl:block">
              Evidence-Gated CI Repair
            </span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 xl:flex" aria-label="Primary">
          {LINKS.map((l) => {
            const active = pathname === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`group relative px-4 py-3 font-sans text-[15px] tracking-[0.06em] uppercase transition-colors ${
                  active ? "text-navy" : "text-ink-soft hover:text-navy"
                }`}
              >
                <span className="num mr-2 text-[15px] text-stone">{l.clause}</span>
                {l.label}
                <span
                  className={`absolute bottom-1 left-4 h-[2px] bg-navy transition-all duration-300 ${
                    active ? "w-[calc(100%-2rem)]" : "w-0 group-hover:w-[calc(100%-2rem)]"
                  }`}
                />
              </Link>
            );
          })}
          <Link href="/analyze" className="btn btn-primary ml-4 !py-3 !text-[14px]">
            Analyse a log
          </Link>
        </nav>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex h-12 w-12 flex-col items-center justify-center gap-[6px] border border-ink/25 xl:hidden"
          aria-expanded={open}
          aria-label="Toggle navigation menu"
        >
          <span className={`h-[2px] w-6 bg-ink transition-transform ${open ? "translate-y-[8px] rotate-45" : ""}`} />
          <span className={`h-[2px] w-6 bg-ink transition-opacity ${open ? "opacity-0" : ""}`} />
          <span className={`h-[2px] w-6 bg-ink transition-transform ${open ? "-translate-y-[8px] -rotate-45" : ""}`} />
        </button>
      </div>

      {open && (
        <div className="border-t border-ink/15 bg-paper-2 px-6 pb-8 pt-4 xl:hidden">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="flex items-baseline gap-4 border-b border-ink/10 py-4 font-sans text-[18px] uppercase tracking-[0.08em]"
            >
              <span className="num text-[15px] text-stone">{l.clause}</span>
              {l.label}
            </Link>
          ))}
          <Link href="/analyze" className="btn btn-primary mt-6 w-full justify-center">
            Analyse a log
          </Link>
        </div>
      )}
    </header>
  );
}
