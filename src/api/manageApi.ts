import type {
  BatchLookup,
  BatchStatus,
  CatalogueMedicine,
  DispensePlan,
  ManagedSupplier,
  ManagedUser,
  Role,
  StockBatch,
  SupplierOfferRow,
} from "@/types/domain";
import { request } from "./client";

/**
 * Record management and patient-safe dispensing.
 * All safety rules (expired / quarantined stock is never dispensed) are enforced by the
 * backend; the screens only show the result.
 */

export interface ReceiveBatchInput {
  medicineId: string;
  supplierId?: string | null;
  batchNumber: string;
  receivedAt?: string;
  expiryDate: string;
  quantity: number;
  unitCost: number;
}

export interface MedicineInput {
  name: string;
  strength?: string;
  category: string;
  form?: string;
  active?: boolean;
}

export interface SupplierInput {
  name: string;
  contactEmail?: string;
  phone?: string;
  status?: ManagedSupplier["status"];
}

export interface OfferInput {
  medicineId: string;
  supplierId: string;
  unitCost: number;
  leadTimeDays: number;
  packSize?: number;
  minimumOrder?: number;
  active?: boolean;
}

export interface UserInput {
  email: string;
  firstName: string;
  lastName?: string;
  role: Role;
  active?: boolean;
  password?: string;
}

export const manageApi = {
  /** The system's "today" (31 Dec 2024 in demonstration mode) — every expiry decision uses it. */
  systemDay: () => request<{ today: string; demo: boolean }>("/health/", { auth: false }),

  // ---- dispensing & batches
  previewDispense: (medicineId: string, quantity: number) =>
    request<DispensePlan>("/dispense/preview/", { method: "POST", body: { medicineId, quantity } }),
  dispense: (medicineId: string, quantity: number, reference?: string) =>
    request<DispensePlan>("/dispense/", { method: "POST", body: { medicineId, quantity, reference } }),
  lookupBatch: (number: string) => request<BatchLookup>("/batches/lookup/", { params: { number } }),
  batches: (filters: { medicine?: string; status?: BatchStatus[] } = {}) =>
    request<StockBatch[]>("/batches/", {
      params: { medicine: filters.medicine, status: filters.status?.join(",") },
    }),
  receiveBatch: (input: ReceiveBatchInput) => request<StockBatch>("/batches/", { method: "POST", body: input }),
  updateBatch: (id: string, change: { quarantined?: boolean; expiryDate?: string; reason: string }) =>
    request<StockBatch>(`/batches/${id}/`, { method: "PATCH", body: change }),
  disposeBatch: (id: string, reason: string, quantity?: number) =>
    request<StockBatch>(`/batches/${id}/dispose/`, { method: "POST", body: { reason, quantity } }),

  // ---- catalogue
  medicines: () => request<CatalogueMedicine[]>("/manage/medicines/"),
  createMedicine: (input: MedicineInput) =>
    request<CatalogueMedicine>("/manage/medicines/", { method: "POST", body: input }),
  updateMedicine: (id: string, input: Partial<MedicineInput>) =>
    request<CatalogueMedicine>(`/manage/medicines/${id}/`, { method: "PATCH", body: input }),

  suppliers: () => request<ManagedSupplier[]>("/manage/suppliers/"),
  createSupplier: (input: SupplierInput) =>
    request<ManagedSupplier>("/manage/suppliers/", { method: "POST", body: input }),
  updateSupplier: (id: string, input: Partial<SupplierInput>) =>
    request<ManagedSupplier>(`/manage/suppliers/${id}/`, { method: "PATCH", body: input }),

  offers: (filters: { medicine?: string; supplier?: string } = {}) =>
    request<SupplierOfferRow[]>("/manage/offers/", { params: filters }),
  createOffer: (input: OfferInput) => request<SupplierOfferRow>("/manage/offers/", { method: "POST", body: input }),
  updateOffer: (id: string, input: Partial<OfferInput>) =>
    request<SupplierOfferRow>(`/manage/offers/${id}/`, { method: "PATCH", body: input }),

  // ---- users (admin only)
  users: () => request<ManagedUser[]>("/manage/users/"),
  createUser: (input: UserInput) => request<ManagedUser>("/manage/users/", { method: "POST", body: input }),
  updateUser: (id: string, input: Partial<UserInput>) =>
    request<ManagedUser>(`/manage/users/${id}/`, { method: "PATCH", body: input }),
};
