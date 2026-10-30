import { request } from "./client";

/** Model Lab: talks to /api/lab/ on the Django backend (no mock version). */

export type LabModelKey = "demand" | "reorder" | "supplier" | "expiry";

export interface LabModelCard {
  key: LabModelKey;
  name: string;
  algorithm: string;
  version: string;
  trainedOn: string | null;
  task: string;
  trainingRows: number | null;
  testRows: number | null;
  threshold?: number;
  weights?: Record<string, number>;
  testMetrics: Record<string, number>;
  features: string[];
  limitations: string[];
}

export interface Contribution {
  feature: string;
  label: string;
  value: number | string | null;
  contribution: number;
}

export interface LabMedicine {
  id: number;
  modelId: number;
  name: string;
  strength: string;
  category: string;
  stock: number;
}

// ---- Demand -------------------------------------------------------------
export interface DemandInputs {
  medicineId: number;
  date: string;
  season: string;
  isPublicHoliday: boolean;
  lag1: number;
  lag7: number;
  lag14: number;
  lag30: number;
  rollingMean7: number;
  rollingMean30: number;
  rollingStd7: number;
}
export interface DemandContext extends DemandInputs {
  medicineName: string;
  category: string;
  actual: number | null;
}
export interface DemandResult {
  prediction: number;
  unit: string;
  baseline: number;
  actual: number | null;
  error: number | null;
  contributions: Contribution[];
  modelVersion: string;
}
export interface DemandEvaluation {
  testRows: number;
  period: [string, string];
  metrics: { MAE: number; RMSE: number; MAPE: number };
  baseline: { name: string; MAE: number };
  improvementPct: number;
  byCategory: { category: string; mae: number; avgDemand: number; n: number }[];
  series: {
    medicineId: number;
    medicineName: string | null;
    points: { date: string; actual: number; predicted: number; stockout: boolean }[];
  };
}

// ---- Stockout risk ------------------------------------------------------
export interface ReorderInputs {
  medicineId: number;
  currentStock: number;
  avgDailyDemand: number;
  demandStdDev: number;
  leadTimeDays: number;
  leadTimeVariability: number;
  reorderAlreadyPlaced: boolean;
}
export interface ReorderContext extends ReorderInputs {
  medicineName: string;
  category: string;
  asOf: string;
  supplierName: string | null;
}
export interface ReorderResult {
  probability: number;
  threshold: number;
  alert: boolean;
  riskLevel: "low" | "elevated" | "high";
  baseline: number;
  daysOfStockLeft: number;
  leadTimeMargin: number;
  contributions: Contribution[];
  modelVersion: string;
}
export interface ReorderEvaluation {
  testRows: number;
  positives: number;
  threshold: number;
  period: [string, string];
  metrics: { precision: number; recall: number; f1: number; rocAuc: number; prAuc: number };
  baseline: { name: string; prAuc: number; recall: number };
  confusion: { tp: number; fp: number; fn: number; tn: number };
  byCategory: {
    category: string;
    checks: number;
    stockouts: number;
    caught: number;
    recall: number | null;
  }[];
}

// ---- Supplier -----------------------------------------------------------
export interface SupplierInputs {
  onTimeRate: number;
  fulfillmentRate: number;
  priceVariancePct: number;
  defectRate: number;
  orders: number;
}
export interface ScorecardRow {
  name: string;
  score: number;
  tier: string;
  orders: number;
  lowConfidence: boolean;
}
export interface SupplierResult {
  score: number;
  tier: string;
  rank: number;
  of: number;
  lowConfidence: boolean;
  outsideTrainingRange: boolean;
  contributions: Contribution[];
  scorecard: ScorecardRow[];
}
export interface SupplierEvaluation {
  suppliers: (ScorecardRow & {
    onTimeRate: number;
    fulfillmentRate: number;
    priceVariancePct: number;
    defectRate: number;
    exportedScore: number;
    exportedTier: string;
  })[];
  reproduced: boolean;
  validation: Record<string, number>;
  orders: number;
}

// ---- Expiry -------------------------------------------------------------
export interface ExpiryInputs {
  batchStock: number;
  daysToExpiry: number;
  monthlyConsumption: number;
  unitCost: number;
}
export interface ExpiryBatchContext extends ExpiryInputs {
  batchId: number;
  batchNumber: string;
  medicineName: string;
}
export interface ExpiryResult {
  atRisk: boolean;
  riskLevel: "low" | "medium" | "high";
  daysToDeplete: number | null;
  unusedUnits: number;
  unusedShare: number;
  valueAtRisk: number;
  monthlyUseNeeded: number | null;
  explanation: string;
  modelVersion: string;
}
export interface ExpiryEvaluation {
  rows: number;
  positives: number;
  metrics: { accuracy: number; precision: number; recall: number; f1: number };
  confusion: { tp: number; fp: number; fn: number; tn: number };
  note: string;
}

export const labApi = {
  models: () => request<LabModelCard[]>("/lab/models/"),
  medicines: () => request<LabMedicine[]>("/medicines/"),

  demandContext: (medicineId: number, date: string) =>
    request<DemandContext>("/lab/demand/context/", { params: { medicine: medicineId, date } }),
  demandPredict: (inputs: DemandInputs) =>
    request<DemandResult>("/lab/demand/predict/", { method: "POST", body: inputs }),
  demandEvaluate: (medicineId: number) =>
    request<DemandEvaluation>("/lab/demand/evaluate/", { params: { medicine: medicineId } }),

  reorderContext: (medicineId: number) =>
    request<ReorderContext>("/lab/reorder/context/", { params: { medicine: medicineId } }),
  reorderPredict: (inputs: ReorderInputs) =>
    request<ReorderResult>("/lab/reorder/predict/", { method: "POST", body: inputs }),
  reorderEvaluate: (threshold?: number) =>
    request<ReorderEvaluation>("/lab/reorder/evaluate/", { params: { threshold } }),

  supplierPredict: (inputs: SupplierInputs) =>
    request<SupplierResult>("/lab/supplier/predict/", { method: "POST", body: inputs }),
  supplierEvaluate: () => request<SupplierEvaluation>("/lab/supplier/evaluate/"),

  expiryContext: () => request<ExpiryBatchContext[]>("/lab/expiry/context/"),
  expiryPredict: (inputs: ExpiryInputs) =>
    request<ExpiryResult>("/lab/expiry/predict/", { method: "POST", body: inputs }),
  expiryEvaluate: () => request<ExpiryEvaluation>("/lab/expiry/evaluate/"),
};
