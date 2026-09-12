import { Link } from "@tanstack/react-router";
import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export function KpiCard({
  label,
  value,
  sublabel,
  delta,
  deltaGoodWhen = "up",
  icon: Icon,
  to,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sublabel?: string;
  delta?: number;
  deltaGoodWhen?: "up" | "down";
  icon: LucideIcon;
  to?: string;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  const direction = delta === undefined ? null : delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  const good = direction === "flat" || direction === null ? null : direction === deltaGoodWhen;
  const DeltaIcon = direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : Minus;

  const body = (
    <div
      className={cn(
        "group h-full rounded-xl border bg-card p-5 shadow-sm transition-colors",
        to && "hover:border-primary/40 hover:bg-accent/40",
        tone === "danger" && "border-destructive/30",
        tone === "warning" && "border-warning/30",
        tone === "success" && "border-success/30",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <span
          className={cn(
            "rounded-lg p-2",
            tone === "neutral" && "bg-primary/10 text-primary",
            tone === "success" && "bg-success/12 text-success",
            tone === "warning" && "bg-warning/15 text-warning",
            tone === "danger" && "bg-destructive/12 text-destructive",
          )}
        >
          <Icon className="h-4 w-4" aria-hidden />
        </span>
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-foreground tabular-nums">{value}</p>
      <div className="mt-2 flex items-center gap-2 text-xs">
        {direction ? (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 font-medium",
              good === null && "text-muted-foreground",
              good === true && "text-success",
              good === false && "text-destructive",
            )}
          >
            <DeltaIcon className="h-3.5 w-3.5" aria-hidden />
            {Math.abs(delta ?? 0).toFixed(1)}%
          </span>
        ) : null}
        {sublabel ? <span className="text-muted-foreground">{sublabel}</span> : null}
      </div>
    </div>
  );

  if (!to) return body;
  return (
    <Link to={to} className="block h-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
      {body}
    </Link>
  );
}
