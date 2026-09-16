import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Bell, LogOut, Menu, Search } from "lucide-react";
import { useEffect, useState } from "react";

import { notificationApi, searchApi } from "@/api/dashboardApi";
import { Pill, severityTone } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/hooks/useAuth";
import { ROLE_LABELS } from "@/utils/constants";
import { relativeTime } from "@/utils/formatting";

export function Topbar({ onOpenNav, onToggleNav }: { onOpenNav: () => void; onToggleNav: () => void }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const [openResults, setOpenResults] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(id);
  }, [term]);

  const results = useQuery({
    queryKey: ["search", debounced],
    queryFn: () => searchApi.query(debounced),
    enabled: debounced.length > 1,
  });

  const notifications = useQuery({
    queryKey: ["notifications"],
    queryFn: notificationApi.list,
    refetchInterval: 60000,
  });

  const markAll = useMutation({
    mutationFn: () => notificationApi.markAllRead(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const unread = (notifications.data ?? []).filter((n) => !n.read).length;

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur lg:px-6">
      <button
        type="button"
        onClick={onOpenNav}
        className="rounded-md p-2 text-muted-foreground hover:bg-accent lg:hidden"
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5" />
      </button>
      <button
        type="button"
        onClick={onToggleNav}
        className="hidden rounded-md p-2 text-muted-foreground hover:bg-accent lg:inline-flex"
        aria-label="Toggle sidebar"
        title="Toggle sidebar"
      >
        <Menu className="h-5 w-5" />
      </button>

      <div className="relative w-full max-w-md">
        <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={term}
          onChange={(event) => {
            setTerm(event.target.value);
            setOpenResults(true);
          }}
          onFocus={() => setOpenResults(true)}
          onBlur={() => setTimeout(() => setOpenResults(false), 150)}
          placeholder="Search medicines, suppliers, recommendations…"
          className="pl-9"
          aria-label="Global search"
        />
        {openResults && debounced.length > 1 ? (
          <div className="absolute top-12 left-0 w-full overflow-hidden rounded-lg border bg-popover shadow-lg">
            {results.isPending ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">Searching…</p>
            ) : !results.data ||
              results.data.medicines.length + results.data.suppliers.length + results.data.recommendations.length ===
                0 ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">No matches for “{debounced}”.</p>
            ) : (
              <ScrollArea className="max-h-80">
                <SearchGroup title="Medicines" items={results.data.medicines} to="/inventory" />
                <SearchGroup title="Suppliers" items={results.data.suppliers} to="/suppliers" />
                <SearchGroup title="Recommendations" items={results.data.recommendations} to="/recommendations" />
              </ScrollArea>
            )}
          </div>
        ) : null}
      </div>

      <div className="ml-auto flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
              <Bell className="h-5 w-5" />
              {unread > 0 ? (
                <span className="absolute top-1.5 right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
                  {unread}
                </span>
              ) : null}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-96 p-0">
            <div className="flex items-center justify-between border-b px-4 py-2.5">
              <p className="text-sm font-semibold">Alerts</p>
              <Button variant="ghost" size="sm" onClick={() => markAll.mutate()} disabled={unread === 0}>
                Mark all read
              </Button>
            </div>
            <ScrollArea className="max-h-96">
              {(notifications.data ?? []).length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">No alerts right now.</p>
              ) : (
                (notifications.data ?? []).map((item) => (
                  <Link
                    key={item.id}
                    to={item.link as "/"}
                    className="block border-b px-4 py-3 last:border-b-0 hover:bg-accent/50"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-foreground">{item.title}</p>
                      <Pill tone={severityTone(item.severity)}>{item.severity}</Pill>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{item.message}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground/70">{relativeTime(item.createdAt)}</p>
                  </Link>
                ))
              )}
            </ScrollArea>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="gap-2 pl-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/12 text-xs font-semibold text-primary">
                {user?.fullName?.slice(0, 2).toUpperCase() ?? "··"}
              </span>
              <span className="hidden text-left leading-tight sm:block">
                <span className="block text-sm font-medium">{user?.fullName}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {user ? ROLE_LABELS[user.role] : ""}
                </span>
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="text-xs text-muted-foreground">{user?.email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => navigate({ to: "/settings" })}>Settings</DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                queryClient.clear();
                logout();
                navigate({ to: "/login", replace: true });
              }}
            >
              <LogOut className="h-4 w-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

function SearchGroup({
  title,
  items,
  to,
}: {
  title: string;
  items: { id: string; label: string; sub: string }[];
  to: string;
}) {
  if (!items.length) return null;
  return (
    <div className="border-b last:border-b-0">
      <p className="px-4 pt-3 pb-1 text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
        {title}
      </p>
      {items.map((item) => (
        <Link key={item.id} to={to as "/"} className="block px-4 py-2 hover:bg-accent/50">
          <p className="text-sm font-medium text-foreground">{item.label}</p>
          <p className="text-xs text-muted-foreground">{item.sub}</p>
        </Link>
      ))}
    </div>
  );
}
