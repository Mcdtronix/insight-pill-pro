export type Role = "admin" | "manager" | "pharmacist" | "staff";

export interface User {
  id: string;
  username: string;
  fullName: string;
  email: string;
  role: Role;
}

export interface AuthTokens {
  access: string;
  refresh: string;
}

export type StockStatus = "in_stock" | "low_stock" | "critical" | "out_of_stock" | "expiring";

export interface Medicine {
  id: string;
  name: string;
  strength: string;
  category: string;
  form: string;
  unitCost: number;
  supplierId: string;
  supplierName: string;
}

export interface InventoryItem {
  id: string;
  medicineId: string;
  medicineName: string;
  strength: string;
  category: string;
  currentStock: number;
  reorderPoint: number;
  safetyStock: number;
  dailyConsumption: number;
  supplierId: string;
  supplierName: string;
  unitCost: number;
  earliestExpiry: string;
  status: StockStatus;
}

export interface StockTransaction {
  id: string;
  date: string;
  type: "receipt" | "dispense" | "adjustment" | "disposal";
  quantity: number;
  batch: string;
  reference: string;
}

export interface ForecastPoint {
  date: string;
  actual: number | null;
  forecast: number | null;
  lower: number | null;
  upper: number | null;
}

export interface ModelMetrics {
  algorithm: string | null;
  version: string | null;
  trainedAt: string | null;
  horizonDays: number | null;
  mae: number | null;
  rmse: number | null;
  mape: number | null;
}

export interface Forecast {
  medicineId: string;
  medicineName: string;
  horizonDays: number;
  series: ForecastPoint[];
  totalForecastDemand: number;
  changeVsPreviousPeriodPct: number;
  metrics: ModelMetrics;
}

export type Priority = "critical" | "high" | "medium" | "low";
export type RecommendationStatus = "pending" | "approved" | "rejected";

export interface ReorderRecommendation {
  id: string;
  medicineId: string;
  medicineName: string;
  strength: string;
  currentStock: number;
  reorderPoint: number;
  predictedDemand: number;
  safetyStock: number;
  suggestedQuantity: number;
  supplierId: string;
  supplierName: string;
  leadTimeDays: number;
  unitCost: number;
  estimatedCost: number;
  priority: Priority;
  confidence: number;
  stockoutRisk: Priority;
  daysUntilReorderPoint: number;
  status: RecommendationStatus;
  rationale: string;
  /** Present when the recommendation came from the decision engine. */
  stockoutProbability?: number;
  usableStock?: number | null;
  onOrder?: number;
  expiringUnits?: number;
  chain?: DecisionStep[];
  asOf?: string;
  decidedBy?: string | null;
  purchaseOrderId?: string | null;
}

/** One step of the decision engine's reasoning (supplier, forecast, policy, expiry, risk, decision). */
export interface DecisionStep {
  step: number;
  model: string;
  summary: string;
  details: Record<string, unknown>;
}

export type DecisionAction = "order" | "expedite" | "none";

export interface DecisionResult {
  medicineId: number;
  modelId: number;
  medicineName: string;
  strength: string;
  reorder: boolean;
  action: DecisionAction;
  priority: Priority;
  quantity: number;
  estimatedCost: number;
  supplierName: string;
  leadTimeDays: number;
  currentStock: number;
  usableStock: number;
  onOrder: number;
  reorderPoint: number;
  predictedDemand: number;
  stockoutProbability: number;
  expiringUnits: number;
  rationale: string;
}

export interface DecisionRun {
  asOf: string;
  checked: number;
  reorder: number;
  created: number;
  durationMs: number;
  assumptions: Record<string, number>;
  results: DecisionResult[];
}

export interface Supplier {
  id: string;
  name: string;
  contactEmail: string;
  phone: string;
  overallScore: number;
  onTimeDeliveryPct: number;
  priceConsistencyPct: number;
  qualityPct: number;
  defectRatePct: number;
  avgLeadTimeDays: number;
  leadTimeVarianceDays: number;
  openOrders: number;
  lateDeliveries: number;
  status: "active" | "review" | "suspended";
}

export interface SupplierPerformance {
  supplierId: string;
  trend: { period: string; score: number; onTime: number; leadTime: number }[];
  orders: {
    id: string;
    placedAt: string;
    expectedAt: string;
    receivedAt: string | null;
    items: number;
    value: number;
    status: "delivered" | "late" | "pending";
  }[];
}

export type ExpiryRisk = "critical" | "high" | "medium" | "low";

export interface ExpiryBatch {
  id: string;
  medicineId: string;
  medicineName: string;
  strength: string;
  batchNumber: string;
  quantity: number;
  expiryDate: string;
  daysRemaining: number;
  dailyConsumption: number;
  projectedUnusedUnits: number;
  potentialLossValue: number;
  risk: ExpiryRisk;
  recommendation: string;
}

export type Severity = "critical" | "warning" | "info" | "success";

export interface Insight {
  id: string;
  severity: Severity;
  title: string;
  explanation: string;
  metricLabel: string;
  metricValue: string;
  recommendedAction: string;
  link: string;
}

export interface AppNotification {
  id: string;
  type: "stock" | "reorder" | "expiry" | "supplier" | "forecast" | "system";
  severity: Severity;
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
  link: string;
}

export interface DashboardKpis {
  totalMedicines: number;
  inventoryValue: number;
  lowStockItems: number;
  outOfStockItems: number;
  reorderRecommendations: number;
  criticalReorders: number;
  medicinesAtExpiryRisk: number;
  expectedDemandChangePct: number;
  activeSuppliers: number;
  avgSupplierScore: number;
  lateDeliveries: number;
  pendingOrders: number;
  deltas: Record<string, number>;
}

export interface InventoryHealthSlice {
  status: StockStatus;
  label: string;
  count: number;
}

export interface SearchResults {
  medicines: { id: string; label: string; sub: string }[];
  suppliers: { id: string; label: string; sub: string }[];
  recommendations: { id: string; label: string; sub: string }[];
}
