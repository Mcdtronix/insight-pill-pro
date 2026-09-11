import { config } from "@/lib/config";
import { mockApi } from "@/mock/mockApi";
import type { ExpiryBatch, InventoryHealthSlice, InventoryItem } from "@/types/domain";
import { request } from "./client";

export interface InventoryTrendPoint {
  period: string;
  stockValue: number;
  received: number;
  dispensed: number;
}

export const inventoryApi = {
  list: (): Promise<InventoryItem[]> =>
    config.useMock ? mockApi.inventory() : request<InventoryItem[]>("/inventory/"),

  item: (medicineId: string): Promise<InventoryItem> =>
    config.useMock ? mockApi.inventoryItem(medicineId) : request<InventoryItem>(`/inventory/${medicineId}/`),

  health: (): Promise<InventoryHealthSlice[]> =>
    config.useMock ? mockApi.inventoryHealth() : request<InventoryHealthSlice[]>("/inventory/health/"),

  trend: (): Promise<InventoryTrendPoint[]> =>
    config.useMock ? mockApi.inventoryTrend() : request<InventoryTrendPoint[]>("/inventory/trend/"),

  expiryRisk: (): Promise<ExpiryBatch[]> =>
    config.useMock ? mockApi.expiryRisk() : request<ExpiryBatch[]>("/inventory/expiry-risk/"),
};
