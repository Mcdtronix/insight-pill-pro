import type {
  AppNotification,
  DashboardKpis,
  ExpiryBatch,
  Forecast,
  Insight,
  InventoryHealthSlice,
  InventoryItem,
  Medicine,
  ReorderRecommendation,
  SearchResults,
  StockTransaction,
  Supplier,
  SupplierPerformance,
  User,
} from "@/types/domain";
import { STOCK_STATUS_LABELS } from "@/utils/constants";
import * as db from "./data";

const latency = (ms = 380) => new Promise((resolve) => setTimeout(resolve, ms));

// Mutable session state so demo actions (approve/reject, read notifications) persist.
const recommendationState: ReorderRecommendation[] = db.recommendations.map((r) => ({ ...r }));
const notificationState: AppNotification[] = db.notifications.map((n) => ({ ...n }));

const demoUsers: Record<string, { password: string; user: User }> = {
  admin: {
    password: "admin",
    user: {
      id: "u-1",
      username: "admin",
      fullName: "T. Moyo",
      email: "admin@pharmacy.health",
      role: "admin",
    },
  },
  manager: {
    password: "manager",
    user: {
      id: "u-2",
      username: "manager",
      fullName: "R. Chirwa",
      email: "manager@pharmacy.health",
      role: "manager",
    },
  },
  pharmacist: {
    password: "pharmacist",
    user: {
      id: "u-3",
      username: "pharmacist",
      fullName: "L. Ncube",
      email: "pharmacist@pharmacy.health",
      role: "pharmacist",
    },
  },
  staff: {
    password: "staff",
    user: {
      id: "u-4",
      username: "staff",
      fullName: "K. Dube",
      email: "staff@pharmacy.health",
      role: "staff",
    },
  },
};

export const mockApi = {
  async login(username: string, password: string) {
    await latency(600);
    const record = demoUsers[username.trim().toLowerCase()];
    if (!record || record.password !== password) {
      const error = new Error("No active account found with the given credentials.") as Error & {
        status?: number;
      };
      error.status = 401;
      throw error;
    }
    return {
      tokens: { access: `mock.access.${record.user.id}`, refresh: `mock.refresh.${record.user.id}` },
      user: record.user,
    };
  },

  async currentUser(access: string): Promise<User> {
    await latency(120);
    const id = access.split(".").pop();
    const match = Object.values(demoUsers).find((u) => u.user.id === id);
    if (!match) {
      const error = new Error("Session expired") as Error & { status?: number };
      error.status = 401;
      throw error;
    }
    return match.user;
  },

  async medicines(): Promise<Medicine[]> {
    await latency();
    return db.medicines;
  },

  async medicine(id: string): Promise<Medicine> {
    await latency(240);
    const found = db.medicines.find((m) => m.id === id);
    if (!found) {
      const error = new Error("Medicine not found") as Error & { status?: number };
      error.status = 404;
      throw error;
    }
    return found;
  },

  async transactions(medicineId: string): Promise<StockTransaction[]> {
    await latency(260);
    return db.transactionsFor(medicineId);
  },

  async inventory(): Promise<InventoryItem[]> {
    await latency();
    return db.inventory;
  },

  async inventoryItem(medicineId: string): Promise<InventoryItem> {
    await latency(200);
    const found = db.inventory.find((i) => i.medicineId === medicineId);
    if (!found) {
      const error = new Error("Inventory record not found") as Error & { status?: number };
      error.status = 404;
      throw error;
    }
    return found;
  },

  async inventoryHealth(): Promise<InventoryHealthSlice[]> {
    await latency(300);
    const order: InventoryItem["status"][] = [
      "in_stock",
      "low_stock",
      "critical",
      "out_of_stock",
      "expiring",
    ];
    return order.map((status) => ({
      status,
      label: STOCK_STATUS_LABELS[status],
      count: db.inventory.filter((i) => i.status === status).length,
    }));
  },

  async inventoryTrend() {
    await latency(320);
    return db.inventoryTrend;
  },

  async expiryRisk(): Promise<ExpiryBatch[]> {
    await latency();
    return db.expiryBatches;
  },

  async forecast(medicineId: string, horizonDays: number): Promise<Forecast> {
    await latency(520);
    return db.buildForecast(medicineId, horizonDays);
  },

  async recommendations(): Promise<ReorderRecommendation[]> {
    await latency();
    return recommendationState;
  },

  async recommendation(id: string): Promise<ReorderRecommendation> {
    await latency(220);
    const found = recommendationState.find((r) => r.id === id);
    if (!found) {
      const error = new Error("Recommendation not found") as Error & { status?: number };
      error.status = 404;
      throw error;
    }
    return found;
  },

  async approveRecommendation(id: string, quantity?: number) {
    await latency(700);
    const found = recommendationState.find((r) => r.id === id);
    if (!found) throw new Error("Recommendation not found");
    found.status = "approved";
    if (quantity && quantity > 0) {
      found.suggestedQuantity = quantity;
      found.estimatedCost = Number((quantity * found.unitCost).toFixed(2));
    }
    return { ...found };
  },

  async rejectRecommendation(id: string) {
    await latency(500);
    const found = recommendationState.find((r) => r.id === id);
    if (!found) throw new Error("Recommendation not found");
    found.status = "rejected";
    return { ...found };
  },

  async suppliers(): Promise<Supplier[]> {
    await latency();
    return db.suppliers;
  },

  async supplier(id: string): Promise<Supplier> {
    await latency(220);
    const found = db.suppliers.find((s) => s.id === id);
    if (!found) {
      const error = new Error("Supplier not found") as Error & { status?: number };
      error.status = 404;
      throw error;
    }
    return found;
  },

  async supplierPerformance(id: string): Promise<SupplierPerformance> {
    await latency(360);
    return db.supplierPerformance(id);
  },

  async kpis(): Promise<DashboardKpis> {
    await latency(340);
    return db.buildKpis();
  },

  async insights(): Promise<Insight[]> {
    await latency(420);
    return db.insights;
  },

  async notifications(): Promise<AppNotification[]> {
    await latency(200);
    return notificationState;
  },

  async markNotificationRead(id: string) {
    await latency(120);
    const found = notificationState.find((n) => n.id === id);
    if (found) found.read = true;
    return { ok: true };
  },

  async markAllNotificationsRead() {
    await latency(200);
    notificationState.forEach((n) => (n.read = true));
    return { ok: true };
  },

  async search(term: string): Promise<SearchResults> {
    await latency(160);
    const q = term.trim().toLowerCase();
    if (!q) return { medicines: [], suppliers: [], recommendations: [] };
    return {
      medicines: db.medicines
        .filter((m) => `${m.name} ${m.strength} ${m.category}`.toLowerCase().includes(q))
        .slice(0, 5)
        .map((m) => ({ id: m.id, label: `${m.name} ${m.strength}`, sub: m.category })),
      suppliers: db.suppliers
        .filter((s) => s.name.toLowerCase().includes(q))
        .slice(0, 4)
        .map((s) => ({ id: s.id, label: s.name, sub: `Score ${s.overallScore}/100` })),
      recommendations: recommendationState
        .filter((r) => `${r.id} ${r.medicineName}`.toLowerCase().includes(q))
        .slice(0, 4)
        .map((r) => ({
          id: r.id,
          label: `Reorder Recommendation ${r.id}`,
          sub: `${r.medicineName} ${r.strength}`,
        })),
    };
  },

  async report(payload: Record<string, unknown>) {
    await latency(900);
    return {
      generatedAt: new Date().toISOString(),
      rows: db.inventory.length,
      payload,
    };
  },
};
