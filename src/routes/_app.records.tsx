import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/common/PageHeader";
import { MedicinesPanel } from "@/components/manage/MedicinesPanel";
import { SuppliersPanel } from "@/components/manage/SuppliersPanel";
import { UsersPanel } from "@/components/manage/UsersPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_app/records")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Records — Pharma DSS" },
      { name: "description", content: "Medicines, suppliers, supplier offers and user accounts." },
    ],
  }),
  component: RecordsPage,
});

function RecordsPage() {
  const { user, hasPermission } = useAuth();
  const canManageUsers = hasPermission("settings.manage");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations"
        title="Records"
        description="The master data the system runs on. Every change is recorded in the audit trail with who made it."
      />
      <Tabs defaultValue="medicines">
        <TabsList>
          <TabsTrigger value="medicines">Medicines</TabsTrigger>
          <TabsTrigger value="suppliers">Suppliers & offers</TabsTrigger>
          {canManageUsers ? <TabsTrigger value="users">Users</TabsTrigger> : null}
        </TabsList>
        <TabsContent value="medicines" className="mt-4">
          <MedicinesPanel canEdit={hasPermission("catalogue.edit")} />
        </TabsContent>
        <TabsContent value="suppliers" className="mt-4">
          <SuppliersPanel canEdit={hasPermission("suppliers.edit")} />
        </TabsContent>
        {canManageUsers ? (
          <TabsContent value="users" className="mt-4">
            <UsersPanel currentUserEmail={user?.email} />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}
