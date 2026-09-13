import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Activity, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { describeError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { config } from "@/lib/config";

export const Route = createFileRoute("/login")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in — Pharma DSS" },
      { name: "description", content: "Sign in to the pharmacy decision support workspace." },
      { property: "og:title", content: "Sign in — Pharma DSS" },
      { property: "og:description", content: "Sign in to the pharmacy decision support workspace." },
    ],
  }),
  component: LoginPage,
});

const DEMO_ACCOUNTS = [
  { username: "admin", label: "Administrator" },
  { username: "manager", label: "Pharmacy Manager" },
  { username: "pharmacist", label: "Pharmacist" },
  { username: "staff", label: "Staff" },
];

function LoginPage() {
  const { login, status } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("manager");
  const [password, setPassword] = useState("manager");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status === "authenticated") navigate({ to: "/dashboard", replace: true });
  }, [status, navigate]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(username.trim(), password);
      navigate({ to: "/dashboard", replace: true });
    } catch (err) {
      const { title, detail } = describeError(err);
      setError(`${title} ${detail}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="hidden flex-col justify-between bg-sidebar p-12 text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground">
            <Activity className="h-5 w-5" aria-hidden />
          </span>
          <span className="text-lg font-semibold">Pharma DSS</span>
        </div>
        <div className="max-w-md">
          <h2 className="text-3xl leading-tight font-semibold">
            From raw stock data to the right reorder decision.
          </h2>
          <p className="mt-4 text-sm text-sidebar-foreground/70">
            Demand forecasting, stockout prevention, expiry-waste control and supplier performance in a single
            clinical workspace — every recommendation shown with the reasoning behind it.
          </p>
          <ul className="mt-8 space-y-2 text-sm text-sidebar-foreground/70">
            <li>• Forecast-driven reorder quantities with confidence levels</li>
            <li>• First-expiry-first-out batch risk monitoring</li>
            <li>• Supplier reliability and lead-time intelligence</li>
          </ul>
        </div>
        <p className="text-xs text-sidebar-foreground/45">
          Data → Analytics → Forecast → Decision → Recommended action
        </p>
      </section>

      <section className="flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Use your pharmacy workspace credentials to continue.
          </p>

          <form className="mt-8 space-y-4" onSubmit={onSubmit}>
            <div className="space-y-1.5">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                value={username}
                autoComplete="username"
                onChange={(event) => setUsername(event.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>

            {error ? (
              <p role="alert" className="rounded-md border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">
                {error}
              </p>
            ) : null}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Sign in
            </Button>
          </form>

          {config.useMock ? (
            <div className="mt-8 rounded-lg border bg-muted/40 p-4">
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Demonstration accounts
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                No backend configured — data is served locally. Password matches the username.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {DEMO_ACCOUNTS.map((account) => (
                  <Button
                    key={account.username}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setUsername(account.username);
                      setPassword(account.username);
                    }}
                  >
                    {account.label}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
