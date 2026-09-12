import { cn } from "@/lib/utils";
import type { ExpiryRisk, Priority, RecommendationStatus, Severity, StockStatus } from "@/types/domain";
import { PRIORITY_LABELS, STOCK_STATUS_LABELS } from "@/utils/constants";

type Tone = "success" | "warning" | "danger" | "info" | "neutral";

const TONE_CLASS: Record<Tone, string> = {
  success: "bg-success/12 text-success border-success/25",
  warning: "bg-warning/15 text-warning border-warning/30",
  danger: "bg-destructive/12 text-destructive border-destructive/25",
  info: "bg-info/12 text-info border-info/25",
  neutral: "bg-muted text-muted-foreground border-border",
};

export function Pill({
  tone = "neutral",
  children,
  className,
}: {
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const STOCK_TONE: Record<StockStatus, Tone> = {
  in_stock: "success",
  low_stock: "warning",
  critical: "danger",
  out_of_stock: "danger",
  expiring: "info",
};

export function StockStatusBadge({ status }: { status: StockStatus }) {
  return <Pill tone={STOCK_TONE[status]}>{STOCK_STATUS_LABELS[status]}</Pill>;
}

const PRIORITY_TONE: Record<Priority, Tone> = {
  critical: "danger",
  high: "warning",
  medium: "info",
  low: "neutral",
};

export function PriorityBadge({ priority, label }: { priority: Priority; label?: string }) {
  return <Pill tone={PRIORITY_TONE[priority]}>{label ?? PRIORITY_LABELS[priority]}</Pill>;
}

export function RiskBadge({ risk }: { risk: ExpiryRisk }) {
  return <Pill tone={PRIORITY_TONE[risk]}>{PRIORITY_LABELS[risk]} risk</Pill>;
}

const SEVERITY_TONE: Record<Severity, Tone> = {
  critical: "danger",
  warning: "warning",
  info: "info",
  success: "success",
};

export function severityTone(severity: Severity): Tone {
  return SEVERITY_TONE[severity];
}

export function DecisionStatusBadge({ status }: { status: RecommendationStatus }) {
  const map: Record<RecommendationStatus, { tone: Tone; label: string }> = {
    pending: { tone: "info", label: "Awaiting decision" },
    approved: { tone: "success", label: "Approved" },
    rejected: { tone: "neutral", label: "Rejected" },
  };
  const entry = map[status];
  return <Pill tone={entry.tone}>{entry.label}</Pill>;
}
