import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

export type ChainStage = "data" | "analytics" | "forecast" | "decision" | "action";

const STAGES: { key: ChainStage; label: string }[] = [
  { key: "data", label: "Raw data" },
  { key: "analytics", label: "Analytics" },
  { key: "forecast", label: "Forecast" },
  { key: "decision", label: "Decision" },
  { key: "action", label: "Recommended action" },
];

/**
 * Makes the decision-support pipeline explicit on every analytical screen:
 * raw data -> analytics -> forecast -> decision -> recommended action.
 */
export function DecisionChain({ active, className }: { active: ChainStage; className?: string }) {
  const activeIndex = STAGES.findIndex((stage) => stage.key === active);

  return (
    <nav
      aria-label="Decision support pipeline"
      className={cn("flex flex-wrap items-center gap-1.5 text-xs", className)}
    >
      {STAGES.map((stage, index) => (
        <span key={stage.key} className="flex items-center gap-1.5">
          <span
            className={cn(
              "rounded-full border px-2.5 py-1 font-medium tracking-wide uppercase",
              index < activeIndex && "border-transparent bg-muted text-muted-foreground",
              index === activeIndex && "border-primary/30 bg-primary/10 text-primary",
              index > activeIndex && "border-dashed border-border text-muted-foreground/70",
            )}
            aria-current={index === activeIndex ? "step" : undefined}
          >
            {stage.label}
          </span>
          {index < STAGES.length - 1 ? (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" aria-hidden />
          ) : null}
        </span>
      ))}
    </nav>
  );
}
