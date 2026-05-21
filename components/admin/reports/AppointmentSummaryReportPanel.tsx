"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import ReportShell from "./ReportShell";
import { getUserDisplayNameByUid } from "@/lib/services/user-service";
import { isNoShowAppointmentStatus } from "@/lib/status-normalizers";

// TODO: implement this action
import { getAppointmentsInRange } from "@/app/actions/appointment-actions";

type AppointmentRow = {
  id: string;
  startAt: string; // ISO datetime
  patientName?: string;
  serviceType?: string;
  status?: string;
  dentistId?: string | null;
  proceduresCount?: number;
};

type AppointmentReportResponse = {
  rows: AppointmentRow[];
};

type Preset = "7d" | "30d" | "90d" | "180d" | "365d" | "thisMonth" | "lastMonth";

export default function AppointmentSummaryReportPanel() {
  const [preset, setPreset] = useState<Preset>("90d");
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | null>(null);
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [data, setData] = useState<AppointmentReportResponse | null>(null);
  const [dentistStats, setDentistStats] = useState<
    Array<{ dentistId: string; dentistName: string; appointments: number; procedures: number }>
  >([]);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const { fromISO, toISO, subtitle } = useMemo(() => {
    if (customRange?.from && customRange?.to) {
      const from = `${customRange.from}T00:00:00`;
      const to = `${customRange.to}T23:59:59`;
      return { fromISO: from, toISO: to, subtitle: `${customRange.from} to ${customRange.to}` };
    }

    const now = new Date();
    const start = new Date(now);
    const end = new Date(now);

    if (preset === "7d") {
      start.setDate(now.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      return { fromISO: start.toISOString(), toISO: end.toISOString(), subtitle: "Last 7 days" };
    }

    if (preset === "30d") {
      start.setDate(now.getDate() - 29);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      return { fromISO: start.toISOString(), toISO: end.toISOString(), subtitle: "Last 30 days" };
    }

    if (preset === "90d") {
      start.setDate(now.getDate() - 89);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      return { fromISO: start.toISOString(), toISO: end.toISOString(), subtitle: "Last 3 months" };
    }

    if (preset === "180d") {
      start.setDate(now.getDate() - 179);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      return { fromISO: start.toISOString(), toISO: end.toISOString(), subtitle: "Last 6 months" };
    }

    if (preset === "365d") {
      start.setDate(now.getDate() - 364);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      return { fromISO: start.toISOString(), toISO: end.toISOString(), subtitle: "Last 12 months" };
    }

    if (preset === "lastMonth") {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const e = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      return { fromISO: s.toISOString(), toISO: e.toISOString(), subtitle: monthLabel(s) };
    }

    // thisMonth
    const s = new Date(now.getFullYear(), now.getMonth(), 1);
    const e = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    return { fromISO: s.toISOString(), toISO: e.toISOString(), subtitle: monthLabel(s) };
  }, [preset, customRange]);

  useEffect(() => {
    let cancelled = false;
    setErr(null);

    startTransition(async () => {
      try {
        const res = (await getAppointmentsInRange({ fromISO, toISO })) as AppointmentReportResponse;
        if (!cancelled) setData(res);
      } catch (e: any) {
        console.error("AppointmentSummaryReportPanel load error:", e);
        if (!cancelled) setErr(e?.message ?? "Failed to load appointment summary.");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [fromISO, toISO]);

  const rows = data?.rows ?? [];
  const tooManyRows = rows.length > 2000;
  const stats = useMemo(() => computeAppointmentStats(rows), [rows]);
  const cancelledCount = useMemo(
    () => rows.filter((r) => String(r.status || "").toLowerCase() === "cancelled").length,
    [rows]
  );
  const noShowCount = useMemo(
    () => rows.filter((r) => isNoShowAppointmentStatus(r.status)).length,
    [rows]
  );
  const totalProcedures = useMemo(() => {
    return rows.reduce((sum, r) => {
      const status = String(r.status || "").toLowerCase();
      if (status !== "completed") return sum;
      return sum + Number(r.proceduresCount || 0);
    }, 0);
  }, [rows]);

  function onPrint() {
    const base = "/admin-dashboard/reports/print?type=appointments";
    const params = new URLSearchParams();
    const from = customRange?.from || fromISO.slice(0, 10);
    const to = customRange?.to || toISO.slice(0, 10);
    params.set("from", from);
    params.set("to", to);
    window.open(`${base}&${params.toString()}`, "_blank", "noopener,noreferrer");
  }

  function selectPreset(nextPreset: Preset) {
    setCustomRange(null);
    setFromDate("");
    setToDate("");
    setPreset(nextPreset);
  }

  useEffect(() => {
    if (tooManyRows) {
      if (dentistStats.length) setDentistStats([]);
      return;
    }
    if (!rows.length) {
      if (dentistStats.length) setDentistStats([]);
      return;
    }
    let cancelled = false;

    (async () => {
      const map = new Map<string, { dentistId: string; appointments: number; procedures: number }>();
      for (const r of rows) {
        const status = String(r.status || "").toLowerCase();
        if (status !== "completed") continue;
        const did = String(r.dentistId || "").trim();
        if (!did) continue;
        const prev = map.get(did) ?? { dentistId: did, appointments: 0, procedures: 0 };
        prev.appointments += 1;
        prev.procedures += Number(r.proceduresCount || 0);
        map.set(did, prev);
      }

      const entries = Array.from(map.values());
      const named = await Promise.all(
        entries.map(async (e) => {
          const name =
            (await getUserDisplayNameByUid(e.dentistId)) ||
            (e.dentistId.length > 10 ? `${e.dentistId.slice(0, 6)}…` : e.dentistId);
          return { ...e, dentistName: name };
        })
      );

      if (!cancelled) {
        setDentistStats(
          named.sort((a, b) => b.procedures - a.procedures || b.appointments - a.appointments)
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [rows, tooManyRows, dentistStats.length]);

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
          title: pending ? "Loading report…" : "No appointments found",
          description: pending
            ? "Please wait while we generate the report."
            : "Try another time range.",
        }
      : undefined;

  return (
    <ReportShell reportName="Appointment Summary Report" subtitle={subtitle} empty={empty}>
      {!data ? null : (
        <div className="space-y-4">
          {/* Presets */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-700">Range:</span>
            <PresetBtn label="3 months" active={!customRange && preset === "90d"} onClick={() => selectPreset("90d")} />
            <PresetBtn label="6 months" active={!customRange && preset === "180d"} onClick={() => selectPreset("180d")} />
            <PresetBtn label="12 months" active={!customRange && preset === "365d"} onClick={() => selectPreset("365d")} />
            <PresetBtn label="This month" active={!customRange && preset === "thisMonth"} onClick={() => selectPreset("thisMonth")} />
            <PresetBtn label="Last month" active={!customRange && preset === "lastMonth"} onClick={() => selectPreset("lastMonth")} />
            <PresetBtn label="7 days" active={!customRange && preset === "7d"} onClick={() => selectPreset("7d")} />
            <PresetBtn label="30 days" active={!customRange && preset === "30d"} onClick={() => selectPreset("30d")} />
            <button
              onClick={onPrint}
              className="ml-2 rounded-full px-4 py-1.5 text-sm font-extrabold bg-slate-900 text-white hover:bg-slate-800"
            >
              Print
            </button>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-600">From</label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="mt-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600">To</label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="mt-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              />
            </div>
            <button
              onClick={() => {
                if (fromDate && toDate) {
                  setCustomRange({ from: fromDate, to: toDate });
                }
              }}
              className="rounded-full px-4 py-2 text-sm font-extrabold bg-slate-900 text-white hover:bg-slate-800"
            >
              Apply
            </button>
            <button
              onClick={() => {
                setCustomRange(null);
                setFromDate("");
                setToDate("");
              }}
              className="rounded-full px-4 py-2 text-sm font-extrabold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            >
              Clear
            </button>
          </div>

          {pending ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              Generating report…
            </div>
          ) : null}

          {/* Summary */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
            <Card label="Total appointments" value={stats.total} />
            <Card label="Avg per day" value={stats.avgPerDayText} />
            <Card label="Busiest day" value={stats.peakDayText} />
            <Card label="Peak hour" value={stats.peakHourText} />
            <Card label="Cancellations" value={cancelledCount} />
            <Card label="No-shows" value={noShowCount} />
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Card label="Total procedures (completed)" value={totalProcedures} />
            <Card label="This week vs last week" value={stats.weekVsWeekText} />
            <Card label="This month vs last month" value={stats.monthVsMonthText} />
          </div>

          {/* Appointment details */}
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

          {/* Example line like you wanted */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-sm text-slate-700">
              Example: <span className="font-extrabold">{subtitle}:</span>{" "}
              <span className="font-extrabold">{stats.total}</span> total appointments • Avg/day:{" "}
              <span className="font-extrabold">{stats.avgPerDayText}</span> • Busiest day:{" "}
              <span className="font-extrabold">{stats.peakDayText}</span>
            </p>
          </div>
        </div>
      )}
    </ReportShell>
  );
}

function PresetBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={[
        "rounded-full px-3 py-1.5 text-sm font-semibold transition",
        active ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function Card({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-bold text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-extrabold text-slate-900">{value}</p>
    </div>
  );
}

function monthLabel(d: Date) {
  return d.toLocaleString(undefined, { month: "short", year: "numeric" });
}

function formatAppointmentDateTime(iso?: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * Computes:
 * - Total appointments
 * - Daily counts
 * - Avg per day
 * - Peak day
 * - Peak hour
 * - Week vs week (based on current date)
 * - Month vs month (based on current date)
 */
function computeAppointmentStats(rows: AppointmentRow[]) {
  const total = rows.length;

  // Daily counts by DATE (YYYY-MM-DD)  ✅
  const byDate = new Map<string, number>();

  // Weekday totals (Mon–Sun) ✅ for busiest weekday
  const byWeekday = new Map<string, number>();

  // Hour totals ✅ for peak hour
  const byHour = new Map<number, number>();

  for (const r of rows) {
    const d = new Date(r.startAt);
    if (Number.isNaN(d.getTime())) continue;

    const dateKey = d.toISOString().slice(0, 10); // YYYY-MM-DD
    byDate.set(dateKey, (byDate.get(dateKey) ?? 0) + 1);

    const weekdayKey = d.toLocaleDateString(undefined, { weekday: "long" });
    byWeekday.set(weekdayKey, (byWeekday.get(weekdayKey) ?? 0) + 1);

    const h = d.getHours();
    byHour.set(h, (byHour.get(h) ?? 0) + 1);
  }

  // ✅ Daily table should be chronological (not by count)
  const dailyCounts = [...byDate.entries()]
    .map(([day, count]) => ({ day, count }))
    .sort((a, b) => a.day.localeCompare(b.day)); // YYYY-MM-DD sorts lexicographically

  // ✅ Busiest weekday (Mon–Sun total within range)
  const peakWeekdayEntry = [...byWeekday.entries()].sort((a, b) => b[1] - a[1])[0];
  const peakDayText = peakWeekdayEntry ? `${peakWeekdayEntry[0]} (${peakWeekdayEntry[1]})` : "—";

  // ✅ Peak hour
  const peakHourEntry = [...byHour.entries()].sort((a, b) => b[1] - a[1])[0];
  const peakHourText = peakHourEntry
    ? `${String(peakHourEntry[0]).padStart(2, "0")}:00 (${peakHourEntry[1]})`
    : "—";

  // ✅ Avg/day uses distinct dates present in data
  const daysCount = Math.max(1, byDate.size);
  const avgPerDay = total / daysCount;
  const avgPerDayText =
    avgPerDay >= 10 ? `${Math.floor(avgPerDay)}–${Math.ceil(avgPerDay)}` : avgPerDay.toFixed(1);

  //  Comparisons (local time)
  const now = new Date();
  const startOfWeek = startOfLocalWeek(now); // Monday 00:00 local
  const startOfLastWeek = new Date(startOfWeek);
  startOfLastWeek.setDate(startOfWeek.getDate() - 7);

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

  const countInRange = (from: Date, to: Date) =>
    rows.reduce((acc, r) => {
      const d = new Date(r.startAt);
      if (Number.isNaN(d.getTime())) return acc;
      return d >= from && d <= to ? acc + 1 : acc;
    }, 0);

  const thisWeek = countInRange(startOfWeek, now);
  const lastWeek = countInRange(startOfLastWeek, new Date(startOfWeek.getTime() - 1));

  const thisMonth = countInRange(startOfMonth, now);
  const lastMonth = countInRange(startOfLastMonth, endOfLastMonth);

  const weekVsWeekText = `${thisWeek} vs ${lastWeek}`;
  const monthVsMonthText = `${thisMonth} vs ${lastMonth}`;

  return {
    total,
    // now this is per DATE for the table 
    dailyCounts: dailyCounts.length ? dailyCounts : [{ day: "—", count: 0 }],
    avgPerDayText,
    // now this is busiest WEEKDAY 
    peakDayText,
    peakHourText,
    weekVsWeekText,
    monthVsMonthText,
  };
}


function startOfLocalWeek(d: Date) {
  const date = new Date(d);
  const day = date.getDay(); // 0=Sun
  const diff = (day === 0 ? -6 : 1) - day; // Monday start
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}


