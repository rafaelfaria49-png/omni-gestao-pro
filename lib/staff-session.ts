export const STAFF_SESSION_COOKIE = "assistec_staff_session"
export const STAFF_ROLE_COOKIE = "assistec_staff_role"

export type StaffAppRole = "ADMIN" | "GERENTE" | "VENDEDOR"

export function isStaffAppRole(v: string | undefined | null): v is StaffAppRole {
  return v === "ADMIN" || v === "GERENTE" || v === "VENDEDOR"
}
