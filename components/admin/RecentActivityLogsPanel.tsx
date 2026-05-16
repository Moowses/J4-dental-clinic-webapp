"use client";

import { useEffect, useMemo, useState } from "react";
import { db } from "@/lib/firebase/firebase";
import { collection, doc, getDoc, getDocs, orderBy, query } from "firebase/firestore";
import type { Appointment } from "@/lib/types/appointment";
import type { BillingRecord } from "@/lib/types/billing";

const PAGE_SIZE = 10;

type ActivityLogRow = {
  id: string;
  kind: "appointment" | "service" | "payment";
  kindLabel: string;
  patientName: string;
  serviceLabel: string;
  description: string;
  dateLabel: string;
  sortMs: number;
  statusLabel: string;
  statusClass: string;
};

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    const d = (value as { toDate: () => Date }).toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
  }

  if (typeof value === "object" && value !== null && "seconds" in value) {
    const seconds = (value as { seconds?: unknown }).seconds;
    if (typeof seconds === "number") return new Date(seconds * 1000);
  }

  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  return null;
}

function formatLogDate(value: unknown) {
  const d = toDate(value);
  if (!d) return "Unknown date";
  return d.toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatAppointmentSlot(appt: Appointment) {
  const date = String(appt.date || "").trim();
  const time = String(appt.time || "").trim();
  if (date && time) return `${date} at ${time}`;
  return date || time || "Schedule not set";
}

function formatMoney(value: number) {
  return `P${Number(value || 0).toLocaleString()}`;
}

function getStatusClass(kind: ActivityLogRow["kind"]) {
  if (kind === "appointment") return "border-sky-200 bg-sky-50 text-sky-700";
  if (kind === "service") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

export default function RecentActivityLogsPanel() {
  const [activityLogs, setActivityLogs] = useState<ActivityLogRow[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"desc" | "asc">("desc");
  const [page, setPage] = useState(1);

  useEffect(() => {
    let active = true;

    async function loadActivityLogs() {
      setLogsLoading(true);
      setLogsError(null);

      try {
        const appointmentsQuery = query(collection(db, "appointments"), orderBy("date", "desc"));
        const billingQuery = query(collection(db, "billing_records"), orderBy("updatedAt", "desc"));

        const [appointmentsSnap, billingSnap] = await Promise.all([
          getDocs(appointmentsQuery),
          getDocs(billingQuery),
        ]);

        const appointments = appointmentsSnap.docs.map((entry) => ({
          id: entry.id,
          ...entry.data(),
        })) as Appointment[];
        const billingRecords = billingSnap.docs.map((entry) => ({
          id: entry.id,
          ...entry.data(),
        })) as BillingRecord[];

        const patientIds = Array.from(
          new Set(
            [...appointments, ...billingRecords]
              .map((row) => String((row as { patientId?: string }).patientId || "").trim())
              .filter(Boolean)
          )
        );

        const patientPairs = await Promise.all(
          patientIds.map(async (uid) => {
            try {
              return await getDoc(doc(db, "users", uid));
            } catch {
              return null;
            }
          })
        );

        const patientNameMap = new Map<string, string>();
        for (let i = 0; i < patientIds.length; i += 1) {
          const uid = patientIds[i];
          const userSnap = patientPairs[i];
          const data = userSnap?.data() as { displayName?: string; email?: string } | undefined;
          patientNameMap.set(uid, String(data?.displayName || data?.email || uid).trim());
        }

        const appointmentMap = new Map<string, Appointment>();
        appointments.forEach((appt) => appointmentMap.set(String(appt.id || ""), appt));

        const rows: ActivityLogRow[] = [];

        appointments.forEach((appt) => {
          const patientId = String(appt.patientId || "").trim();
          const patientName = patientNameMap.get(patientId) || patientId || "Unknown patient";
          const serviceLabel = String(appt.serviceType || "Appointment").trim() || "Appointment";
          const bookedAt = toDate(appt.updatedAt) || toDate(appt.createdAt);

          rows.push({
            id: `appt-${appt.id}`,
            kind: "appointment",
            kindLabel: "Appointment",
            patientName,
            serviceLabel,
            description: `Appointment booked for ${formatAppointmentSlot(appt)}`,
            dateLabel: formatLogDate(bookedAt),
            sortMs: bookedAt?.getTime() || 0,
            statusLabel: String(appt.status || "pending").replace(/_/g, " "),
            statusClass: getStatusClass("appointment"),
          });

          if (appt.treatment?.completedAt) {
            const procedures = Array.isArray(appt.treatment.procedures)
              ? appt.treatment.procedures.map((p) => String(p?.name || "").trim()).filter(Boolean)
              : [];
            const completedAt = toDate(appt.treatment.completedAt) || bookedAt;

            rows.push({
              id: `svc-${appt.id}`,
              kind: "service",
              kindLabel: "Service Availed",
              patientName,
              serviceLabel: procedures[0] || serviceLabel,
              description: procedures.length
                ? `Services availed: ${procedures.join(", ")}`
                : `Service availed: ${serviceLabel}`,
              dateLabel: formatLogDate(completedAt),
              sortMs: completedAt?.getTime() || 0,
              statusLabel: `Completed • ${formatMoney(Number(appt.treatment.totalBill || 0))}`,
              statusClass: getStatusClass("service"),
            });
          }
        });

        billingRecords.forEach((bill) => {
          const patientId = String(bill.patientId || "").trim();
          const patientName = patientNameMap.get(patientId) || patientId || "Unknown patient";
          const appt = appointmentMap.get(String(bill.appointmentId || ""));
          const fallbackService = String(appt?.serviceType || "Payment").trim() || "Payment";

          (Array.isArray(bill.transactions) ? bill.transactions : []).forEach((tx) => {
            const items = Array.isArray(bill.items)
              ? bill.items.map((item) => String(item?.name || "").trim()).filter(Boolean)
              : [];

            rows.push({
              id: `pay-${bill.id}-${String(tx.id || Math.random())}`,
              kind: "payment",
              kindLabel: "Payment",
              patientName,
              serviceLabel: items[0] || fallbackService,
              description: items.length
                ? `Payment for ${items.join(", ")}`
                : `Payment for ${fallbackService}`,
              dateLabel: formatLogDate(tx.date),
              sortMs: toDate(tx.date)?.getTime() || 0,
              statusLabel: `${String(tx.method || "cash").toUpperCase()} • ${formatMoney(Number(tx.amount || 0))}`,
              statusClass: getStatusClass("payment"),
            });
          });
        });

        if (active) setActivityLogs(rows);
      } catch (error) {
        if (active) {
          setLogsError(error instanceof Error ? error.message : "Failed to load activity logs.");
        }
      } finally {
        if (active) setLogsLoading(false);
      }
    }

    loadActivityLogs();
    return () => {
      active = false;
    };
  }, []);

  const sortedLogs = useMemo(() => {
    const copy = [...activityLogs];
    copy.sort((a, b) => (sortDirection === "desc" ? b.sortMs - a.sortMs : a.sortMs - b.sortMs));
    return copy;
  }, [activityLogs, sortDirection]);

  const totalPages = Math.max(1, Math.ceil(sortedLogs.length / PAGE_SIZE));

  useEffect(() => {
    setPage(1);
  }, [sortDirection]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pagedLogs = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return sortedLogs.slice(start, start + PAGE_SIZE);
  }, [page, sortedLogs]);

  const pageNumbers = useMemo(() => Array.from({ length: totalPages }, (_, i) => i + 1), [totalPages]);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-lg font-extrabold text-slate-900">Recent Activity Logs</h3>
          <p className="mt-2 text-sm text-slate-600">
            Tracks appointment entries, services availed, and payment transactions with patient names.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Sort by month
          </label>
          <select
            value={sortDirection}
            onChange={(e) => setSortDirection(e.target.value === "asc" ? "asc" : "desc")}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
          >
            <option value="desc">Descending</option>
            <option value="asc">Ascending</option>
          </select>
        </div>
      </div>

      <div className="mt-5">
        {logsLoading ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-700">
            Loading activity logs...
          </div>
        ) : logsError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">
            {logsError}
          </div>
        ) : !sortedLogs.length ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-700">
            No logs found yet.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="overflow-x-auto rounded-2xl border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-4 py-3">Booked / Logged At</th>
                    <th className="px-4 py-3">Patient Name</th>
                    <th className="px-4 py-3">Service</th>
                    <th className="px-4 py-3">Details</th>
                    <th className="px-4 py-3">Type</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {pagedLogs.map((row) => (
                    <tr key={row.id} className="align-top">
                      <td className="px-4 py-4 text-slate-700">{row.dateLabel}</td>
                      <td className="px-4 py-4 font-bold text-slate-900">{row.patientName}</td>
                      <td className="px-4 py-4 text-slate-800">{row.serviceLabel}</td>
                      <td className="px-4 py-4 text-slate-700">{row.description}</td>
                      <td className="px-4 py-4">
                        <div className="flex flex-col gap-2">
                          <span
                            className={`inline-flex w-fit rounded-full border px-2.5 py-1 text-xs font-bold uppercase ${row.statusClass}`}
                          >
                            {row.kindLabel}
                          </span>
                          <span className="text-xs font-semibold text-slate-600">{row.statusLabel}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs font-semibold text-slate-500">
                Showing {(page - 1) * PAGE_SIZE + 1} to {Math.min(page * PAGE_SIZE, sortedLogs.length)} of {sortedLogs.length} activities
              </p>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={page === 1}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Prev
                </button>
                {pageNumbers.map((pageNumber) => (
                  <button
                    key={pageNumber}
                    type="button"
                    onClick={() => setPage(pageNumber)}
                    className={`rounded-xl px-3 py-2 text-xs font-bold ${
                      pageNumber === page
                        ? "bg-slate-900 text-white"
                        : "border border-slate-300 text-slate-700"
                    }`}
                  >
                    {pageNumber}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  disabled={page === totalPages}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
