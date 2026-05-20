// app/actions/billing-report-actions.ts
// NOTE:
// This file is imported by a Client Component (BillingReportPanel.tsx).
// Do NOT add `"use server"` here.
//
// Why?
// - Firestore security rules require request.auth for reads.
// - If this runs as a Server Action, there is no Firebase Auth context,
//   so reads to `billing_records` will fail with:
//   "Missing or insufficient permissions."

import { collection, getDocs, query, Timestamp, where } from "firebase/firestore";

import type { Appointment } from "@/lib/types/appointment";
import type { BillingRecord } from "@/lib/types/billing";
import { db } from "@/lib/firebase/firebase";
import { getAllBillingRecords } from "@/lib/services/billing-service";
import { getUserProfile } from "@/lib/services/user-service";

type ReportRow = {
  id: string;
  appointmentId?: string;
  patientId?: string;
  patientName?: string;
  totalAmount: number;
  remainingBalance: number;
  status: string;
  createdAt?: string;
};

function buildAppointmentDate(dateStr?: string, timeStr?: string): Date | null {
  if (!dateStr) return null;
  const parsed = new Date(`${dateStr}T${timeStr || "00:00"}:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toDate(input: unknown): Date | null {
  try {
    if (!input) return null;
    if (input instanceof Date) return input;
    if (typeof input === "object") {
      const value = input as { toDate?: () => Date; seconds?: number };
      if (typeof value.toDate === "function") return value.toDate();
      if (typeof value.seconds === "number") return new Date(value.seconds * 1000);
    }
    if (typeof input === "string" || typeof input === "number") {
      const parsed = new Date(input);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function normalizeBillingRow(
  id: string,
  raw: Partial<BillingRecord> & {
    totalBill?: unknown;
    total?: unknown;
    remaining?: unknown;
    paymentStatus?: unknown;
    patientName?: unknown;
    createdAt?: unknown;
    updatedAt?: unknown;
  }
): ReportRow {
  const totalAmount = Number(raw?.totalAmount ?? raw?.totalBill ?? raw?.total ?? 0);
  const remainingBalance = Number(raw?.remainingBalance ?? raw?.remaining ?? 0);
  const status = String(raw?.status ?? raw?.paymentStatus ?? "unpaid").toLowerCase();
  const patientId = typeof raw?.patientId === "string" ? raw.patientId : undefined;
  const patientName = typeof raw?.patientName === "string" ? raw.patientName : undefined;
  const createdAtIso =
    toDate(raw?.createdAt)?.toISOString?.() ??
    toDate(raw?.updatedAt)?.toISOString?.() ??
    undefined;

  return {
    id,
    appointmentId: String(raw?.appointmentId ?? id),
    patientId,
    patientName,
    totalAmount: Number.isFinite(totalAmount) ? totalAmount : 0,
    remainingBalance: Number.isFinite(remainingBalance)
      ? remainingBalance
      : Number.isFinite(totalAmount)
      ? totalAmount
      : 0,
    status,
    createdAt: createdAtIso,
  };
}

function summarizeRows(rows: ReportRow[]) {
  let totalBilled = 0;
  let totalOutstanding = 0;
  const byStatus: Record<string, number> = {};

  for (const r of rows) {
    totalBilled += r.totalAmount || 0;
    totalOutstanding += r.remainingBalance || 0;
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  }

  const totalCollected = Math.max(0, totalBilled - totalOutstanding);

  return {
    rows,
    summary: {
      totalRecords: rows.length,
      totalBilled,
      totalCollected,
      totalOutstanding,
      byStatus,
    },
  };
}

function isWithinRange(value: Date | null, fromDate: Date, toDateValue: Date) {
  if (!value) return false;
  const time = value.getTime();
  return time >= fromDate.getTime() && time <= toDateValue.getTime();
}

async function buildBillingRowsForRange(fromDate: Date, toDateValue: Date) {
  const recordsRes = await getAllBillingRecords("all");
  if (!recordsRes.success || !recordsRes.data) {
    throw new Error(recordsRes.error || "Failed to load billing records");
  }

  const recordRows = recordsRes.data
    .map((record) => normalizeBillingRow(String(record.id || record.appointmentId || ""), record))
    .filter((row) => isWithinRange(toDate(row.createdAt), fromDate, toDateValue));

  const existingIds = new Set(recordRows.map((row) => row.id));
  const fromStr = fromDate.toISOString().slice(0, 10);
  const toStr = toDateValue.toISOString().slice(0, 10);
  const appointmentSnap = await getDocs(
    query(
      collection(db, "appointments"),
      where("date", ">=", fromStr),
      where("date", "<=", toStr)
    )
  );

  const virtualRows: ReportRow[] = appointmentSnap.docs
    .map((docSnap) => ({
      ...(docSnap.data() as Omit<Appointment, "id">),
      id: docSnap.id,
    }))
    .filter((appt: Appointment) => {
      const appointmentId = String(appt?.id || "");
      if (!appointmentId || existingIds.has(appointmentId)) return false;
      const totalBill = Number(appt?.treatment?.totalBill);
      if (!Number.isFinite(totalBill)) return false;

      const appointmentDate = buildAppointmentDate(
        typeof appt?.date === "string" ? appt.date : "",
        typeof appt?.time === "string" ? appt.time : "00:00"
      );
      return isWithinRange(appointmentDate, fromDate, toDateValue);
    })
    .map((appt: Appointment) => {
      const totalAmount = Number(appt?.treatment?.totalBill || 0);
      const isPaid = String(appt?.paymentStatus || "").toLowerCase() === "paid";
      const fallbackCreatedAt = buildAppointmentDate(
        typeof appt?.date === "string" ? appt.date : "",
        typeof appt?.time === "string" ? appt.time : "00:00"
      );
      const apptMeta = appt as Appointment & { patientName?: string };
      const createdAt =
        toDate(appt?.createdAt)?.toISOString?.() ??
        fallbackCreatedAt?.toISOString?.();

      return {
        id: String(appt.id),
        appointmentId: String(appt.id),
        patientId: appt.patientId,
        patientName: apptMeta.patientName,
        totalAmount,
        remainingBalance: isPaid ? 0 : totalAmount,
        status: isPaid ? "paid" : "unpaid",
        createdAt,
      } satisfies ReportRow;
    });

  return [...recordRows, ...virtualRows].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

export async function getBillingReport(rangeDays: number) {
  const { auth } = await import("@/lib/firebase/firebase");
  if (!auth.currentUser) throw new Error("Not authenticated");

  // Ensure only staff can view the report (align with your app behavior)
  const profile = await getUserProfile(auth.currentUser.uid);
  if (!profile.success || !profile.data) throw new Error("Unable to load user profile");
  if (profile.data.role === "client") throw new Error("Unauthorized: Staff only");

  const { fromTs, toTs } = computeDateRangeTimestamps(rangeDays);

  const rows = await buildBillingRowsForRange(fromTs.toDate(), toTs.toDate());
  return summarizeRows(rows);
}

export async function getBillingReportByRange(input: { fromISO: string; toISO: string }) {
  const { auth } = await import("@/lib/firebase/firebase");
  if (!auth.currentUser) throw new Error("Not authenticated");

  const profile = await getUserProfile(auth.currentUser.uid);
  if (!profile.success || !profile.data) throw new Error("Unable to load user profile");
  if (profile.data.role === "client") throw new Error("Unauthorized: Staff only");

  const fromDate = new Date(input.fromISO);
  const toDate = new Date(input.toISO);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    throw new Error("Invalid date range");
  }

  const rows = await buildBillingRowsForRange(fromDate, toDate);
  return summarizeRows(rows);
}

/**
 * Backwards-compatible alias.
 * Some older UI versions called `getBillingDetailsAction(String(rangeDays))`.
 */
export async function getBillingDetailsAction(rangeDays: string | number) {
  const n = typeof rangeDays === "number" ? rangeDays : Number.parseInt(String(rangeDays), 10);
  const safeDays = Number.isFinite(n) && n > 0 ? n : 30;
  return getBillingReport(safeDays);
}

function computeDateRangeTimestamps(rangeDays: number) {
  const safe = Number.isFinite(rangeDays) && rangeDays > 0 ? rangeDays : 30;

  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - (safe - 1));

  // Normalize to day boundaries (local time) for a nicer UX.
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  return {
    fromTs: Timestamp.fromDate(start),
    toTs: Timestamp.fromDate(end),
  };
}
