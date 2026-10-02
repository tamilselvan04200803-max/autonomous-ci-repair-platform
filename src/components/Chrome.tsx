import type { ReactNode } from "react";
import { DrawnRule } from "./Motion";

export function SectionHead({
  clause,
  title,
  lead,
  dark = false,
  align = "center",
}: {
  clause: string;
  title: ReactNode;
  lead?: ReactNode;
  dark?: boolean;
  align?: "center" | "left";
} & { align?: "center" | "left" }) {
  const centered = align === "center";
  return (
    <div className={centered ? "text-center" : ""}>
      <div
        className={`clause flex items-center gap-4 ${
          centered ? "justify-center" : ""
        } ${dark ? "text-amber" : "text-oxide"}`}
      >
        <span className="inline-block h-[2px] w-10 bg-current opacity-70" />
        Section {clause}
        <span className="inline-block h-[2px] w-10 bg-current opacity-70" />
      </div>

      <h2
        className={`mt-7 text-[clamp(34px,5.2vw,62px)] leading-[1.06] ${
          dark ? "text-paper" : "text-ink"
        } ${centered ? "mx-auto max-w-[20ch]" : "max-w-[22ch]"}`}
      >
        {title}
      </h2>

      <DrawnRule className={`mt-8 w-full ${dark ? "text-paper/30" : "text-ink/25"}`} />

      {lead && (
        <div
          className={`measure mt-8 text-[21px] leading-[1.62] ${
            dark ? "text-paper/85" : "text-ink-soft"
          } ${centered ? "text-center" : ""}`}
        >
          {lead}
        </div>
      )}
    </div>
  );
}

export function PageCover({
  clause,
  eyebrow,
  title,
  standfirst,
  meta,
}: {
  clause: string;
  eyebrow: string;
  title: ReactNode;
  standfirst: ReactNode;
  meta: { label: string; value: string }[];
}) {
  return (
    <section className="relative border-b border-ink/15 bg-paper-2 px-6 pt-20 pb-16 lg:px-12 lg:pt-28 lg:pb-20">
      <div className="mx-auto max-w-[1080px] text-center">
        <div className="clause text-oxide">
          {clause} · {eyebrow}
        </div>
        <h1 className="mx-auto mt-8 max-w-[18ch] text-[clamp(42px,7.4vw,88px)] leading-[1.02]">
          {title}
        </h1>
        <div className="measure mt-9 text-[22px] leading-[1.6] text-ink-soft">{standfirst}</div>

        <div className="mx-auto mt-14 grid max-w-[900px] grid-cols-2 gap-px border border-ink/20 bg-ink/20 md:grid-cols-4">
          {meta.map((m) => (
            <div key={m.label} className="bg-paper-2 px-5 py-6">
              <div className="clause text-stone">{m.label}</div>
              <div className="num mt-3 text-[19px] text-ink">{m.value}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Specimen({
  label,
  children,
  tone = "paper",
}: {
  label: string;
  children: ReactNode;
  tone?: "paper" | "dark";
}) {
  return (
    <div>
      <div className={`clause mb-3 ${tone === "dark" ? "text-amber" : "text-stone"}`}>{label}</div>
      <pre
        className={
          tone === "dark"
            ? "code-slab whitespace-pre-wrap break-words"
            : "paper-slab whitespace-pre-wrap break-words"
        }
      >
        {children}
      </pre>
    </div>
  );
}

export function StatBlock({
  value,
  label,
  note,
}: {
  value: ReactNode;
  label: string;
  note: string;
}) {
  return (
    <div className="border-t-[3px] border-ink pt-6">
      <div className="num text-[clamp(38px,5vw,58px)] leading-[1.05] text-navy">{value}</div>
      <div className="label mt-4 text-ink">{label}</div>
      <p className="mt-3 text-[18px] leading-[1.6] text-ink-soft">{note}</p>
    </div>
  );
}
