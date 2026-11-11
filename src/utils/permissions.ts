import type { Role } from "@/types/domain";

export type Permission =
  | "inventory.view"
  | "inventory.edit"
  | "forecast.view"
  | "recommendations.view"
  | "recommendations.approve"
  | "suppliers.view"
  | "suppliers.edit"
  | "catalogue.edit"
  | "expiry.view"
  | "reports.view"
  | "settings.manage";

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: [
    "inventory.view",
    "inventory.edit",
    "catalogue.edit",
    "forecast.view",
    "recommendations.view",
    "recommendations.approve",
    "suppliers.view",
    "suppliers.edit",
    "expiry.view",
    "reports.view",
    "settings.manage",
  ],
  manager: [
    "inventory.view",
    "inventory.edit",
    "catalogue.edit",
    "forecast.view",
    "recommendations.view",
    "recommendations.approve",
    "suppliers.view",
    "suppliers.edit",
    "expiry.view",
    "reports.view",
  ],
  // Pharmacists dispense, review supplier performance and approve reorders (dissertation, Section 1.7.1).
  pharmacist: [
    "inventory.view",
    "inventory.edit",
    "forecast.view",
    "recommendations.view",
    "recommendations.approve",
    "suppliers.view",
    "expiry.view",
    "reports.view",
  ],
  staff: ["inventory.view", "expiry.view"],
};

export function can(role: Role | undefined, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role].includes(permission);
}

/**
 * Frontend authorization is a usability layer only.
 * The Django backend remains the source of truth for access control.
 */
export function permissionsFor(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role];
}
