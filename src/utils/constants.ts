import type { Priority, Role, StockStatus } from "@/types/domain";

export const STOCK_STATUS_LABELS: Record<StockStatus, string> = {
  in_stock: "In Stock",
  low_stock: "Low Stock",
  critical: "Critical",
  out_of_stock: "Out of Stock",
  expiring: "Expiring Soon",
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrator",
  manager: "Pharmacy Manager",
  pharmacist: "Pharmacist",
  staff: "Staff",
};

export const CATEGORIES = [
  "Antibiotics",
  "Analgesics",
  "Antidiabetics",
  "Cardiovascular",
  "Antimalarials",
  "Respiratory",
  "Gastrointestinal",
  "Antiretrovirals",
] as const;
