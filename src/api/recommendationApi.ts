import { config } from "@/lib/config";
import { mockApi } from "@/mock/mockApi";
import type { ReorderRecommendation } from "@/types/domain";
import { request } from "./client";

export const recommendationApi = {
  list: (): Promise<ReorderRecommendation[]> =>
    config.useMock ? mockApi.recommendations() : request<ReorderRecommendation[]>("/recommendations/reorder/"),

  detail: (id: string): Promise<ReorderRecommendation> =>
    config.useMock
      ? mockApi.recommendation(id)
      : request<ReorderRecommendation>(`/recommendations/reorder/${id}/`),

  approve: (id: string, quantity?: number): Promise<ReorderRecommendation> =>
    config.useMock
      ? mockApi.approveRecommendation(id, quantity)
      : request<ReorderRecommendation>(`/recommendations/reorder/${id}/approve/`, {
          method: "POST",
          body: { quantity },
        }),

  reject: (id: string): Promise<ReorderRecommendation> =>
    config.useMock
      ? mockApi.rejectRecommendation(id)
      : request<ReorderRecommendation>(`/recommendations/reorder/${id}/reject/`, { method: "POST" }),
};
