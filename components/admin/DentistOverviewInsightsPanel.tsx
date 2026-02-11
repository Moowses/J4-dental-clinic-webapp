"use client";

import { useEffect, useMemo, useState } from "react";
import { getDentistScheduleAction } from "@/app/actions/appointment-actions";
import type { Appointment } from "@/lib/types/appointment";

type RangeKey = "this-month" | "last-month" | "last-60";

function toISODate(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addDays(isoDate: string, days: number) {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

function buildRange(key: RangeKey) {
  const now = new Date();
  if (key === "this-month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: toISODate(start), to: toISODate(now) };
  }
  if (key === "last-month") {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from: toISODate(start), to: toISODate(end) };
  }
  const start = new Date(now.getTime() - 59 * 24 * 60 * 60 * 1000);
  return { from: toISODate(start), to: toISODate(now) };
}

function dateSpan(from: string, to: string) {
  const out: string[] = [];
  let cur = from;
  while (cur <= to) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

function VerticalGroupedBarChart({
  data,
  firstKey,
  secondKey,
  firstColor,
  secondColor,
}: {
  data: { label: string; [k: string]: number | string }[];
  firstKey: string;
  secondKey: string;
  firstColor: string;
  secondColor: string;
}) {
  const max = Math.max(
    1,
    ...data.map((d) => Math.max(Number(d[firstKey] || 0), Number(d[secondKey] || 0)))
  );
  const width = 620;
  const height = 220;
  const leftPad = 34;
  const rightPad = 16;
  const topPad = 12;
  const bottomPad = 34;
  const innerW = width - leftPad - rightPad;
  const innerH = height - topPad - bottomPad;
  const groupW = innerW / Math.max(1, data.length);
  const barW = Math.max(4, Math.min(12, (groupW - 6) / 2));

  const yTicks = [0, Math.round(max * 0.5), max];
  const labelStep = Math.max(1, Math.ceil(data.length / 14));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
      {yTicks.map((v, i) => {
        const y = topPad + innerH - (innerH * v) / max;
        return (
          <g key={`tick-${i}`}>
            <line x1={leftPad} x2={width - rightPad} y1={y} y2={y} stroke="#e2e8f0" />
            <text x={4} y={y + 4} fontSize="9" fill="#64748b">
              {v}
            </text>
          </g>
        );
      })}

      {data.map((d, i) => {
        const center = leftPad + i * groupW + groupW / 2;
        const v1 = Number(d[firstKey] || 0);
        const v2 = Number(d[secondKey] || 0);
        const h1 = (innerH * v1) / max;
        const h2 = (innerH * v2) / max;
        const y1 = topPad + innerH - h1;
        const y2 = topPad + innerH - h2;

        const showLabel = i % labelStep === 0 || i === data.length - 1;

        return (
          <g key={String(d.label)}>
            <rect x={center - barW - 2} y={y1} width={barW} height={h1} rx="3" fill={firstColor} />
            <rect x={center + 2} y={y2} width={barW} height={h2} rx="3" fill={secondColor} />
            {showLabel ? (
              <text x={center} y={height - 10} fontSize="9" textAnchor="middle" fill="#64748b">
                {String(d.label)}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

function DailyCountBarChart({
  data,
  color = "#2563eb",
}: {
  data: { label: string; value: number }[];
  color?: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const width = 620;
  const height = 220;
  const leftPad = 34;
  const rightPad = 16;
  const topPad = 12;
  const bottomPad = 34;
  const innerW = width - leftPad - rightPad;
  const innerH = height - topPad - bottomPad;
  const barW = Math.max(4, innerW / Math.max(1, data.length) - 2);
  const yTicks = [0, Math.round(max * 0.5), max];
  const labelStep = Math.max(1, Math.ceil(data.length / 14));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
      {yTicks.map((v, i) => {
        const y = topPad + innerH - (innerH * v) / max;
        return (
          <g key={`y-${i}`}>
            <line x1={leftPad} x2={width - rightPad} y1={y} y2={y} stroke="#e2e8f0" />
            <text x={4} y={y + 4} fontSize="9" fill="#64748b">
              {v}
            </text>
          </g>
        );
      })}

      {data.map((d, i) => {
        const x = leftPad + (i * innerW) / Math.max(1, data.length) + 1;
        const h = (innerH * d.value) / max;
        const y = topPad + innerH - h;
        const showLabel = i % labelStep === 0 || i === data.length - 1;

        return (
          <g key={`${d.label}-${i}`}>
            <rect x={x} y={y} width={barW} height={h} rx="2" fill={color} />
            {showLabel ? (
              <text
                x={x + barW / 2}
                y={height - 10}
                fontSize="9"
                textAnchor="middle"
                fill="#64748b"
              >
                {d.label}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

function HorizontalBarList({
  data,
}: {
  data: { label: string; value: number }[];
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="space-y-2">
      {data.map((d) => {
        const pct = Math.max(6, Math.round((d.value / max) * 100));
        return (
          <div key={d.label} className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-slate-700 truncate">{d.label}</span>
              <span className="font-bold text-slate-600">{d.value}</span>
            </div>
            <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full rounded-full bg-teal-600" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function metricSizeClass(displayValue: string) {
  const len = displayValue.length;
  if (len >= 12) return "text-xl";
  if (len >= 9) return "text-2xl";
  return "text-2xl sm:text-3xl";
}

export default function DentistOverviewInsightsPanel() {
  const [rangeKey, setRangeKey] = useState<RangeKey>("this-month");
  const [loading, setLoading] = useState(true);
  const [appointments, setAppointments] = useState<Appointment[]>([]);

  const todayISO = useMemo(() => toISODate(new Date()), []);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const from = addDays(todayISO, -89);
      const days = dateSpan(from, todayISO);
      const rows: Appointment[] = [];

      const concurrency = 8;
      let idx = 0;
      const workers = new Array(concurrency).fill(0).map(async () => {
        while (idx < days.length) {
          const i = idx++;
          const date = days[i];
          const res = await getDentistScheduleAction(date);
          if (!alive) return;
          if (res?.success && Array.isArray(res.data)) {
            for (const a of res.data) rows.push({ ...a, date: (a as Appointment).date || date });
          }
        }
      });
      await Promise.all(workers);
      if (!alive) return;

      rows.sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
      setAppointments(rows);
      setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [todayISO]);

  const todaysAppointments = useMemo(() => {
    return appointments.filter((a) => String(a.date || "") === todayISO).length;
  }, [appointments, todayISO]);
  const todaysAppointmentsDisplay = loading
    ? "..."
    : Number(todaysAppointments || 0).toLocaleString();

  const range = useMemo(() => buildRange(rangeKey), [rangeKey]);

  const rangeAppointments = useMemo(() => {
    return appointments.filter((a) => {
      const d = String(a.date || "");
      return d >= range.from && d <= range.to;
    });
  }, [appointments, range]);

  const topProcedures = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of rangeAppointments) {
      const status = String(a.status || "").toLowerCase();
      if (status !== "completed") continue;
      const procedures = Array.isArray(a.treatment?.procedures) ? a.treatment!.procedures : [];
      for (const p of procedures) {
        const name = String(p?.name || "").trim();
        if (!name) continue;
        map.set(name, (map.get(name) || 0) + 1);
      }
    }
    const list = Array.from(map.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
    if (!list.length) {
      return [{ label: "No completed procedure yet", value: 0 }];
    }
    return list;
  }, [rangeAppointments]);

  const appointmentHistorySeries = useMemo(() => {
    const days = dateSpan(range.from, range.to);
    return days.map((d) => {
      const count = rangeAppointments.filter((a) => String(a.date || "") === d).length;
      return { label: d.slice(5), value: count };
    });
  }, [range, rangeAppointments]);

  const productivitySeries = useMemo(() => {
    const from = addDays(todayISO, -6);
    const days = dateSpan(from, todayISO);
    return days.map((d) => {
      const daily = appointments.filter((a) => String(a.date || "") === d);
      const completed = daily.filter((a) => String(a.status || "").toLowerCase() === "completed");
      const procedures = completed.reduce((sum, a) => {
        const list = Array.isArray(a.treatment?.procedures) ? a.treatment!.procedures : [];
        return sum + list.length;
      }, 0);
      return {
        label: d.slice(5),
        completedAppointments: completed.length,
        procedures,
      };
    });
  }, [appointments, todayISO]);

  const productivityTotals = useMemo(() => {
    return productivitySeries.reduce(
      (acc, d) => {
        acc.completed += d.completedAppointments;
        acc.procedures += d.procedures;
        return acc;
      },
      { completed: 0, procedures: 0 }
    );
  }, [productivitySeries]);

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5">
        <p className="text-base sm:text-lg font-bold text-slate-900">Dentist Overview</p>
        <p className="text-sm text-slate-500">Today&apos;s Appointments only</p>
        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            Today&apos;s Appointments
          </p>
          <p
            className={`mt-2 font-bold text-slate-900 leading-tight break-words [overflow-wrap:anywhere] tabular-nums ${metricSizeClass(
              todaysAppointmentsDisplay
            )}`}
          >
            {todaysAppointmentsDisplay}
          </p>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-lg font-bold text-slate-900">Insights</p>
            <p className="text-sm text-slate-500">This month, last month, and last 60 days</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setRangeKey("this-month")}
              className={`px-3 py-2 rounded-xl text-xs font-extrabold border ${
                rangeKey === "this-month"
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
              }`}
            >
              This month
            </button>
            <button
              onClick={() => setRangeKey("last-month")}
              className={`px-3 py-2 rounded-xl text-xs font-extrabold border ${
                rangeKey === "last-month"
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
              }`}
            >
              Last month
            </button>
            <button
              onClick={() => setRangeKey("last-60")}
              className={`px-3 py-2 rounded-xl text-xs font-extrabold border ${
                rangeKey === "last-60"
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
              }`}
            >
              Last 60 days
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-sm font-extrabold text-slate-900">My top procedure</p>
            <p className="text-xs text-slate-500 mb-3">Bar graph (Top 5 by count)</p>
            <HorizontalBarList data={topProcedures} />
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-sm font-extrabold text-slate-900">Appointment History Chart</p>
            <p className="text-xs text-slate-500">Daily patient counts</p>
            <div className="mt-3">
              <DailyCountBarChart data={appointmentHistorySeries} />
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-extrabold text-slate-900">My productivity</p>
          <p className="text-xs text-slate-500">Last 7 days</p>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-500 font-bold">
                Total Completed Appointments
              </p>
            <p className="text-lg sm:text-xl font-bold text-slate-900 tabular-nums">
              {productivityTotals.completed}
            </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-500 font-bold">
                Total Procedures
              </p>
            <p className="text-lg sm:text-xl font-bold text-slate-900 tabular-nums">
              {productivityTotals.procedures}
            </p>
            </div>
          </div>
          <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-center gap-4 text-xs text-slate-600 mb-2">
              <span className="inline-flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-teal-600" />
                Completed appointments
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-violet-600" />
                Procedures
              </span>
            </div>
            <VerticalGroupedBarChart
              data={productivitySeries.map((d) => ({
                label: d.label,
                completed: d.completedAppointments,
                procedures: d.procedures,
              }))}
              firstKey="completed"
              secondKey="procedures"
              firstColor="#0f766e"
              secondColor="#7c3aed"
            />
          </div>
        </div>
      </section>
    </div>
  );
}
