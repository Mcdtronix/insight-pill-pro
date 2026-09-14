import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/common/PageHeader";
import { Pill } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/useAuth";
import { config } from "@/lib/config";
import { ROLE_LABELS } from "@/utils/constants";
import { permissionsFor } from "@/utils/permissions";

export const Route = createFileRoute("/_app/settings")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Settings — Pharma DSS" },
      {
        name: "description",
        content: "Account details, decision thresholds, alert preferences and backend connection status.",
      },
      { property: "og:title", content: "Settings — Pharma DSS" },
      {
        property: "og:description",
        content: "Account details, decision thresholds, alert preferences and backend connection status.",
      },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { user } = useAuth();
  const [leadTimeBuffer, setLeadTimeBuffer] = useState("3");
  const [serviceLevel, setServiceLevel] = useState("95");
  const [expiryWindow, setExpiryWindow] = useState("90");
  const [alerts, setAlerts] = useState({ stock: true, expiry: true, supplier: false, forecast: true });

  const permissions = user ? permissionsFor(user.role) : [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations"
        title="Settings"
        description="Your account, the thresholds that shape recommendations, and where the system is reading its data from."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
            <CardDescription>Profile details come from the backend user record.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Full name" value={user?.fullName ?? "Not available"} />
            <Field label="Username" value={user?.username ?? "Not available"} />
            <Field label="Email" value={user?.email ?? "Not available"} />
            <div>
              <p className="text-xs tracking-wide text-muted-foreground uppercase">Role</p>
              <p className="mt-1 text-sm font-medium text-foreground">
                {user ? ROLE_LABELS[user.role] : "Not available"}
              </p>
            </div>
            <Separator />
            <div>
              <p className="text-xs tracking-wide text-muted-foreground uppercase">Permissions granted</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {permissions.map((permission) => (
                  <Pill key={permission}>{permission}</Pill>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                These controls shape what the interface shows. Access is always re-checked on the server.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Decision thresholds</CardTitle>
            <CardDescription>
              Tuning these values changes how aggressively reorder and expiry alerts are raised.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="lead-buffer">Lead-time safety buffer (days)</Label>
              <Input
                id="lead-buffer"
                type="number"
                min={0}
                value={leadTimeBuffer}
                onChange={(event) => setLeadTimeBuffer(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="service-level">Target service level (%)</Label>
              <Input
                id="service-level"
                type="number"
                min={50}
                max={100}
                value={serviceLevel}
                onChange={(event) => setServiceLevel(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="expiry-window">Expiry alert window (days)</Label>
              <Input
                id="expiry-window"
                type="number"
                min={7}
                value={expiryWindow}
                onChange={(event) => setExpiryWindow(event.target.value)}
              />
            </div>
            <Button onClick={() => toast.success("Thresholds saved for this session")}>Save thresholds</Button>
            <p className="text-xs text-muted-foreground">
              Thresholds apply to this session until the backend settings endpoint is connected.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Alerts</CardTitle>
            <CardDescription>Choose which situations should raise a notification.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Toggle
              id="alert-stock"
              label="Low and critical stock"
              description="When an item falls to or below its reorder point."
              checked={alerts.stock}
              onChange={(value) => setAlerts((prev) => ({ ...prev, stock: value }))}
            />
            <Toggle
              id="alert-expiry"
              label="Expiry risk"
              description="When a batch is unlikely to be dispensed before it expires."
              checked={alerts.expiry}
              onChange={(value) => setAlerts((prev) => ({ ...prev, expiry: value }))}
            />
            <Toggle
              id="alert-supplier"
              label="Supplier performance"
              description="When a supplier's reliability score drops sharply."
              checked={alerts.supplier}
              onChange={(value) => setAlerts((prev) => ({ ...prev, supplier: value }))}
            />
            <Toggle
              id="alert-forecast"
              label="Demand shifts"
              description="When predicted demand changes materially against the previous period."
              checked={alerts.forecast}
              onChange={(value) => setAlerts((prev) => ({ ...prev, forecast: value }))}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Data source</CardTitle>
            <CardDescription>Where this interface is currently reading data from.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-foreground">Mode</p>
              <Pill tone={config.useMock ? "warning" : "success"}>
                {config.useMock ? "Demonstration data" : "Live backend"}
              </Pill>
            </div>
            <Field label="API base URL" value={config.apiUrl || "Not configured"} />
            <Field label="Request timeout" value={`${config.requestTimeoutMs / 1000} seconds`} />
            <p className="text-xs text-muted-foreground">
              Set the API address in the environment to switch from demonstration data to the live backend. No
              backend addresses are hardcoded in the interface.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-1 text-sm font-medium break-all text-foreground">{value}</p>
    </div>
  );
}

function Toggle({
  id,
  label,
  description,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
      <div>
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
