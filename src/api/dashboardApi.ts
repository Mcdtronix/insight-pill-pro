import { config } from "@/lib/config";
import { mockApi } from "@/mock/mockApi";
import type { AppNotification, DashboardKpis, Insight, SearchResults } from "@/types/domain";
import { request } from "./client";

export const dashboardApi = {
  kpis: (): Promise<DashboardKpis> =>
    config.useMock ? mockApi.kpis() : request<DashboardKpis>("/dashboard/kpis/"),

  insights: (): Promise<Insight[]> =>
    config.useMock ? mockApi.insights() : request<Insight[]>("/dashboard/insights/"),
};

export const notificationApi = {
  list: (): Promise<AppNotification[]> =>
    config.useMock ? mockApi.notifications() : request<AppNotification[]>("/notifications/"),

  markRead: (id: string) =>
    config.useMock
      ? mockApi.markNotificationRead(id)
      : request<{ ok: boolean }>(`/notifications/${id}/read/`, { method: "POST" }),

  markAllRead: () =>
    config.useMock
      ? mockApi.markAllNotificationsRead()
      : request<{ ok: boolean }>("/notifications/read-all/", { method: "POST" }),
};

export const searchApi = {
  query: (term: string): Promise<SearchResults> =>
    config.useMock ? mockApi.search(term) : request<SearchResults>("/search/", { params: { q: term } }),
};
