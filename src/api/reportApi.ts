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
  category?: string;
  supplierId?: string;
  stockStatus?: string;
  format: "csv" | "pdf";
}

export interface ReportResult {
  generatedAt: string;
  rows: number;
  payload: Record<string, unknown>;
}

export const reportApi = {
  generate: (payload: ReportRequest): Promise<ReportResult> =>
    config.useMock
      ? (mockApi.report(payload as unknown as Record<string, unknown>) as Promise<ReportResult>)
      : request<ReportResult>("/reports/generate/", { method: "POST", body: payload }),
};
