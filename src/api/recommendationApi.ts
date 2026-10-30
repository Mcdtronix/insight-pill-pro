import { config } from "@/lib/config";
import { mockApi } from "@/mock/mockApi";
import type { DecisionRun, ReorderRecommendation } from "@/types/domain";
import { request } from "./client";

export const recommendationApi = {
  list: (): Promise<ReorderRecommendation[]> =>
    config.useMock ? mockApi.recommendations() : request<ReorderRecommendation[]>("/recommendations/"),

  detail: (id: string): Promise<ReorderRecommendation> =>
    config.useMock
      ? mockApi.recommendation(id)
      : request<ReorderRecommendation>(`/recommendations/${id}/`),

  approve: (id: string, quantity?: number): Promise<ReorderRecommendation> =>
    config.useMock
      ? mockApi.approveRecommendation(id, quantity)
      : request<ReorderRecommendation>(`/recommendations/${id}/approve/`, {
          method: "POST",
          body: { quantity },
        }),

  reject: (id: string): Promise<ReorderRecommendation> =>
    config.useMock
      ? mockApi.rejectRecommendation(id)
      : request<ReorderRecommendation>(`/recommendations/${id}/reject/`, { method: "POST" }),

  /** Run all four models for every medicine and save fresh recommendations (backend only). */
  runEngine: (medicineIds?: number[]): Promise<DecisionRun> =>
    request<DecisionRun>("/decisions/run/", { method: "POST", body: medicineIds ? { medicineIds } : {} }),

  /** What-if: dispense units first-expiry-first-out (backend only). */
  dispense: (medicineId: number, quantity: number): Promise<{ medicineName: string; stockLeft: number }> =>
    request("/decisions/dispense/", { method: "POST", body: { medicineId, quantity } }),
};
