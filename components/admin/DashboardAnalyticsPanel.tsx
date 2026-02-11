"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { doc, getDoc } from "firebase/firestore";

import { db } from "@/lib/firebase/firebase";
import { getBillingReportByRange } from "@/app/actions/billing-report-actions";
import { getAppointmentsInRange } from "@/app/actions/appointment-actions";
import { getUserDisplayNameByUid } from "@/lib/services/user-service";

type BillingRow = {
  id: string;
  appointmentId?: string;
  totalAmount: number;
  remainingBalance: number;
  createdAt?: string;
};

type AppointmentRow = {
  id: string;
  startAt: string;
  status?: string;
  dentistId?: string | null;
  proceduresCount?: number;
};

type BillingRecordDoc = {
  appointmentId?: string;
  items?: { id: string; name: string; price?: number }[];
  paymentPlan?: { installments?: { id: string; status?: string }[] };
  transactions?: {
    id?: string;
    amount: number;
    date?: any;
    mode?: string;
    itemIds?: string[];
  }[];
};

type RangeKey = "this-month" | "last-month" | "last-60";

function toISODate(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function toDate(input: any): Date | null {
  try {
    if (!input) return null;
    if (input?.seconds) return new Date(input.seconds * 1000);
    if (typeof input === "string" || typeof input === "number") return new Date(input);
    if (input instanceof Date) return input;
    if (input?.toDate) return input.toDate();
    return null;
  } catch {
    return null;
  }
}

function money(n: number) {
  const num = Number(n || 0);
  return num.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function buildRange(key: RangeKey) {
  const now = new Date();
  if (key === "this-month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: toISODate(start), to: toISODate(now), label: "This month" };
  }
  if (key === "last-month") {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from: toISODate(start), to: toISODate(end), label: "Last month" };
  }
  const start = new Date(now.getTime() - 59 * 24 * 60 * 60 * 1000);
  return { from: toISODate(start), to: toISODate(now), label: "Last 60 days" };
}

function LineChart({
  data,
  height = 140,
  showAxis = true,
}: {
  data: { label: string; value: number }[];
  height?: number;
  showAxis?: boolean;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const width = 560;
  const padding = 24;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;

  const points = data.map((d, i) => {
    const x = padding + (innerW * i) / Math.max(1, data.length - 1);
    const y = padding + innerH - (innerH * d.value) / max;
    return `${x},${y}`;
  });

  const yTicks = showAxis ? [max, Math.round(max * 0.5), 0] : [];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
      {showAxis
        ? yTicks.map((v, i) => {
            const y = padding + innerH - (innerH * v) / max;
            return (
              <g key={`y-${i}`}>
                <line x1={padding} x2={width - padding} y1={y} y2={y} stroke="#e2e8f0" />
                <text x={2} y={y + 4} fontSize="9" fill="#64748b">
                  {Math.round(v)}
                </text>
              </g>
            );
          })
        : null}
      <polyline
        fill="none"
        stroke="#0f766e"
        strokeWidth="2"
        points={points.join(" ")}
      />
      {data.map((d, i) => {
        const x = padding + (innerW * i) / Math.max(1, data.length - 1);
        const y = padding + innerH - (innerH * d.value) / max;
        return <circle key={d.label} cx={x} cy={y} r="3" fill="#0f766e" />;
      })}
    </svg>
  );
}

function BarChart({
  data,
  height = 160,
  colors,
}: {
  data: { label: string; value: number }[];
  height?: number;
  colors?: string[];
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const width = 560;
  const padding = 24;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;
  const barW = innerW / Math.max(1, data.length) - 10;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
      {data.map((d, i) => {
        const x = padding + i * (barW + 10);
        const h = (innerH * d.value) / max;
        const y = padding + innerH - h;
        const fill = colors?.[i] || "#1d4ed8";
        return (
          <rect
            key={d.label}
            x={x}
            y={y}
            width={barW}
            height={h}
            fill={fill}
            rx="6"
          />
        );
      })}
    </svg>
  );
}

function MultiLineChart({
  series,
  height = 160,
  showAxis = true,
}: {
  series: Array<{ name: string; color: string; data: { label: string; value: number }[] }>;
  height?: number;
  showAxis?: boolean;
}) {
  const width = 560;
  const padding = 24;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;

  const max = Math.max(
    1,
    ...series.flatMap((s) => s.data.map((d) => d.value))
  );

  const xCount = Math.max(1, series[0]?.data.length || 1);
  const x = (i: number) =>
    padding + (innerW * i) / Math.max(1, xCount - 1);
  const y = (v: number) => padding + innerH - (innerH * v) / max;

  const yTicks = showAxis ? [max, Math.round(max * 0.5), 0] : [];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
      {showAxis
        ? yTicks.map((v, i) => (
            <g key={`y-${i}`}>
              <line x1={padding} x2={width - padding} y1={y(v)} y2={y(v)} stroke="#e2e8f0" />
              <text x={2} y={y(v) + 4} fontSize="9" fill="#64748b">
                {Math.round(v)}
              </text>
            </g>
          ))
        : null}
      {series.map((s) => (
        <g key={s.name}>
          <polyline
            fill="none"
            stroke={s.color}
            strokeWidth="2"
            points={s.data.map((d, i) => `${x(i)},${y(d.value)}`).join(" ")}
          />
          {s.data.map((d, i) => (
            <circle key={`${s.name}-${d.label}`} cx={x(i)} cy={y(d.value)} r="3" fill={s.color} />
          ))}
        </g>
      ))}
    </svg>
  );
}

