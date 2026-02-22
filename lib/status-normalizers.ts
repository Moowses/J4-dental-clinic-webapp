export function normalizeAppointmentStatus(status?: string | null) {
  const s = String(status || "").trim().toLowerCase().replace(/-/g, "_");
  if (!s) return "unknown";
  return s;
}

export function isNoShowAppointmentStatus(status?: string | null) {
  return normalizeAppointmentStatus(status) === "no_show";
}

export function normalizeBillingStatus(status?: string | null) {
  const s = String(status || "").trim().toLowerCase().replace(/\s+/g, "_");
  if (s === "partially_paid") return "partial";
  if (s === "fully_paid") return "paid";
  if (!s) return "unknown";
  return s;
}
