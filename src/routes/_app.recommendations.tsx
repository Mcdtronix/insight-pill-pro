import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { recommendationApi } from "@/api/recommendationApi";
import { DecisionChain } from "@/components/common/DecisionChain";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/common/States";
import { DecisionStatusBadge, PriorityBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import type { Priority, RecommendationStatus, ReorderRecommendation } from "@/types/domain";
import { describeError } from "@/api/client";
import { formatCurrency, formatNumber } from "@/utils/formatting";

export const Route = createFileRoute("/_app/recommendations")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Reorder Decisions — Pharma DSS" },
      {
        name: "description",
        content: "Explainable reorder recommendations with quantities, costs and stockout risk.",
      },
      { property: "og:title", content: "Reorder Decisions — Pharma DSS" },
      {
        property: "og:description",
        content: "Explainable reorder recommendations with quantities, costs and stockout risk.",
      },
    ],
  }),
  component: RecommendationsPage,
});

function RecommendationsPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const canApprove = hasPermission("recommendations.approve");

  const list = useQuery({ queryKey: ["recommendations"], queryFn: recommendationApi.list });
  const [priority, setPriority] = useState<Priority | "all">("all");
  const [status, setStatus] = useState<RecommendationStatus | "all">("all");
  const [active, setActive] = useState<ReorderRecommendation | null>(null);
  const [quantity, setQuantity] = useState("");

  const rows = useMemo(
    () =>
      (list.data ?? []).filter(
        (item) =>
          (priority === "all" || item.priority === priority) && (status === "all" || item.status === status),
      ),
    [list.data, priority, status],
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["recommendations"] });
    queryClient.invalidateQueries({ queryKey: ["kpis"] });
  };

  const approve = useMutation({
    mutationFn: (input: { id: string; quantity?: number }) =>
      recommendationApi.approve(input.id, input.quantity),
    onSuccess: (data) => {
      invalidate();
      setActive(null);
      toast.success(`Order approved for ${data.medicineName}`, {
        description: `${formatNumber(data.suggestedQuantity)} units · ${formatCurrency(data.estimatedCost, 0)}`,
      });
    },
    onError: (error) => {
      const { title, detail } = describeError(error);
      toast.error(title, { description: detail });
    },
  });

  const reject = useMutation({
    mutationFn: (id: string) => recommendationApi.reject(id),
    onSuccess: (data) => {
      invalidate();
      setActive(null);
      toast.success(`Recommendation rejected for ${data.medicineName}`);
    },
    onError: (error) => {
      const { title, detail } = describeError(error);
      toast.error(title, { description: detail });
    },
  });

  const pendingValue = rows
    .filter((item) => item.status === "pending")
    .reduce((sum, item) => sum + item.estimatedCost, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Decision layer"
        title="Reorder Decisions"
        description="Each recommendation states what to order, how much, from whom and why — so the decision can be audited, not just accepted."
        actions={<DecisionChain active="decision" />}
      />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 pt-6">
          <Select value={priority} onValueChange={(value) => setPriority(value as Priority | "all")}>
            <SelectTrigger className="w-48" aria-label="Filter by priority">
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All priorities</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={(value) => setStatus(value as RecommendationStatus | "all")}>
            <SelectTrigger className="w-52" aria-label="Filter by decision status">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All decisions</SelectItem>
              <SelectItem value="pending">Awaiting decision</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
          <p className="ml-auto text-sm text-muted-foreground">
            {formatNumber(rows.length)} recommendations · {formatCurrency(pendingValue, 0)} awaiting approval
          </p>
        </CardContent>
      </Card>

      {list.isPending ? (
        <LoadingBlock rows={5} label="Loading recommendations" />
      ) : list.isError ? (
        <ErrorBlock error={list.error} onRetry={() => list.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyBlock
          title="No recommendations match these filters"
          detail="Stock levels are above their reorder points for the selected criteria."
        />
      ) : (
        <div className="grid gap-4">
          {rows.map((item) => (
            <Card key={item.id}>
              <CardHeader className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    {item.medicineName} {item.strength}
                    <PriorityBadge priority={item.priority} />
                    <DecisionStatusBadge status={item.status} />
                  </CardTitle>
                  <CardDescription>
                    {item.supplierName} · lead time {item.leadTimeDays} days · confidence{" "}
                    {Math.round(item.confidence * 100)}%
                  </CardDescription>
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold text-foreground">
                    {formatNumber(item.suggestedQuantity)} units
                  </p>
                  <p className="text-sm text-muted-foreground">{formatCurrency(item.estimatedCost, 0)}</p>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <Fact label="Current stock" value={formatNumber(item.currentStock)} />
                  <Fact label="Reorder point" value={formatNumber(item.reorderPoint)} />
                  <Fact label="Predicted demand" value={formatNumber(item.predictedDemand)} />
                  <Fact label="Safety stock" value={formatNumber(item.safetyStock)} />
                  <Fact label="Days to reorder point" value={`${item.daysUntilReorderPoint} days`} />
                </div>

                <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
                  <p className="text-xs font-semibold tracking-wide text-primary uppercase">Why this decision</p>
                  <p className="mt-1.5 text-sm text-foreground">{item.rationale}</p>
                </div>

                {item.status === "pending" ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() => {
                        setActive(item);
                        setQuantity(String(item.suggestedQuantity));
                      }}
                      disabled={!canApprove}
                    >
                      Review and approve
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => reject.mutate(item.id)}
                      disabled={!canApprove || reject.isPending}
                    >
                      Reject
                    </Button>
                    {!canApprove ? (
                      <p className="self-center text-xs text-muted-foreground">
                        Your role can view recommendations but not approve orders.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={Boolean(active)} onOpenChange={(open) => !open && setActive(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve reorder</DialogTitle>
            <DialogDescription>
              {active ? `${active.medicineName} ${active.strength} from ${active.supplierName}.` : ""} You can
              adjust the quantity before approving.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="approve-quantity">Order quantity (units)</Label>
            <Input
              id="approve-quantity"
              type="number"
              min={1}
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
            {active ? (
              <p className="text-sm text-muted-foreground">
                Estimated cost {formatCurrency((Number(quantity) || 0) * active.unitCost, 0)} at{" "}
                {formatCurrency(active.unitCost)} per unit.
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActive(null)}>
              Cancel
            </Button>
            <Button
              disabled={approve.isPending || !Number(quantity)}
              onClick={() => active && approve.mutate({ id: active.id, quantity: Number(quantity) })}
            >
              {approve.isPending ? "Approving…" : "Approve order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-surface/60 p-3">
      <p className="text-[11px] tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}
