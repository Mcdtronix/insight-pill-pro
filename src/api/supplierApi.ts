import { config } from "@/lib/config";
import { mockApi } from "@/mock/mockApi";
import type { Supplier, SupplierPerformance } from "@/types/domain";
import { request } from "./client";

export const supplierApi = {
  list: (): Promise<Supplier[]> =>
    config.useMock ? mockApi.suppliers() : request<Supplier[]>("/suppliers/"),

  detail: (id: string): Promise<Supplier> =>
    config.useMock ? mockApi.supplier(id) : request<Supplier>(`/suppliers/${id}/`),

  performance: (id: string): Promise<SupplierPerformance> =>
    config.useMock
      ? mockApi.supplierPerformance(id)
      : request<SupplierPerformance>(`/suppliers/${id}/performance/`),
};
