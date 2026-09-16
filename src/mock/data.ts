import { addDays, format, subDays } from "date-fns";
import type {
  AppNotification,
  DashboardKpis,
  ExpiryBatch,
  ExpiryRisk,
  Forecast,
  Insight,
  InventoryItem,
  Medicine,
  Priority,
  ReorderRecommendation,
  StockStatus,
  StockTransaction,
  Supplier,
  SupplierPerformance,
} from "@/types/domain";

/**
 * Deterministic demonstration dataset.
 * Lives only in src/mock — never imported directly by components.
 */

let seed = 20260911;
function rand(): number {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
function randInt(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}
const iso = (d: Date) => format(d, "yyyy-MM-dd");

export const suppliers: Supplier[] = [
  {
    id: "sup-1",
    name: "ABC Pharmaceuticals",
    contactEmail: "orders@abcpharma.co",
    phone: "+263 242 771 220",
    overallScore: 82,
    onTimeDeliveryPct: 90,
    priceConsistencyPct: 82,
    qualityPct: 91,
    defectRatePct: 1.2,
    avgLeadTimeDays: 7,
    leadTimeVarianceDays: 2.1,
    openOrders: 4,
    lateDeliveries: 3,
    status: "active",
  },
  {
    id: "sup-2",
    name: "MedSource Distributors",
    contactEmail: "supply@medsource.co",
    phone: "+263 242 448 019",
    overallScore: 91,
    onTimeDeliveryPct: 96,
    priceConsistencyPct: 88,
    qualityPct: 94,
    defectRatePct: 0.6,
    avgLeadTimeDays: 5,
    leadTimeVarianceDays: 1.1,
    openOrders: 6,
    lateDeliveries: 1,
    status: "active",
  },
  {
    id: "sup-3",
    name: "Zim Health Supplies",
    contactEmail: "info@zimhealth.co",
    phone: "+263 242 300 771",
    overallScore: 68,
    onTimeDeliveryPct: 71,
    priceConsistencyPct: 64,
    qualityPct: 79,
    defectRatePct: 3.4,
    avgLeadTimeDays: 11,
    leadTimeVarianceDays: 4.6,
    openOrders: 2,
    lateDeliveries: 7,
    status: "review",
  },
  {
    id: "sup-4",
    name: "Global Generics Ltd",
    contactEmail: "sales@globalgenerics.com",
    phone: "+27 11 553 8800",
    overallScore: 77,
    onTimeDeliveryPct: 84,
    priceConsistencyPct: 75,
    qualityPct: 86,
    defectRatePct: 2.0,
    avgLeadTimeDays: 9,
    leadTimeVarianceDays: 3.2,
    openOrders: 3,
    lateDeliveries: 4,
    status: "active",
  },
  {
    id: "sup-5",
    name: "Harare Medical Wholesale",
    contactEmail: "desk@hmw.co.zw",
    phone: "+263 242 705 118",
    overallScore: 85,
    onTimeDeliveryPct: 89,
    priceConsistencyPct: 91,
    qualityPct: 88,
    defectRatePct: 1.0,
    avgLeadTimeDays: 6,
    leadTimeVarianceDays: 1.6,
    openOrders: 5,
    lateDeliveries: 2,
    status: "active",
  },
];

interface Seed {
  name: string;
  strength: string;
  category: string;
  form: string;
  cost: number;
  stock: number;
  reorder: number;
  safety: number;
  daily: number;
  supplier: number;
  expiryInDays: number;
}

const seeds: Seed[] = [
  { name: "Amoxicillin", strength: "500mg", category: "Antibiotics", form: "Capsule", cost: 0.85, stock: 120, reorder: 250, safety: 100, daily: 16, supplier: 0, expiryInDays: 32 },
  { name: "Paracetamol", strength: "500mg", category: "Analgesics", form: "Tablet", cost: 0.12, stock: 480, reorder: 600, safety: 250, daily: 42, supplier: 1, expiryInDays: 210 },
  { name: "Metformin", strength: "850mg", category: "Antidiabetics", form: "Tablet", cost: 0.32, stock: 260, reorder: 300, safety: 120, daily: 18, supplier: 2, expiryInDays: 96 },
  { name: "Ibuprofen", strength: "400mg", category: "Analgesics", form: "Tablet", cost: 0.18, stock: 940, reorder: 400, safety: 180, daily: 21, supplier: 1, expiryInDays: 44 },
  { name: "Atenolol", strength: "50mg", category: "Cardiovascular", form: "Tablet", cost: 0.28, stock: 0, reorder: 200, safety: 90, daily: 12, supplier: 3, expiryInDays: 150 },
  { name: "Artemether/Lumefantrine", strength: "20/120mg", category: "Antimalarials", form: "Tablet", cost: 1.4, stock: 310, reorder: 280, safety: 140, daily: 24, supplier: 4, expiryInDays: 61 },
  { name: "Salbutamol Inhaler", strength: "100mcg", category: "Respiratory", form: "Inhaler", cost: 3.1, stock: 58, reorder: 80, safety: 40, daily: 4, supplier: 1, expiryInDays: 120 },
  { name: "Omeprazole", strength: "20mg", category: "Gastrointestinal", form: "Capsule", cost: 0.42, stock: 640, reorder: 300, safety: 130, daily: 19, supplier: 0, expiryInDays: 27 },
  { name: "Tenofovir/Lamivudine/Dolutegravir", strength: "300/300/50mg", category: "Antiretrovirals", form: "Tablet", cost: 2.2, stock: 1450, reorder: 900, safety: 400, daily: 62, supplier: 4, expiryInDays: 300 },
  { name: "Ceftriaxone", strength: "1g", category: "Antibiotics", form: "Injection", cost: 2.9, stock: 74, reorder: 120, safety: 60, daily: 9, supplier: 2, expiryInDays: 88 },
  { name: "Losartan", strength: "50mg", category: "Cardiovascular", form: "Tablet", cost: 0.36, stock: 390, reorder: 260, safety: 110, daily: 15, supplier: 3, expiryInDays: 175 },
  { name: "Insulin Glargine", strength: "100IU/ml", category: "Antidiabetics", form: "Vial", cost: 12.5, stock: 36, reorder: 60, safety: 30, daily: 3, supplier: 1, expiryInDays: 54 },
  { name: "Azithromycin", strength: "250mg", category: "Antibiotics", form: "Tablet", cost: 0.95, stock: 212, reorder: 180, safety: 80, daily: 11, supplier: 0, expiryInDays: 38 },
  { name: "Prednisolone", strength: "5mg", category: "Respiratory", form: "Tablet", cost: 0.15, stock: 820, reorder: 350, safety: 150, daily: 17, supplier: 4, expiryInDays: 240 },
  { name: "Metronidazole", strength: "400mg", category: "Gastrointestinal", form: "Tablet", cost: 0.14, stock: 145, reorder: 300, safety: 120, daily: 22, supplier: 2, expiryInDays: 70 },
  { name: "Amlodipine", strength: "5mg", category: "Cardiovascular", form: "Tablet", cost: 0.22, stock: 505, reorder: 280, safety: 120, daily: 20, supplier: 1, expiryInDays: 190 },
  { name: "Doxycycline", strength: "100mg", category: "Antibiotics", form: "Capsule", cost: 0.31, stock: 96, reorder: 200, safety: 90, daily: 14, supplier: 3, expiryInDays: 25 },
  { name: "Diclofenac", strength: "50mg", category: "Analgesics", form: "Tablet", cost: 0.16, stock: 730, reorder: 320, safety: 140, daily: 23, supplier: 0, expiryInDays: 130 },
];

function statusFor(s: Seed): StockStatus {
  if (s.stock === 0) return "out_of_stock";
  if (s.stock <= s.safety) return "critical";
  if (s.stock <= s.reorder) return "low_stock";
  if (s.expiryInDays <= 45) return "expiring";
  return "in_stock";
}

export const medicines: Medicine[] = seeds.map((s, i) => ({
  id: `med-${i + 1}`,
  name: s.name,
  strength: s.strength,
  category: s.category,
  form: s.form,
  unitCost: s.cost,
  supplierId: suppliers[s.supplier]!.id,
  supplierName: suppliers[s.supplier]!.name,
}));

export const inventory: InventoryItem[] = seeds.map((s, i) => ({
  id: `inv-${i + 1}`,
  medicineId: `med-${i + 1}`,
  medicineName: s.name,
  strength: s.strength,
  category: s.category,
  currentStock: s.stock,
  reorderPoint: s.reorder,
  safetyStock: s.safety,
  dailyConsumption: s.daily,
  supplierId: suppliers[s.supplier]!.id,
  supplierName: suppliers[s.supplier]!.name,
  unitCost: s.cost,
  earliestExpiry: iso(addDays(new Date(), s.expiryInDays)),
  status: statusFor(s),
}));

export function transactionsFor(medicineId: string): StockTransaction[] {
  const index = Number(medicineId.split("-")[1] ?? 1);
  const list: StockTransaction[] = [];
  for (let i = 0; i < 12; i++) {
    const type = i % 5 === 0 ? "receipt" : i % 7 === 0 ? "adjustment" : "dispense";
    list.push({
      id: `txn-${medicineId}-${i}`,
      date: iso(subDays(new Date(), i * 3 + 1)),
      type,
      quantity: type === "receipt" ? randInt(100, 500) : -randInt(4, 60),
      batch: `B-${2026}-${String((index + i) % 12 + 1).padStart(2, "0")}`,
      reference: type === "receipt" ? `GRN-${1200 + index + i}` : `DSP-${4400 + index + i}`,
    });
  }
  return list;
}

export function buildForecast(medicineId: string, horizonDays: number): Forecast {
  const item = inventory.find((i) => i.medicineId === medicineId) ?? inventory[0]!;
  const base = item.dailyConsumption;
  const series = [];
  const history = 60;
  for (let i = history; i > 0; i--) {
    const day = subDays(new Date(), i);
    const seasonal = 1 + 0.18 * Math.sin(i / 6);
    const noise = 0.9 + rand() * 0.2;
    series.push({
      date: iso(day),
      actual: Math.max(0, Math.round(base * seasonal * noise)),
      forecast: null,
      lower: null,
      upper: null,
    });
  }
  const growth = 1 + (base % 7) / 60;
  let total = 0;
  for (let i = 0; i <= horizonDays; i++) {
    const day = addDays(new Date(), i);
    const trend = base * Math.pow(growth, i / 30);
    const seasonal = 1 + 0.15 * Math.sin((history + i) / 6);
    const value = Math.max(0, Math.round(trend * seasonal));
    const spread = Math.round(value * (0.08 + i * 0.004));
    if (i > 0) total += value;
    series.push({
      date: iso(day),
      actual: i === 0 ? (series[series.length - 1]?.actual ?? null) : null,
      forecast: value,
      lower: Math.max(0, value - spread),
      upper: value + spread,
    });
  }
  const previousPeriod = base * horizonDays;
  return {
    medicineId: item.medicineId,
    medicineName: `${item.medicineName} ${item.strength}`,
    horizonDays,
    series,
    totalForecastDemand: total,
    changeVsPreviousPeriodPct: Number((((total - previousPeriod) / previousPeriod) * 100).toFixed(1)),
    metrics: {
      algorithm: "XGBoost Regressor",
      version: "v1.4",
      trainedAt: iso(subDays(new Date(), 6)),
      horizonDays,
      mae: Number((base * 0.18 + 2).toFixed(1)),
      rmse: Number((base * 0.26 + 3).toFixed(1)),
      mape: Number((7 + (base % 5)).toFixed(1)),
    },
  };
}

function priorityFor(item: InventoryItem): Priority {
  if (item.currentStock === 0) return "critical";
  if (item.currentStock <= item.safetyStock) return "critical";
  if (item.currentStock <= item.reorderPoint * 0.75) return "high";
  if (item.currentStock <= item.reorderPoint) return "medium";
  return "low";
}

export const recommendations: ReorderRecommendation[] = inventory
  .filter((i) => i.currentStock <= i.reorderPoint)
  .map((item, idx) => {
    const supplier = suppliers.find((s) => s.id === item.supplierId)!;
    const predictedDemand = Math.round(item.dailyConsumption * 30 * 1.08);
    const suggested = Math.max(
      50,
      Math.round((predictedDemand + item.safetyStock - item.currentStock) / 10) * 10,
    );
    const priority = priorityFor(item);
    const daysUntilReorderPoint = Math.max(
      0,
      Math.round((item.currentStock - item.reorderPoint) / Math.max(item.dailyConsumption, 1)),
    );
    return {
      id: `rec-${1040 + idx}`,
      medicineId: item.medicineId,
      medicineName: item.medicineName,
      strength: item.strength,
      currentStock: item.currentStock,
      reorderPoint: item.reorderPoint,
      predictedDemand,
      safetyStock: item.safetyStock,
      suggestedQuantity: suggested,
      supplierId: supplier.id,
      supplierName: supplier.name,
      leadTimeDays: supplier.avgLeadTimeDays,
      unitCost: item.unitCost,
      estimatedCost: Number((suggested * item.unitCost).toFixed(2)),
      priority,
      confidence: Math.min(96, 72 + ((idx * 7) % 24)),
      stockoutRisk: priority,
      daysUntilReorderPoint,
      status: "pending" as const,
      rationale:
        "Projected demand over the supplier lead time exceeds available inventory after safety stock is reserved.",
    };
  });

function riskFor(daysRemaining: number, projectedUnused: number): ExpiryRisk {
  if (projectedUnused > 0 && daysRemaining <= 30) return "critical";
  if (projectedUnused > 0 && daysRemaining <= 60) return "high";
  if (daysRemaining <= 120) return "medium";
  return "low";
}

/**
 * Slow-moving lines hold far more stock than they dispense, so a share of each
 * near-dated batch is realistically at risk of expiring unused.
 */
const SLOW_MOVING_FACTORS = [0.18, 1, 0.35, 1, 0.55, 1, 0.25, 1];

export const expiryBatches: ExpiryBatch[] = inventory
  .filter((i) => i.currentStock > 0)
  .map((item, idx) => {
    const daysRemaining = Math.max(
      3,
      Math.round((new Date(item.earliestExpiry).getTime() - Date.now()) / 86400000),
    );
    const quantity = Math.round(item.currentStock * 0.6);
    // Only part of total demand is served from this batch on slow-moving lines.
    const batchDailyUse = Math.max(
      1,
      Math.round(item.dailyConsumption * SLOW_MOVING_FACTORS[idx % SLOW_MOVING_FACTORS.length]!),
    );
    const projectedUnused = Math.max(0, quantity - batchDailyUse * daysRemaining);
    const risk = riskFor(daysRemaining, projectedUnused);
    return {
      id: `batch-${idx + 1}`,
      medicineId: item.medicineId,
      medicineName: item.medicineName,
      strength: item.strength,
      batchNumber: `${item.medicineName.slice(0, 3).toUpperCase()}-2026-${String(idx + 1).padStart(2, "0")}`,
      quantity,
      expiryDate: item.earliestExpiry,
      daysRemaining,
      dailyConsumption: batchDailyUse,
      projectedUnusedUnits: projectedUnused,
      potentialLossValue: Number((projectedUnused * item.unitCost).toFixed(2)),
      risk,
      recommendation:
        projectedUnused > 0
          ? "Prioritise this batch for dispensing (FEFO) and hold further orders of this medicine."
          : "No intervention required — projected consumption clears this batch before expiry.",
    };
  });

export function supplierPerformance(supplierId: string): SupplierPerformance {
  const supplier = suppliers.find((s) => s.id === supplierId)!;
  const trend = Array.from({ length: 8 }).map((_, i) => {
    const drift = (i - 4) * 1.4;
    return {
      period: format(subDays(new Date(), (7 - i) * 30), "MMM"),
      score: Math.round(Math.min(100, Math.max(40, supplier.overallScore - drift + (i % 3)))),
      onTime: Math.round(Math.min(100, Math.max(40, supplier.onTimeDeliveryPct - drift))),
      leadTime: Number((supplier.avgLeadTimeDays + (i % 3) * 0.4 - 0.4).toFixed(1)),
    };
  });
  const orders = Array.from({ length: 6 }).map((_, i) => {
    const placed = subDays(new Date(), i * 12 + 4);
    const expected = addDays(placed, supplier.avgLeadTimeDays);
    const late = i % 3 === 0 && supplier.lateDeliveries > 2;
    const pending = i === 0;
    return {
      id: `PO-${1030 + i}`,
      placedAt: iso(placed),
      expectedAt: iso(expected),
      receivedAt: pending ? null : iso(addDays(expected, late ? 4 : 0)),
      items: randInt(3, 14),
      value: Number((randInt(400, 5200) + rand()).toFixed(2)),
      status: pending ? ("pending" as const) : late ? ("late" as const) : ("delivered" as const),
    };
  });
  return { supplierId, trend, orders };
}

export const inventoryTrend = Array.from({ length: 12 }).map((_, i) => {
  const month = subDays(new Date(), (11 - i) * 30);
  return {
    period: format(month, "MMM"),
    stockValue: 48000 + i * 900 + Math.round(Math.sin(i / 2) * 4200),
    received: 12000 + Math.round(Math.cos(i / 3) * 3000),
    dispensed: 11000 + Math.round(Math.sin(i / 2.4) * 2600),
  };
});

export const insights: Insight[] = [
  {
    id: "ins-1",
    severity: "critical",
    title: "Amoxicillin 500mg is projected to stock out before the next delivery",
    explanation:
      "Current stock of 120 units is below the reorder point of 250 units, while forecast demand over the 7-day supplier lead time is 118 units.",
    metricLabel: "Projected days of cover",
    metricValue: "6 days",
    recommendedAction: "Approve the reorder recommendation for 500 units from ABC Pharmaceuticals.",
    link: "/recommendations",
  },
  {
    id: "ins-2",
    severity: "warning",
    title: "Forecast demand for Metronidazole 400mg is rising",
    explanation:
      "The 30-day forecast is 18% above the previous period, driven by a sustained upward trend in daily dispensing over the last six weeks.",
    metricLabel: "Forecast change",
    metricValue: "+18%",
    recommendedAction: "Review the reorder point — the current level assumes historic average demand.",
    link: "/forecasting",
  },
  {
    id: "ins-3",
    severity: "warning",
    title: "Zim Health Supplies delivery times have deteriorated",
    explanation:
      "Average lead time increased from 9.6 to 11.0 days across the last five orders, with 7 late deliveries recorded this quarter.",
    metricLabel: "Lead time change",
    metricValue: "+14%",
    recommendedAction: "Consider routing Metformin and Ceftriaxone orders to MedSource Distributors.",
    link: "/suppliers/sup-3",
  },
  {
    id: "ins-4",
    severity: "info",
    title: "Omeprazole 20mg batch is at high expiry risk",
    explanation:
      "384 units expire in 27 days while average consumption is 19 units/day, leaving projected unused stock at expiry.",
    metricLabel: "Projected waste",
    metricValue: "120 units",
    recommendedAction: "Dispense this batch first (FEFO) and suspend further orders for 30 days.",
    link: "/expiry-risk",
  },
];

export const notifications: AppNotification[] = [
  {
    id: "n-1",
    type: "stock",
    severity: "critical",
    title: "Critical stock",
    message: "Amoxicillin 500mg has fallen below its critical stock level.",
    createdAt: new Date(Date.now() - 18 * 60000).toISOString(),
    read: false,
    link: "/inventory",
  },
  {
    id: "n-2",
    type: "expiry",
    severity: "warning",
    title: "Expiry risk",
    message: "384 units of Omeprazole 20mg may expire before expected consumption.",
    createdAt: new Date(Date.now() - 3 * 3600000).toISOString(),
    read: false,
    link: "/expiry-risk",
  },
  {
    id: "n-3",
    type: "supplier",
    severity: "warning",
    title: "Supplier delay",
    message: "Zim Health Supplies has delayed Order PO-1030 by 4 days.",
    createdAt: new Date(Date.now() - 26 * 3600000).toISOString(),
    read: false,
    link: "/suppliers/sup-3",
  },
  {
    id: "n-4",
    type: "reorder",
    severity: "info",
    title: "New reorder recommendations",
    message: "6 reorder recommendations are awaiting review.",
    createdAt: new Date(Date.now() - 30 * 3600000).toISOString(),
    read: true,
    link: "/recommendations",
  },
  {
    id: "n-5",
    type: "forecast",
    severity: "info",
    title: "Forecast anomaly",
    message: "Metronidazole 400mg demand deviates from the forecast by more than 2 standard deviations.",
    createdAt: new Date(Date.now() - 50 * 3600000).toISOString(),
    read: true,
    link: "/forecasting",
  },
];

export function buildKpis(): DashboardKpis {
  const inventoryValue = inventory.reduce((sum, i) => sum + i.currentStock * i.unitCost, 0);
  return {
    totalMedicines: medicines.length,
    inventoryValue: Number(inventoryValue.toFixed(2)),
    lowStockItems: inventory.filter((i) => i.status === "low_stock" || i.status === "critical").length,
    outOfStockItems: inventory.filter((i) => i.status === "out_of_stock").length,
    reorderRecommendations: recommendations.length,
    criticalReorders: recommendations.filter((r) => r.priority === "critical").length,
    medicinesAtExpiryRisk: expiryBatches.filter((b) => b.risk === "critical" || b.risk === "high").length,
    expectedDemandChangePct: 8.4,
    activeSuppliers: suppliers.filter((s) => s.status === "active").length,
    avgSupplierScore: Math.round(suppliers.reduce((s, x) => s + x.overallScore, 0) / suppliers.length),
    lateDeliveries: suppliers.reduce((s, x) => s + x.lateDeliveries, 0),
    pendingOrders: suppliers.reduce((s, x) => s + x.openOrders, 0),
    deltas: {
      totalMedicines: 1.2,
      inventoryValue: 4.6,
      lowStockItems: 12.5,
      outOfStockItems: 100,
      reorderRecommendations: -8.3,
      criticalReorders: 20,
      medicinesAtExpiryRisk: -5.2,
      expectedDemandChangePct: 2.1,
      activeSuppliers: 0,
      avgSupplierScore: 1.8,
      lateDeliveries: -14.2,
      pendingOrders: 6.7,
    },
  };
}
