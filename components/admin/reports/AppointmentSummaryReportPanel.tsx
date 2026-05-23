"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import ReportShell from "./ReportShell";
import { getAppointmentsInRange } from "@/app/actions/appointment-actions";

type AppointmentRow = {
  id: string;
  startAt: string;
  patientName?: string;
  serviceType?: string;
  status?: string;
  dentistId?: string | null;
  proceduresCount?: number;
};

type AppointmentReportResponse = {
  rows: AppointmentRow[];
};

export default function AppointmentSummaryReportPanel() {
  const today = useMemo(() => getDateInputValue(new Date()), []);
  const currentMonthStart = useMemo(() => getDateInputValue(getStartOfCurrentMonth()), []);
  const [fromDate, setFromDate] = useState<string>(currentMonthStart);
  const [toDate, setToDate] = useState<string>(today);
  const [data, setData] = useState<AppointmentReportResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const { fromISO, toISO, subtitle } = useMemo(() => {
    const from = fromDate || today;
    const to = toDate || from;
    return {
      fromISO: `${from}T00:00:00`,
      toISO: `${to}T23:59:59`,
      subtitle: `${from} to ${to}`,
    };
  }, [fromDate, toDate, today]);

  useEffect(() => {
    let cancelled = false;

    startTransition(async () => {
      try {
        const res = (await getAppointmentsInRange({ fromISO, toISO })) as AppointmentReportResponse;
        if (!cancelled) {
          setErr(null);
          setData(res);
        }
      } catch (e: unknown) {
        console.error("AppointmentSummaryReportPanel load error:", e);
        if (!cancelled) setErr(getErrorMessage(e, "Failed to load appointment summary."));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [fromISO, toISO]);

  const rows = useMemo(() => sortAppointmentsByRecentMonthAscending(data?.rows ?? []), [data]);
  const tooManyRows = rows.length > 2000;

  function onPrint() {
    const base = "/admin-dashboard/reports/print?type=appointments";
    const params = new URLSearchParams();
    params.set("from", fromISO.slice(0, 10));
    params.set("to", toISO.slice(0, 10));
    window.open(`${base}&${params.toString()}`, "_blank", "noopener,noreferrer");
  }

  if (err) {
    return (
      <ReportShell
        reportName="Appointment Summary Report"
        subtitle={subtitle}
        empty={{ title: "Error loading report", description: err }}
      >
        <div />
      </ReportShell>
    );
  }

  if (tooManyRows) {
    return (
      <ReportShell
        reportName="Appointment Summary Report"
        subtitle={subtitle}
        empty={{
          title: "Too many appointments to summarize",
          description: "Narrow the date range to generate this report.",
        }}
      >
        <div />
      </ReportShell>
    );
  }

  const empty =
    !data || rows.length === 0
      ? {
          title: pending ? "Loading report..." : "No appointments found",
          description: pending
            ? "Please wait while we generate the report."
            : "Try another start date and end date.",
        }
      : undefined;

  return (
    <ReportShell reportName="Appointment Summary Report" subtitle={subtitle} empty={empty}>
      {!data ? null : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-600">Start date</label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="mt-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600">End date</label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="mt-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              />
            </div>
            <button
              onClick={onPrint}
              className="rounded-full bg-slate-900 px-4 py-2 text-sm font-extrabold text-white hover:bg-slate-800"
            >
              Print
            </button>
          </div>

          {pending ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              Generating report...
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Card label="Total appointments" value={rows.length} />
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr className="text-left text-slate-600">
                  <th className="px-4 py-3 font-bold">Date and Time</th>
                  <th className="px-4 py-3 font-bold">Patient Name</th>
                  <th className="px-4 py-3 font-bold">Service Booked</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((appointment) => (
                  <tr key={appointment.id} className="border-t border-slate-200">
                    <td className="px-4 py-3 font-semibold text-slate-900">
                      {formatAppointmentDateTime(appointment.startAt)}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {appointment.patientName || "Unknown Patient"}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {appointment.serviceType || "Dental Service"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </ReportShell>
  );
}

function Card({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-bold text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-extrabold text-slate-900">{value}</p>
    </div>
  );
}

function formatAppointmentDateTime(iso?: string) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function getDateInputValue(d: Date) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function getStartOfCurrentMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function sortAppointmentsByRecentMonthAscending(rows: AppointmentRow[]) {
  return [...rows].sort((a, b) => {
    const aTime = new Date(a.startAt).getTime();
    const bTime = new Date(b.startAt).getTime();
    const safeA = Number.isNaN(aTime) ? 0 : aTime;
    const safeB = Number.isNaN(bTime) ? 0 : bTime;
    const aDate = new Date(safeA);
    const bDate = new Date(safeB);
    const aMonth = aDate.getFullYear() * 12 + aDate.getMonth();
    const bMonth = bDate.getFullYear() * 12 + bDate.getMonth();
    if (aMonth !== bMonth) return bMonth - aMonth;
    return safeA - safeB;
  });
}
