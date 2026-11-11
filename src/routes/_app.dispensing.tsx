import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { manageApi } from "@/api/manageApi";
import { PageHeader } from "@/components/common/PageHeader";
import { Pill } from "@/components/common/StatusBadge";
import { BatchCheckPanel } from "@/components/manage/BatchCheckPanel";
import { BatchesPanel } from "@/components/manage/BatchesPanel";
import { DispensePanel } from "@/components/manage/DispensePanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";
import { formatDate } from "@/utils/formatting";

export const Route = createFileRoute("/_app/dispensing")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Dispensing & Batches — Pharma DSS" },
      {
        name: "description",
        content: "Dispense safely: expired and quarantined batches are blocked, earliest safe expiry goes first.",
      },
    ],
  }),
  component: DispensingPage,
});

function DispensingPage() {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("inventory.edit");
  const day = useQuery({ queryKey: ["system-day"], queryFn: manageApi.systemDay, staleTime: 60_000 });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations"
        title="Dispensing & batches"
        description="Give medicines out safely, check any pack's expiry, and keep batch records up to date. The system blocks expired and quarantined stock on every route."
        actions={
          day.data ? (
            <Pill tone={day.data.demo ? "info" : "neutral"}>
              Today: {formatDate(day.data.today)}
              {day.data.demo ? " (demo date)" : ""}
            </Pill>
          ) : null
        }
      />
      <Tabs defaultValue="dispense">
        <TabsList>
          <TabsTrigger value="dispense">Dispense</TabsTrigger>
          <TabsTrigger value="check">Check a pack</TabsTrigger>
          <TabsTrigger value="batches">Batches & expiry</TabsTrigger>
        </TabsList>
        <TabsContent value="dispense" className="mt-4">
          <DispensePanel canDispense={canEdit} />
        </TabsContent>
        <TabsContent value="check" className="mt-4">
          <BatchCheckPanel />
        </TabsContent>
        <TabsContent value="batches" className="mt-4">
          <BatchesPanel canEdit={canEdit} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