export default function DashboardAnalyticsPanel() {
  const [rangeKey, setRangeKey] = useState<RangeKey>("this-month");
  const [pending, startTransition] = useTransition();
  const [billingRows, setBillingRows] = useState<BillingRow[]>([]);
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [topProcedures, setTopProcedures] = useState<Array<{ name: string; amount: number }>>(
    []
  );
  const [procedureSeries, setProcedureSeries] = useState<
    Array<{ name: string; color: string; data: { label: string; value: number }[] }>
  >([]);
  const [dentistIncome, setDentistIncome] = useState<
    Array<{ dentistId: string; dentistName: string; collected: number; procedures: number }>
  >([]);
  const [dentistProductivity, setDentistProductivity] = useState<
    Array<{ dentistId: string; dentistName: string; procedures: number; appointments: number }>
  >([]);
  const [aging, setAging] = useState<{ "0-30": number; "31-60": number; "61-90": number; "90+": number }>({
    "0-30": 0,
    "31-60": 0,
    "61-90": 0,
    "90+": 0,
  });

  const range = useMemo(() => buildRange(rangeKey), [rangeKey]);
  const barPalette = ["#1d4ed8", "#0f766e", "#f59e0b", "#7c3aed", "#dc2626", "#0891b2"];

  useEffect(() => {
    let cancelled = false;

    startTransition(async () => {
      try {
        const billing = (await getBillingReportByRange({
          fromISO: `${range.from}T00:00:00`,
          toISO: `${range.to}T23:59:59`,
        })) as { rows: BillingRow[] };
        if (cancelled) return;

        const rows = Array.isArray(billing?.rows) ? billing.rows : [];
        setBillingRows(rows);

        const apptRes = (await getAppointmentsInRange({
          fromISO: `${range.from}T00:00:00`,
          toISO: `${range.to}T23:59:59`,
        })) as { rows: AppointmentRow[] };
        if (!cancelled) setAppointments(apptRes?.rows || []);

        const buckets = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
        const now = Date.now();
        for (const r of rows) {
          const remaining = Number(r.remainingBalance || 0);
          if (remaining <= 0) continue;
          const created = r.createdAt ? new Date(r.createdAt).getTime() : NaN;
          if (!Number.isFinite(created)) {
            buckets["90+"] += remaining;
            continue;
          }
          const days = Math.floor((now - created) / (1000 * 60 * 60 * 24));
          if (days <= 30) buckets["0-30"] += remaining;
          else if (days <= 60) buckets["31-60"] += remaining;
          else if (days <= 90) buckets["61-90"] += remaining;
          else buckets["90+"] += remaining;
        }
        if (!cancelled) setAging(buckets);

        if (rows.length > 150) {
          if (!cancelled) {
            setTopProcedures([]);
            setDentistIncome([]);
            setProcedureSeries([]);
          }
          return;
        }

        const procedureTotals = new Map<string, number>();
        const dentistTotals = new Map<string, { dentistId: string; collected: number; procedures: number }>();
        const appointmentCache = new Map<string, any>();
        const recordDocs: Array<{ id: string; rec: BillingRecordDoc }> = [];

        const recordIds = rows.map((r) => r.id);
        const chunkSize = 20;
        for (let i = 0; i < recordIds.length; i += chunkSize) {
          const batch = recordIds.slice(i, i + chunkSize);
          const snaps = await Promise.all(
            batch.map(async (id) => {
              const snap = await getDoc(doc(db, "billing_records", id));
              return snap.exists() ? { id, rec: snap.data() as BillingRecordDoc } : null;
            })
          );
          for (const s of snaps) {
            if (s) recordDocs.push(s);
          }
        }

        const appointmentIds = Array.from(
          new Set(recordDocs.map(({ id, rec }) => rec.appointmentId ?? rows.find((r) => r.id === id)?.appointmentId).filter(Boolean))
        ) as string[];

        for (let i = 0; i < appointmentIds.length; i += chunkSize) {
          const batch = appointmentIds.slice(i, i + chunkSize);
          const snaps = await Promise.all(
            batch.map(async (id) => {
              try {
                const snap = await getDoc(doc(db, "appointments", id));
                return snap.exists() ? { id, data: snap.data() } : null;
              } catch {
                return null;
              }
            })
          );
          for (const s of snaps) {
            if (s) appointmentCache.set(s.id, s.data);
          }
        }

        for (const { id: recordId, rec } of recordDocs) {
          const row = rows.find((r) => r.id === recordId);
          if (!row) continue;

          const appointmentId = rec.appointmentId ?? row.appointmentId ?? recordId;
          const appointmentData = appointmentId ? appointmentCache.get(appointmentId) : null;
          const dentistId = appointmentData?.dentistId ? String(appointmentData.dentistId) : "";
          const proceduresCount = Array.isArray(appointmentData?.treatment?.procedures)
            ? appointmentData.treatment.procedures.length
            : 0;

          const items = Array.isArray(rec.items) ? rec.items : [];
          for (const it of items) {
            const key = String(it?.name || "Procedure");
            const prev = procedureTotals.get(key) ?? 0;
            const price = Number((it as any)?.price ?? 0);
            procedureTotals.set(key, prev + (Number.isFinite(price) ? price : 0));
          }

          let appointmentCollected = 0;
          const transactions = Array.isArray(rec.transactions) ? rec.transactions : [];
          for (const t of transactions) {
            appointmentCollected += Number(t.amount || 0);
          }

          if (dentistId) {
            const prev = dentistTotals.get(dentistId) ?? {
              dentistId,
              collected: 0,
              procedures: 0,
            };
            prev.collected += appointmentCollected;
            prev.procedures += proceduresCount;
            dentistTotals.set(dentistId, prev);
          }
        }

        const top = Array.from(procedureTotals.entries())
          .map(([name, amount]) => ({ name, amount }))
          .sort((a, b) => b.amount - a.amount)
          .slice(0, 6);

        const topNames = top.slice(0, 4).map((p) => p.name);
        const dayList: { label: string; key: string }[] = [];
        const start = new Date(`${range.from}T00:00:00`);
        const end = new Date(`${range.to}T00:00:00`);
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          const key = toISODate(d);
          dayList.push({ key, label: key.slice(5) });
        }
        const procDayTotals = new Map<string, Map<string, number>>();
        for (const name of topNames) procDayTotals.set(name, new Map());

        for (const { id: recordId, rec } of recordDocs) {
          const row = rows.find((r) => r.id === recordId);
          if (!row?.createdAt) continue;
          const created = new Date(row.createdAt);
          if (Number.isNaN(created.getTime())) continue;
          const dayKey = toISODate(created);
          const items = Array.isArray(rec.items) ? rec.items : [];
          for (const it of items) {
            const name = String(it?.name || "Procedure");
            if (!procDayTotals.has(name)) continue;
            const price = Number((it as any)?.price ?? 0);
            const map = procDayTotals.get(name)!;
            map.set(dayKey, (map.get(dayKey) ?? 0) + (Number.isFinite(price) ? price : 0));
          }
        }

        const palette = ["#0f766e", "#1d4ed8", "#f59e0b", "#dc2626"];
        const series = topNames.map((name, idx) => ({
          name,
          color: palette[idx % palette.length],
          data: dayList.map((d) => ({
            label: d.label,
            value: procDayTotals.get(name)?.get(d.key) ?? 0,
          })),
        }));

        const dentistIncomeList = await Promise.all(
          Array.from(dentistTotals.values()).map(async (d) => {
            const name =
              (await getUserDisplayNameByUid(d.dentistId)) ||
              (d.dentistId.length > 10 ? `${d.dentistId.slice(0, 6)}` : d.dentistId);
            return { ...d, dentistName: name };
          })
        );

        if (!cancelled) {
          setTopProcedures(top);
          setDentistIncome(dentistIncomeList.sort((a, b) => b.collected - a.collected));
          setProcedureSeries(series);
        }
      } catch {
        if (!cancelled) {
          setBillingRows([]);
          setAppointments([]);
          setTopProcedures([]);
          setDentistIncome([]);
          setProcedureSeries([]);
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, [range.from, range.to]);

  const salesByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of billingRows) {
      const d = r.createdAt ? new Date(r.createdAt) : null;
      if (!d || Number.isNaN(d.getTime())) continue;
      const key = toISODate(d);
      const collected = Number(r.totalAmount || 0) - Number(r.remainingBalance || 0);
      map.set(key, (map.get(key) ?? 0) + Math.max(0, collected));
    }
    const days = [];
    const start = new Date(`${range.from}T00:00:00`);
    const end = new Date(`${range.to}T00:00:00`);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const key = toISODate(d);
      days.push({ label: key.slice(5), value: Number(map.get(key) ?? 0) });
    }
    return days;
  }, [billingRows, range.from, range.to]);

  const apptDaily = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of appointments) {
      const d = new Date(r.startAt);
      if (Number.isNaN(d.getTime())) continue;
      const key = toISODate(d);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    const days = [];
    const start = new Date(`${range.from}T00:00:00`);
    const end = new Date(`${range.to}T00:00:00`);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const key = toISODate(d);
      days.push({ label: key.slice(5), value: Number(map.get(key) ?? 0) });
    }
    return days;
  }, [appointments, range.from, range.to]);

  const apptStats = useMemo(() => {
    const total = appointments.length;
    const avg = apptDaily.length ? total / apptDaily.length : 0;
    return { total, avg: Number(avg.toFixed(1)) };
  }, [appointments, apptDaily.length]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const map = new Map<string, { dentistId: string; procedures: number; appointments: number }>();
      for (const r of appointments) {
        const status = String(r.status || "").toLowerCase();
        if (status !== "completed") continue;
        const did = String(r.dentistId || "").trim();
        if (!did) continue;
        const prev = map.get(did) ?? { dentistId: did, procedures: 0, appointments: 0 };
        prev.appointments += 1;
        prev.procedures += Number(r.proceduresCount || 0);
        map.set(did, prev);
      }

      const list = await Promise.all(
        Array.from(map.values()).map(async (d) => {
          const name =
            (await getUserDisplayNameByUid(d.dentistId)) ||
            (d.dentistId.length > 10 ? `${d.dentistId.slice(0, 6)}` : d.dentistId);
          return { ...d, dentistName: name };
        })
      );

      if (!cancelled) {
        setDentistProductivity(
          list.sort((a, b) => b.appointments - a.appointments).slice(0, 6)
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [appointments]);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-lg sm:text-xl font-extrabold text-slate-900">Dashboard Insights</p>
          <p className="text-sm text-slate-500">Charts for sales and appointments.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(["this-month", "last-month", "last-60"] as RangeKey[]).map((key) => {
            const label = buildRange(key).label;
            return (
              <button
                key={key}
                onClick={() => setRangeKey(key)}
                className={[
                  "rounded-full px-3 py-1.5 text-xs sm:text-sm font-semibold transition",
                  rangeKey === key
                    ? "bg-slate-900 text-white"
                    : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                ].join(" ")}
              >
                {label}
              </button>
            );
          })}
          <span className="text-xs text-slate-400 font-bold">{range.from} to {range.to}</span>
        </div>
      </div>

      {pending ? (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          Loading dashboard charts...
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-extrabold text-slate-900">Sales Trend</p>
          <p className="text-xs text-slate-500">Billed by top procedures</p>
          <div className="mt-3">
            {procedureSeries.length ? (
              <MultiLineChart series={procedureSeries} />
            ) : (
              <LineChart data={salesByDay} />
            )}
          </div>
          {procedureSeries.length ? (
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-600">
              {procedureSeries.map((s) => (
                <div key={s.name} className="inline-flex items-center gap-2">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                  <span className="truncate max-w-[140px]">{s.name}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-extrabold text-slate-900">Appointment History</p>
          <p className="text-xs text-slate-500">Total: {apptStats.total} | Avg/day: {apptStats.avg}</p>
          <div className="mt-3">
            <LineChart data={apptDaily} />
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-extrabold text-slate-900">Top Procedures (Billed)</p>
          {topProcedures.length ? (
            <>
              <div className="mt-3">
                <BarChart
                  data={topProcedures.map((p) => ({ label: p.name, value: p.amount }))}
                  colors={topProcedures.map((_, i) => barPalette[i % barPalette.length])}
                />
              </div>
              <div className="mt-2 space-y-1 text-xs text-slate-600">
                {topProcedures.map((p) => (
                  <div key={p.name} className="flex items-center justify-between gap-3">
                    <span className="min-w-0 inline-flex items-center gap-2 truncate">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ background: barPalette[topProcedures.indexOf(p) % barPalette.length] }}
                      />
                      <span className="truncate">{p.name}</span>
                    </span>
                    <span className="shrink-0 text-xs sm:text-sm font-extrabold tabular-nums text-right">
                      PHP {money(p.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="mt-3 text-xs text-slate-500">No procedure data for this range.</p>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-extrabold text-slate-900">Dentist Income</p>
          {dentistIncome.length ? (
            <>
              <div className="mt-3">
                <BarChart
                  data={dentistIncome.slice(0, 6).map((d) => ({
                    label: d.dentistName,
                    value: d.collected,
                  }))}
                  colors={dentistIncome.slice(0, 6).map((_, i) => barPalette[i % barPalette.length])}
                />
              </div>
              <div className="mt-2 space-y-1 text-xs text-slate-600">
                {dentistIncome.slice(0, 6).map((d, i) => (
                  <div key={d.dentistId} className="flex items-center justify-between gap-3">
                    <span className="min-w-0 inline-flex items-center gap-2 truncate">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ background: barPalette[i % barPalette.length] }}
                      />
                      <span className="truncate">{d.dentistName}</span>
                    </span>
                    <span className="shrink-0 text-xs sm:text-sm font-extrabold tabular-nums text-right">
                      PHP {money(d.collected)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="mt-3 text-xs text-slate-500">No dentist income data.</p>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-extrabold text-slate-900">Outstanding Aging</p>
          <div className="mt-3">
            <BarChart
              data={[
                { label: "0-30", value: aging["0-30"] },
                { label: "31-60", value: aging["31-60"] },
                { label: "61-90", value: aging["61-90"] },
                { label: "90+", value: aging["90+"] },
              ]}
              colors={["#0f766e", "#f59e0b", "#dc2626", "#7c3aed"]}
              height={140}
            />
          </div>
          <div className="mt-3 space-y-2 text-xs sm:text-sm text-slate-700">
            <div className="flex items-center justify-between">
              <span>0-30 days</span>
              <span className="shrink-0 font-extrabold tabular-nums">PHP {money(aging["0-30"])}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>31-60 days</span>
              <span className="shrink-0 font-extrabold tabular-nums">PHP {money(aging["31-60"])}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>61-90 days</span>
              <span className="shrink-0 font-extrabold tabular-nums">PHP {money(aging["61-90"])}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>90+ days</span>
              <span className="shrink-0 font-extrabold tabular-nums">PHP {money(aging["90+"])}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
        <p className="text-sm font-extrabold text-slate-900">Dentist Productivity</p>
        <p className="text-xs text-slate-500">Completed appointments and procedures</p>
        {dentistProductivity.length ? (
          <div className="mt-3">
            <BarChart
              data={dentistProductivity.map((d) => ({
                label: d.dentistName,
                value: d.appointments,
              }))}
              colors={dentistProductivity.map((_, i) => barPalette[i % barPalette.length])}
              height={140}
            />
          </div>
        ) : null}
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-slate-600">
                <th className="px-4 py-3 font-bold">Dentist</th>
                <th className="px-4 py-3 font-bold">Completed Appts</th>
                <th className="px-4 py-3 font-bold">Procedures</th>
              </tr>
            </thead>
            <tbody>
              {dentistProductivity.length ? (
                dentistProductivity.map((d) => (
                  <tr key={d.dentistId} className="border-t border-slate-200">
                    <td className="px-4 py-3 text-slate-900 font-semibold">{d.dentistName}</td>
                    <td className="px-4 py-3 text-slate-700">{d.appointments}</td>
                    <td className="px-4 py-3 text-slate-700">{d.procedures}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-4 py-3 text-slate-500" colSpan={3}>
                    No completed appointments in this range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
