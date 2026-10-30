import { Pill } from "@/components/common/StatusBadge";
import { cn } from "@/lib/utils";
import type { DecisionStep } from "@/types/domain";
import { formatCurrency, formatNumber } from "@/utils/formatting";

type Details = Record<string, unknown>;
const num = (v: unknown, digits = 0) => (typeof v === "number" ? formatNumber(v, digits) : "—");
const pct = (v: unknown) => (typeof v === "number" ? `${(v * 100).toFixed(1)}%` : "—");

const FEATURE_NAMES: Record<string, string> = {
  current_stock_level: "Current stock",
  days_of_stock_remaining: "Days of stock left",
  lead_time_margin: "Stock days minus lead time",
  demand_cv: "Demand volatility",
  demand_std_dev: "Demand variability",
  avg_daily_demand: "Average daily demand",
  lead_time_days: "Supplier lead time",
  lead_time_cv: "Lead time volatility",
  lead_time_variability: "Lead time variability",
  reorder_already_placed: "Order already placed",
  medicine_id: "Medicine identity",
};

/** Shows how the four models and the inventory policy produced one decision. */
export function ChainView({ chain }: { chain: DecisionStep[] }) {
  return (
    <ol className="space-y-3">
      {chain.map((step) => (
        <li key={step.step} className="grid grid-cols-[1.75rem_1fr] gap-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
            {step.step}
          </span>
          <div className="space-y-1.5 rounded-md border bg-card p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {step.model}
              </p>
              <p className="text-sm font-medium">{step.summary}</p>
            </div>
            <StepDetails step={step.step} d={step.details} />
          </div>
        </li>
      ))}
    </ol>
  );
}

function Facts({ items }: { items: [string, string][] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="font-mono">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function StepDetails({ step, d }: { step: number; d: Details }) {
  if (step === 1) {
    const options = (d["options"] as Details[] | undefined) ?? [];
    return (
      <div className="space-y-1 text-xs">
        <table className="w-full">
          <thead className="text-muted-foreground">
            <tr>
              <th className="text-left font-normal">Supplier offering this medicine</th>
              <th className="text-left font-normal">Tier</th>
              <th className="text-right font-normal">Score</th>
              <th className="text-right font-normal">Lead time</th>
              <th className="text-right font-normal">Unit cost</th>
            </tr>
          </thead>
          <tbody>
            {options.map((o, i) => (
              <tr key={String(o["supplier"])} className={cn(i === 0 && "font-medium")}>
                <td>
                  {i === 0 ? "✓ " : ""}
                  {String(o["supplier"])}
                  {o["lowConfidence"] ? " *" : ""}
                </td>
                <td>{String(o["tier"] ?? "—")}</td>
                <td className="text-right font-mono">{num(o["score"], 2)}</td>
                <td className="text-right font-mono">{num(o["leadTimeDays"])} d</td>
                <td className="text-right font-mono">
                  {formatCurrency(Number(o["unitCost"] ?? 0), 4)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-muted-foreground">{String(d["rule"] ?? "")}</p>
      </div>
    );
  }
  if (step === 2) {
    const next = (d["next14Days"] as number[] | undefined) ?? [];
    const max = Math.max(...next, 1);
    return (
      <div className="space-y-2">
        <Facts
          items={[
            [
              "Lead time used",
              `${num(d["supplierLeadTime"])} + ${num(d["bufferDays"])} buffer days`,
            ],
            ["Demand over lead time", num(d["forecastLeadTime"])],
            ["Forecast daily average", num(d["forecastDailyAvg"], 1)],
            [
              Number(d["stockoutDaysLast30"] ?? 0) > 0
                ? `Recent daily average (${num(d["stockoutDaysLast30"])} stockout days excluded)`
                : "Last 30 days daily average",
              num(d["recentDailyAvg"], 1),
            ],
          ]}
        />
        <div>
          <p className="mb-1 text-xs text-muted-foreground">Next 14 days (units per day)</p>
          <div className="flex h-10 items-end gap-0.5">
            {next.map((v, i) => (
              <div
                key={i}
                className="flex-1 rounded-t bg-primary/60"
                style={{ height: `${Math.max(4, (v / max) * 100)}%` }}
                title={`Day ${i + 1}: ${v}`}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }
  if (step === 3) {
    return (
      <div className="space-y-1">
        <Facts
          items={[
            ["Safety stock", num(d["safetyStock"])],
            ["Reorder point", num(d["reorderPoint"])],
            ["Order-up-to level", num(d["orderUpTo"])],
            ["Demand std (30 days)", num(d["demandStd30"], 1)],
          ]}
        />
        <p className="text-xs text-muted-foreground">{String(d["formula"] ?? "")}</p>
      </div>
    );
  }
  if (step === 4) {
    const batches = (d["batches"] as Details[] | undefined) ?? [];
    return (
      <div className="space-y-1">
        <Facts
          items={[
            ["On hand", num(d["onHand"])],
            ["Expected to expire", num(d["expiringUnits"])],
            ["Usable stock", num(d["usable"])],
            ["Already on order", num(d["onOrder"])],
          ]}
        />
        {batches.length ? (
          <ul className="text-xs text-muted-foreground">
            {batches.map((b) => (
              <li key={String(b["batch"])}>
                Batch {String(b["batch"])} expires {String(b["expiryDate"])}: about{" "}
                {num(b["expectedUnused"])} of {num(b["units"])} units unused
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }
  if (step === 5) {
    const drivers = (d["drivers"] as Details[] | undefined) ?? [];
    return (
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span>
            Probability <span className="font-mono">{pct(d["probability"])}</span>, alert threshold{" "}
            <span className="font-mono">{pct(d["threshold"])}</span>
          </span>
          {d["alert"] ? <Pill tone="danger">Alert</Pill> : <Pill tone="success">No alert</Pill>}
        </div>
        <p className="text-xs text-muted-foreground">
          Main drivers:{" "}
          {drivers
            .map((x) => {
              const c = Number(x["contribution"]);
              const name =
                FEATURE_NAMES[String(x["feature"])] ??
                String(x["feature"]).replace("cat_", "Category ");
              return `${name} (${c >= 0 ? "+" : "−"}${Math.abs(c * 100).toFixed(1)} pts)`;
            })
            .join(", ")}
        </p>
      </div>
    );
  }
  return (
    <Facts
      items={[
        ["Order-up-to gap", num(d["orderUpToGap"])],
        ["Economic order qty", num(d["eoq"])],
        ["90-day cap", num(d["maxCover"])],
        ["Quantity", num(d["quantity"])],
      ]}
    />
  );
}
