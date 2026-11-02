import { config } from "@/lib/config";
import { mockApi } from "@/mock/mockApi";
import { request } from "./client";

export type ReportType =
  | "inventory"
  | "stock_movement"
  | "demand_forecast"
  | "reorder"
  | "supplier_performance"
  | "expiry_risk";

export interface ReportRequest {
  type: ReportType;
  from: string;
  to: string;
  category?: string | undefined;
  supplierId?: string | undefined;
  stockStatus?: string | undefined;
  format: "csv" | "pdf";
}

export interface ReportResult {
  generatedAt: string;
  rows: number;
  /** Real file produced by the backend (CSV or PDF), base64-encoded. */
  filename?: string;
  mimeType?: string;
  contentBase64?: string;
  columns?: string[];
  preview?: Record<string, unknown>[];
  payload?: Record<string, unknown>;
}

/** The backend's notion of "today" (the demo date when demo mode is on). */
export const systemApi = {
  health: () =>
    request<{ status: string; today: string; demo: boolean }>("/health/", { auth: false }),
};

export const reportApi = {
  generate: (payload: ReportRequest): Promise<ReportResult> =>
    config.useMock
      ? (mockApi.report(payload as unknown as Record<string, unknown>) as Promise<ReportResult>)
      : request<ReportResult>("/reports/generate/", { method: "POST", body: payload }),
};
