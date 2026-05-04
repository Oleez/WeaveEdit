import type { ReactNode } from "react";

const statusPillBase =
  "inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]";

export type StatusPillTone = "success" | "warning" | "info";
export type InlineMessageTone = "error" | "warning" | "neutral" | "info" | "success";

export interface DirectionOption<T extends string> {
  value: T;
  label: string;
}

export function StatusPill({ label, tone }: { label: string; tone: StatusPillTone }) {
  const toneClass =
    tone === "success"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
      : tone === "info"
        ? "border-sky-500/30 bg-sky-500/10 text-sky-300"
        : "border-amber-500/30 bg-amber-500/10 text-amber-300";

  return <span className={`${statusPillBase} ${toneClass}`}>{label}</span>;
}

export function InlineMessage({
  message,
  tone,
}: {
  message: string;
  tone: InlineMessageTone;
}) {
  const toneClass =
    tone === "error"
      ? "border-destructive/40 bg-destructive/10 text-destructive"
      : tone === "warning"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
        : tone === "success"
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
          : tone === "info"
            ? "border-sky-500/30 bg-sky-500/10 text-sky-300"
            : "border-border/70 bg-background/50 text-muted-foreground";

  return <div className={`rounded-2xl border px-4 py-3 text-sm ${toneClass}`}>{message}</div>;
}

export function StatusCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-border/70 bg-background/60 p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-sm font-medium leading-6 text-foreground">{value}</p>
    </div>
  );
}

export function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-foreground">{value}</span>
    </div>
  );
}

export function DirectionSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<DirectionOption<T>>;
  onChange: (value: T) => void;
}) {
  return (
    <label className="text-sm">
      <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="mt-2 w-full rounded-2xl border border-border/70 bg-card px-3 py-2 outline-none transition focus:border-primary"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function CardHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{eyebrow}</p>
        <h3 className="mt-2 text-base font-semibold">{title}</h3>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}
