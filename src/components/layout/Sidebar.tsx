import { Link } from "@tanstack/react-router";
import {
  Activity,
  BarChart3,
  Boxes,
  CalendarClock,
  FileText,
  LayoutDashboard,
  Settings,
  Truck,
  X,
} from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import type { Permission } from "@/utils/permissions";

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  permission?: Permission;
  group: "Overview" | "Intelligence" | "Operations";
}

const NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, group: "Overview" },
  { to: "/inventory", label: "Inventory", icon: Boxes, permission: "inventory.view", group: "Overview" },
  { to: "/forecasting", label: "Demand Forecasting", icon: BarChart3, permission: "forecast.view", group: "Intelligence" },
  {
    to: "/recommendations",
    label: "Reorder Decisions",
    icon: Activity,
    permission: "recommendations.view",
    group: "Intelligence",
  },
  { to: "/expiry", label: "Expiry Risk", icon: CalendarClock, permission: "expiry.view", group: "Intelligence" },
  { to: "/suppliers", label: "Supplier Intelligence", icon: Truck, permission: "suppliers.view", group: "Operations" },
  { to: "/reports", label: "Reports", icon: FileText, permission: "reports.view", group: "Operations" },
  { to: "/settings", label: "Settings", icon: Settings, group: "Operations" },
];

const GROUPS = ["Overview", "Intelligence", "Operations"] as const;

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { hasPermission } = useAuth();
  const visible = NAV.filter((item) => !item.permission || hasPermission(item.permission));

  return (
    <>
      {open ? (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-foreground/40 lg:hidden"
          onClick={onClose}
        />
      ) : null}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-sidebar text-sidebar-foreground transition-transform lg:static lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b border-sidebar-border px-5 py-4">
          <Link to="/dashboard" className="flex items-center gap-2.5" onClick={onClose}>
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
              <Activity className="h-5 w-5" aria-hidden />
            </span>
            <span className="leading-tight">
              <span className="block text-sm font-semibold">Pharma DSS</span>
              <span className="block text-[11px] text-sidebar-foreground/60">Decision Support</span>
            </span>
          </Link>
          <button
            type="button"
            className="rounded-md p-1 text-sidebar-foreground/70 hover:bg-sidebar-accent lg:hidden"
            onClick={onClose}
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {GROUPS.map((group) => {
            const items = visible.filter((item) => item.group === group);
            if (!items.length) return null;
            return (
              <div key={group} className="mb-5">
                <p className="px-3 pb-2 text-[10px] font-semibold tracking-[0.16em] text-sidebar-foreground/45 uppercase">
                  {group}
                </p>
                <ul className="space-y-1">
                  {items.map((item) => (
                    <li key={item.to}>
                      <Link
                        to={item.to as "/"}
                        onClick={onClose}
                        className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                        activeProps={{
                          className:
                            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium bg-sidebar-primary/15 text-sidebar-primary",
                        }}
                      >
                        <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>

        <div className="border-t border-sidebar-border px-5 py-4 text-[11px] text-sidebar-foreground/55">
          Data → Analytics → Forecast → Decision → Action
        </div>
      </aside>
    </>
  );
}
