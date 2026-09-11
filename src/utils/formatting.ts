import { differenceInCalendarDays, format, parseISO } from "date-fns";

export function formatCurrency(value: number, fractionDigits = 2): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

export function formatCompactCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: value >= 10000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatNumber(value: number, fractionDigits = 0): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

export function formatUnits(value: number): string {
  return `${formatNumber(value)} ${value === 1 ? "unit" : "units"}`;
}

export function formatPercent(value: number, fractionDigits = 1): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(fractionDigits)}%`;
}

export function formatDate(value: string | Date, pattern = "dd MMM yyyy"): string {
  const date = typeof value === "string" ? parseISO(value) : value;
  return format(date, pattern);
}

export function daysFromNow(value: string): number {
  return differenceInCalendarDays(parseISO(value), new Date());
}

export function relativeTime(value: string): string {
  const diffMs = Date.now() - parseISO(value).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Renders backend-absent values as "Not available" rather than inventing data. */
export function orNotAvailable(value: string | number | null | undefined, suffix = ""): string {
  if (value === null || value === undefined || value === "") return "Not available";
  return `${value}${suffix}`;
}
