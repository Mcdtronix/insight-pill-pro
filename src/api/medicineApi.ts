import { config } from "@/lib/config";
import { mockApi } from "@/mock/mockApi";
import type { Medicine, StockTransaction } from "@/types/domain";
import { request } from "./client";

export const medicineApi = {
  list: (): Promise<Medicine[]> =>
    config.useMock ? mockApi.medicines() : request<Medicine[]>("/medicines/"),

  detail: (id: string): Promise<Medicine> =>
    config.useMock ? mockApi.medicine(id) : request<Medicine>(`/medicines/${id}/`),

  transactions: (id: string): Promise<StockTransaction[]> =>
    config.useMock ? mockApi.transactions(id) : request<StockTransaction[]>(`/medicines/${id}/transactions/`),
};
