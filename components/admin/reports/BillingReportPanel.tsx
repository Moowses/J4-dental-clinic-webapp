"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import ReportShell from "./ReportShell";
import { getBillingReport, getBillingReportByRange } from "@/app/actions/billing-report-actions";

import { db } from "@/lib/firebase/firebase";
import { doc, getDoc } from "firebase/firestore";
import { getUserDisplayNameByUid } from "@/lib/services/user-service";
import { normalizeBillingStatus } from "@/lib/status-normalizers";

type BillingRow = {
  id: string;
  appointmentId?: string;
  patientId?: string;
  patientName?: string;
  totalAmount: number;
  remainingBalance: number;
  status: string;
  createdAt?: string;
};

type BillingReportResponse = {
  rows: BillingRow[];
  summary: {
    totalRecords: number;
    totalBilled: number;
    totalCollected: number;
    totalOutstanding: number;
    byStatus: Record<string, number>;
  };
};

type BillingRecordDoc = {
  appointmentId?: string;
  patientId?: string;
  items?: { id: string; name: string }[];
  paymentPlan?: {
    installments?: {
      id: string;
      amount: number;
      description?: string;
      status?: string;
      paidAt?: any;
      paidMethod?: string;
      paidBy?: string;
    }[];
  };
  transactions?: {
    id?: string;
    amount: number;
    date?: any;
    method?: string;
    mode?: string;
    itemIds?: string[];
    installmentId?: string;
    recordedBy?: string;
  }[];
};

type TxnRow = {
  id: string;
  dateISO?: string;
  patientLabel: string;
  appointmentId?: string;
  description: string;
  txnType: "Procedure" | "Installment";
  method: string;
  amount: number;
  status: string;
};

type BillingInsights = {
  collectedTotal: number;
  collectedByMethod: Record<string, number>;
  collectedByType: { procedure: number; installment: number };
  topProcedures: Array<{ name: string; amount: number }>;
  openInstallments: number;
  overdueInstallments: number;
  dentistIncome: Array<{ dentistId: string; dentistName: string; collected: number; procedures: number }>;
  collectionRatePct: number;
  outstandingTotal: number;
  dentistPerformance: Array<{
    dentistId: string;
    dentistName: string;
    billed: number;
    collected: number;
    outstanding: number;
    procedures: number;
    collectionRatePct: number;
  }>;
  totalProcedures: number;
};

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

function formatDate(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

function money(n: number) {
  const num = Number(n || 0);
  return `${num.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function KpiCard({ label, value }: { label: string; value: string | number }) {
  const rawText = String(value);
  const text = rawText;
  const compact = rawText.length >= 12;
  const extraCompact = rawText.length >= 15;
  const ultraCompact = rawText.length >= 18;

  return (
    <div className="flex min-h-[88px] min-w-0 flex-col justify-between rounded-2xl border border-slate-200 bg-white p-4 text-right">
      <p className="text-xs font-bold leading-tight text-slate-500">{label}</p>
      <p
        title={rawText}
        className={[
          "mt-2 min-w-0 whitespace-nowrap font-extrabold leading-none tracking-tight text-slate-900",
          "[font-variant-numeric:tabular-nums]",
          ultraCompact
            ? "text-xs md:text-sm"
            : extraCompact
            ? "text-sm md:text-base"
            : compact
            ? "text-base md:text-lg"
            : "text-lg",
        ].join(" ")}
        style={{
          fontSize: ultraCompact
            ? "clamp(0.68rem, 0.35vw + 0.56rem, 0.86rem)"
            : extraCompact
            ? "clamp(0.82rem, 0.55vw + 0.62rem, 1rem)"
            : compact
            ? "clamp(0.9rem, 0.7vw + 0.62rem, 1.12rem)"
            : "clamp(1rem, 1vw + 0.65rem, 1.35rem)",
        }}
      >
        {text}
      </p>
    </div>
  );
}

function normalizeBillingReport(raw: any): BillingReportResponse {
  if (raw?.rows && raw?.summary) return raw as BillingReportResponse;

  const rowsCandidate = raw?.records ?? raw?.rows ?? raw?.data ?? raw ?? [];
  const rows: BillingRow[] = (Array.isArray(rowsCandidate) ? rowsCandidate : []).map((r: any) => ({
    id: String(r.id ?? r.billingId ?? r.docId ?? `${Math.random()}_${Date.now()}`),
    appointmentId: r.appointmentId ?? r.appointment_id,
    patientId: r.patientId ?? r.patient_id,
    patientName: r.patientName ?? r.patient_name,
    totalAmount: Number(r.totalAmount ?? r.total ?? r.amount ?? 0),
    remainingBalance: Number(r.remainingBalance ?? r.remaining ?? r.outstanding ?? 0),
    status: normalizeBillingStatus(String(r.status ?? r.paymentStatus ?? "unpaid")),
    createdAt: r.createdAt?.toDate?.()?.toISOString?.() ?? r.createdAt ?? r.created_at,
  }));

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

function looksLikeUid(s: string) {
  return s.length >= 20 && !s.includes(" ");
}

function shortUid(uid: string) {
  if (!uid) return "";
  return uid.length > 12 ? `${uid.slice(0, 6)}${uid.slice(-4)}` : uid;
}

async function resolvePatientLabel(
  patientId?: string,
  patientName?: string,
  cache?: Map<string, string>
) {
  if (patientName && patientName.trim() && !looksLikeUid(patientName)) return patientName;
  if (!patientId) return "";
  if (cache?.has(patientId)) return cache.get(patientId)!;

  try {
    const snap = await getDoc(doc(db, "users", patientId));
    if (snap.exists()) {
      const u: any = snap.data();
      const label =
        u.fullName ??
        u.name ??
        u.displayName ??
        u.firstName ??
        u.email ??
        shortUid(patientId);

      const out = String(label);
      cache?.set(patientId, out);
      return out;
    }
  } catch {
    // ignore
  }

  const fallback = shortUid(patientId);
  cache?.set(patientId, fallback);
  return fallback;
}

export default function BillingReportPanel() {
  const [rangeDays, setRangeDays] = useState<7 | 30 | 90 | 180 | 365>(90);
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | null>(null);
  const [fromDate, setFromDate] = useState<string>("");
  const [toDateValue, setToDateValue] = useState<string>("");
  const [data, setData] = useState<BillingReportResponse | null>(null);
  const [txns, setTxns] = useState<TxnRow[]>([]);
  const [insights, setInsights] = useState<BillingInsights | null>(null);
  const [view, setView] = useState<"transactions" | "bills">("bills");

  const [err, setErr] = useState<string | null>(null);
  const [detailsErr, setDetailsErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [pendingDetails, startDetailsTransition] = useTransition();

  const subtitle = useMemo(() => {
    if (customRange?.from && customRange?.to) {
      return `${customRange.from} to ${customRange.to}`;
    }
    return `Last ${rangeDays} days`;
  }, [rangeDays, customRange]);


  const aging = useMemo(() => {
    const buckets = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
    if (!data?.rows?.length) return buckets;
    const now = Date.now();
    for (const r of data.rows) {
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
    return buckets;
  }, [data]);

  const topOutstanding = useMemo(() => {
    if (!data?.rows?.length) return [];
    const map = new Map<string, { name: string; amount: number }>();
    for (const r of data.rows) {
      const remaining = Number(r.remainingBalance || 0);
      if (remaining <= 0) continue;
      const key = r.patientId || r.patientName || r.id;
      const name = r.patientName || r.patientId || "Unknown";
      const prev = map.get(key);
      if (!prev) map.set(key, { name, amount: remaining });
      else prev.amount += remaining;
    }
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount).slice(0, 5);
  }, [data]);

  function onPrint(nextView: "transactions" | "bills") {
    const base = "/admin-dashboard/reports/print?type=billing";
    const params = new URLSearchParams();
    if (customRange?.from && customRange?.to) {
      params.set("from", customRange.from);
      params.set("to", customRange.to);
    } else {
      params.set("range", String(rangeDays));
    }
    params.set("view", nextView);
    window.open(`${base}&${params.toString()}`, "_blank", "noopener,noreferrer");
  }

  // Load summary report + enrich rows with patientName
  useEffect(() => {
    let cancelled = false;
    setErr(null);
    setDetailsErr(null);

    startTransition(async () => {
      try {
        const raw = customRange
          ? await getBillingReportByRange({
              fromISO: `${customRange.from}T00:00:00`,
              toISO: `${customRange.to}T23:59:59`,
            })
          : await getBillingReport(rangeDays);
        const res = normalizeBillingReport(raw);

        const tooManyRows = res.rows.length > 120;
        if (tooManyRows) {
          setDetailsErr("Large dataset: patient names are abbreviated to reduce Firebase reads. Narrow the date range for full details.");
        }

        const cache = new Map<string, string>();
        const enrichedRows = tooManyRows
          ? (res.rows || []).map((r) => ({
              ...r,
              patientName:
                (r.patientName && !looksLikeUid(r.patientName) && r.patientName.trim()) ||
                (r.patientId ? shortUid(r.patientId) : ""),
            }))
          : await Promise.all(
              (res.rows || []).map(async (r) => {
                const label = await resolvePatientLabel(r.patientId, r.patientName, cache);
                return { ...r, patientName: label };
              })
            );

        if (!cancelled) setData({ ...res, rows: enrichedRows });
      } catch (e: any) {
        console.error("BillingReportPanel load error:", e);
        if (!cancelled) setErr(e?.message ?? "Failed to load billing report.");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [rangeDays, customRange]);

  // Build transaction log by fetching billing_records doc details
  useEffect(() => {
    if (view !== "transactions") {
      setTxns([]);
      setInsights(null);
      setDetailsErr(null);
      return;
    }
    if (!data?.rows?.length) {
      setTxns([]);
      setInsights(null);
      return;
    }

    let cancelled = false;
    setDetailsErr(null);
    setInsights(null);

    startDetailsTransition(async () => {
      try {
        if (data.rows.length > 120) {
          setDetailsErr(
            "Too many billing records for detailed view. Narrow the date range to load transactions."
          );
          setTxns([]);
          setInsights(null);
          return;
        }

        const cache = new Map<string, string>();
        const all: TxnRow[] = [];
        const methodTotals = new Map<string, number>();
        const procedureTotals = new Map<string, number>();
        const dentistTotals = new Map<
          string,
          { dentistId: string; billed: number; collected: number; outstanding: number; procedures: number }
        >();
        const appointmentCache = new Map<string, any>();
        let collectedTotal = 0;
        let procedureCollected = 0;
        let installmentCollected = 0;
        let openInstallments = 0;
        let overdueInstallments = 0;
        let totalProcedures = 0;

        const rowMap = new Map(data.rows.map((r) => [r.id, r]));
        const recordIds = data.rows.map((r) => r.id);
        const chunkSize = 20;
        const recordDocs: Array<{ id: string; rec: BillingRecordDoc }> = [];

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
          new Set(
            recordDocs
              .map(({ id, rec }) => rec.appointmentId ?? rowMap.get(id)?.appointmentId ?? id)
              .filter(Boolean)
          )
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
          const row = rowMap.get(recordId);
          if (!row) continue;

          const patientLabel = await resolvePatientLabel(
            rec.patientId ?? row.patientId,
            row.patientName,
            cache
          );

          const appointmentId = rec.appointmentId ?? row.appointmentId ?? recordId;
          const appointmentData = appointmentId ? appointmentCache.get(appointmentId) : null;

          const dentistId = appointmentData?.dentistId ? String(appointmentData.dentistId) : "";
          const proceduresCount = Array.isArray(appointmentData?.treatment?.procedures)
            ? appointmentData.treatment.procedures.length
            : 0;
          totalProcedures += proceduresCount;
          const items = Array.isArray(rec.items) ? rec.items : [];
          const installments = Array.isArray(rec.paymentPlan?.installments)
            ? rec.paymentPlan!.installments!
            : [];
          const transactions = Array.isArray(rec.transactions) ? rec.transactions : [];

          for (const it of items) {
            const key = String(it?.name || "Procedure");
            const prev = procedureTotals.get(key) ?? 0;
            const price = Number((it as any)?.price ?? 0);
            procedureTotals.set(key, prev + (Number.isFinite(price) ? price : 0));
          }

          for (const inst of installments) {
            const status = String(inst?.status || "").toLowerCase();
            if (status !== "paid") openInstallments += 1;
            if (status === "overdue") overdueInstallments += 1;
          }

          let appointmentCollected = 0;
          for (const t of transactions) {
            const mode = String(t.mode ?? "").toLowerCase();
            const dateISO = toDate(t.date)?.toISOString?.();
            const amount = Number(t.amount ?? 0);
            const safeAmount = Number.isFinite(amount) ? amount : 0;
            collectedTotal += safeAmount;
            appointmentCollected += safeAmount;
            const method = String(t.method ?? "unknown").toLowerCase();
            methodTotals.set(method, (methodTotals.get(method) ?? 0) + safeAmount);

            if (mode === "installment" || mode === "installment_full") {
              const inst = installments.find((x) => x.id === t.installmentId);
              const baseDesc = String(inst?.description || "").trim();
              const baseName = baseDesc
                ? baseDesc.split("•")[0].trim()
                : "Installment";
              installmentCollected += safeAmount;
              all.push({
                id: t.id ?? `${recordId}_${t.installmentId ?? "installment"}_${dateISO ?? ""}`,
                dateISO,
                patientLabel,
                appointmentId,
                description:
                  mode === "installment_full"
                    ? `${baseName} - Installment Full Pay`
                    : inst?.description ?? "Installment Payment",
                txnType: "Installment",
                method: t.method ?? inst?.paidMethod ?? "",
                amount: safeAmount,
                status: String(inst?.status ?? "paid"),
              });
            } else {
              const paidFor =
                (t.itemIds ?? [])
                  .map((id) => items.find((it) => it.id === id)?.name)
                  .filter(Boolean) as string[];

              const description =
                paidFor.length > 0
                  ? paidFor.join(", ")
                  : items.length
                  ? items.map((it) => it.name).join(", ")
                  : "Procedure Payment";

              all.push({
                id: t.id ?? `${recordId}_${(t.itemIds?.[0] ?? "item")}_${dateISO ?? ""}`,
                dateISO,
                patientLabel,
                appointmentId,
                description,
                txnType: "Procedure",
                method: t.method ?? "",
                amount: safeAmount,
                status: "paid",
              });
              procedureCollected += safeAmount;
            }
          }

          if (dentistId) {
            const prev = dentistTotals.get(dentistId) ?? {
              dentistId,
              billed: 0,
              collected: 0,
              outstanding: 0,
              procedures: 0,
            };
            prev.billed += Number(row.totalAmount || 0);
            prev.collected += appointmentCollected;
            prev.outstanding += Number(row.remainingBalance || 0);
            prev.procedures += proceduresCount;
            dentistTotals.set(dentistId, prev);
          }
        }

        all.sort(
          (a, b) =>
            (b.dateISO ? new Date(b.dateISO).getTime() : 0) -
            (a.dateISO ? new Date(a.dateISO).getTime() : 0)
        );

        if (!cancelled) {
          const topProcedures = Array.from(procedureTotals.entries())
            .map(([name, amount]) => ({ name, amount }))
            .sort((a, b) => b.amount - a.amount)
            .slice(0, 6);

          const dentistIncome = await Promise.all(
            Array.from(dentistTotals.values()).map(async (d) => {
              const name =
                (await getUserDisplayNameByUid(d.dentistId)) ||
                (d.dentistId.length > 10 ? `${d.dentistId.slice(0, 6)}` : d.dentistId);
              return { ...d, dentistName: name };
            })
          );
          const billedTotal = data.rows.reduce((sum, r) => sum + Number(r.totalAmount || 0), 0);
          const outstandingTotal = data.rows.reduce((sum, r) => sum + Number(r.remainingBalance || 0), 0);
          const collectionRatePct = billedTotal > 0 ? (collectedTotal / billedTotal) * 100 : 0;
          const dentistPerformance = dentistIncome.map((d) => {
            const raw = dentistTotals.get(d.dentistId);
            const billed = Number(raw?.billed || 0);
            const outstanding = Number(raw?.outstanding || 0);
            return {
              dentistId: d.dentistId,
              dentistName: d.dentistName,
              billed,
              collected: d.collected,
              outstanding,
              procedures: d.procedures,
              collectionRatePct: billed > 0 ? (d.collected / billed) * 100 : 0,
            };
          });

          setTxns(all);
          setInsights({
            collectedTotal,
            collectedByMethod: Object.fromEntries(methodTotals),
            collectedByType: { procedure: procedureCollected, installment: installmentCollected },
            topProcedures,
            openInstallments,
            overdueInstallments,
            dentistIncome: dentistIncome.sort(
              (a, b) => b.collected - a.collected || b.procedures - a.procedures
            ),
            collectionRatePct,
            outstandingTotal,
            dentistPerformance: dentistPerformance.sort(
              (a, b) => b.billed - a.billed || b.collected - a.collected
            ),
            totalProcedures,
          });
        }
      } catch (e: any) {
        console.error("BillingReportPanel details error:", e);
        if (!cancelled) setDetailsErr(e?.message ?? "Failed to load transaction details.");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [data, view]);

  const empty =
    !data || data.rows.length === 0
      ? {
          title: !data || pending ? "Loading report" : "No billing records found",
          description: pending
            ? "Please wait while we generate the report."
            : !data
            ? "Loading the default date range."
            : "Try expanding the date range.",
        }
      : undefined;

  if (err) {
    return (
      <ReportShell
        reportName="Billing & Collections Report"
        subtitle={subtitle}
        empty={{ title: "Error loading report", description: err }}
      >
        <div />
      </ReportShell>
    );
  }

  const txnsLimited = txns.slice(0, 200);
  const rowsLimited = data?.rows?.slice(0, 200) ?? [];
  const txnsTruncated = txns.length > txnsLimited.length;
  const rowsTruncated = (data?.rows?.length || 0) > rowsLimited.length;

  return (
    <ReportShell reportName="Billing & Collections Report" subtitle={subtitle} empty={empty}>
      {!data ? null : (
        <div className="space-y-4">
          {/* controls (screen only) */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-slate-700">Range:</span>
              {[7, 30, 90, 180, 365].map((d) => (
                <button
                  key={d}
                  onClick={() => setRangeDays(d as any)}
                  className={[
                    "rounded-full px-3 py-1.5 text-sm font-semibold transition",
                    rangeDays === d
                      ? "bg-slate-900 text-white"
                      : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                  ].join(" ")}
                >
                  {d === 90 ? "3m" : d === 180 ? "6m" : d === 365 ? "12m" : `${d}d`}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-700">View:</span>
              <button
                onClick={() => setView("transactions")}
                className={[
                  "rounded-full px-3 py-1.5 text-sm font-semibold transition",
                  view === "transactions"
                    ? "bg-slate-900 text-white"
                    : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                ].join(" ")}
              >
                Transactions
              </button>
              <button
                onClick={() => setView("bills")}
                className={[
                  "rounded-full px-3 py-1.5 text-sm font-semibold transition",
                  view === "bills"
                    ? "bg-slate-900 text-white"
                    : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                ].join(" ")}
              >
                Bills
              </button>

              <div className="ml-2 inline-flex items-center rounded-full border border-slate-200 overflow-hidden">
                <button
                  onClick={() => onPrint("transactions")}
                  className="px-4 py-1.5 text-sm font-extrabold bg-slate-900 text-white hover:bg-slate-800"
                >
                  Print Transactions
                </button>
                <button
                  onClick={() => onPrint("bills")}
                  className="px-4 py-1.5 text-sm font-extrabold bg-white text-slate-700 hover:bg-slate-50 border-l border-slate-200"
                >
                  Print Bills
                </button>
              </div>
            </div>
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
                value={toDateValue}
                onChange={(e) => setToDateValue(e.target.value)}
                className="mt-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              />
            </div>
            <button
              onClick={() => {
                if (fromDate && toDateValue) {
                  setCustomRange({ from: fromDate, to: toDateValue });
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
                setToDateValue("");
              }}
              className="rounded-full px-4 py-2 text-sm font-extrabold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            >
              Clear
            </button>
          </div>

          {pending ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              Generating report...
            </div>
          ) : null}

          {insights ? (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-4 xl:grid-cols-6">
                <KpiCard label="Collected Total" value={money(insights.collectedTotal)} />
                <KpiCard label="Procedure Collected" value={money(insights.collectedByType.procedure)} />
                <KpiCard label="Installment Collected" value={money(insights.collectedByType.installment)} />
                <KpiCard label="Collection Rate" value={`${insights.collectionRatePct.toFixed(1)}%`} />
                <KpiCard label="Outstanding Total" value={money(insights.outstandingTotal)} />
                <KpiCard label="Open Installments" value={insights.openInstallments} />
                <KpiCard label="Overdue Installments" value={insights.overdueInstallments} />
                <KpiCard label="Procedures (completed)" value={insights.totalProcedures} />
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="text-sm font-extrabold text-slate-900">Payment Methods</p>
                  <div className="mt-2 space-y-1 text-sm">
                    {Object.entries(insights.collectedByMethod)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 6)
                      .map(([method, total]) => (
                        <div key={method} className="flex items-center justify-between text-slate-700">
                          <span className="uppercase">{method || "unknown"}</span>
                          <span className="font-extrabold">{money(total)}</span>
                        </div>
                      ))}
                    {Object.keys(insights.collectedByMethod).length === 0 ? (
                      <p className="text-xs text-slate-500">No payments recorded.</p>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="text-sm font-extrabold text-slate-900">Top Procedures (Billed)</p>
                  <div className="mt-2 space-y-1 text-sm">
                    {insights.topProcedures.length ? (
                      insights.topProcedures.map((p) => (
                        <div key={p.name} className="flex items-center justify-between text-slate-700">
                          <span className="truncate">{p.name}</span>
                          <span className="font-extrabold">{money(p.amount)}</span>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-slate-500">No procedures billed.</p>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="text-sm font-extrabold text-slate-900">Outstanding Aging</p>
                  <div className="mt-2 space-y-1 text-sm text-slate-700">
                    <div className="flex items-center justify-between">
                      <span>0-30 days</span>
                      <span className="font-extrabold">{money(aging["0-30"])}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>31-60 days</span>
                      <span className="font-extrabold">{money(aging["31-60"])}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>61-90 days</span>
                      <span className="font-extrabold">{money(aging["61-90"])}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>90+ days</span>
                      <span className="font-extrabold">{money(aging["90+"])}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-sm font-extrabold text-slate-900">Top Outstanding Patients</p>
                <div className="mt-2 space-y-1 text-sm">
                  {topOutstanding.length ? (
                    topOutstanding.map((p) => (
                      <div key={p.name} className="flex items-center justify-between text-slate-700">
                        <span className="truncate">{p.name}</span>
                        <span className="font-extrabold">{money(p.amount)}</span>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-slate-500">No outstanding balances.</p>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-sm font-extrabold text-slate-900">Dentist Income</p>
                <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-200">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50">
                      <tr className="text-left text-slate-600">
                        <th className="px-4 py-3 font-bold">Dentist</th>
                        <th className="px-4 py-3 font-bold">Collected</th>
                        <th className="px-4 py-3 font-bold">Procedures</th>
                      </tr>
                    </thead>
                    <tbody>
                      {insights.dentistIncome.length ? (
                        insights.dentistIncome.map((d) => (
                          <tr key={d.dentistId} className="border-t border-slate-200">
                            <td className="px-4 py-3 font-semibold text-slate-900">{d.dentistName}</td>
                            <td className="px-4 py-3 text-slate-700">{money(d.collected)}</td>
                            <td className="px-4 py-3 text-slate-700">{d.procedures}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td className="px-4 py-3 text-slate-500" colSpan={3}>
                            No dentist income data.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-sm font-extrabold text-slate-900">Dentist Production vs Collections</p>
                <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-200">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50">
                      <tr className="text-left text-slate-600">
                        <th className="px-4 py-3 font-bold">Dentist</th>
                        <th className="px-4 py-3 font-bold">Billed</th>
                        <th className="px-4 py-3 font-bold">Collected</th>
                        <th className="px-4 py-3 font-bold">Outstanding</th>
                        <th className="px-4 py-3 font-bold">Collection Rate</th>
                        <th className="px-4 py-3 font-bold">Procedures</th>
                      </tr>
                    </thead>
                    <tbody>
                      {insights.dentistPerformance.length ? (
                        insights.dentistPerformance.map((d) => (
                          <tr key={`${d.dentistId}-perf`} className="border-t border-slate-200">
                            <td className="px-4 py-3 font-semibold text-slate-900">{d.dentistName}</td>
                            <td className="px-4 py-3 text-slate-700">{money(d.billed)}</td>
                            <td className="px-4 py-3 text-slate-700">{money(d.collected)}</td>
                            <td className="px-4 py-3 text-slate-700">{money(d.outstanding)}</td>
                            <td className="px-4 py-3 text-slate-700">{d.collectionRatePct.toFixed(1)}%</td>
                            <td className="px-4 py-3 text-slate-700">{d.procedures}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td className="px-4 py-3 text-slate-500" colSpan={6}>
                            No dentist production data.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : null}

          {detailsErr ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              <p className="font-bold">Transactions view is limited</p>
              <p className="mt-1">{detailsErr}</p>
            </div>
          ) : null}

          {view === "transactions" ? (
            <div className="overflow-x-auto rounded-2xl border border-slate-200">
              {txnsTruncated ? (
                <div className="px-4 py-3 text-xs text-amber-700 bg-amber-50 border-b border-amber-200">
                  Showing first {txnsLimited.length} transactions. Narrow the date range to see more.
                </div>
              ) : null}
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50">
                  <tr className="text-left text-slate-600">
                    <th className="px-4 py-3 font-bold">Date</th>
                    <th className="px-4 py-3 font-bold">Patient</th>
                    <th className="px-4 py-3 font-bold">Procedure / Description</th>
                    <th className="px-4 py-3 font-bold">Type</th>
                    <th className="px-4 py-3 font-bold">Method</th>
                    <th className="px-4 py-3 font-bold">Amount</th>
                    <th className="px-4 py-3 font-bold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {txnsLimited.map((t) => (
                    <tr key={t.id} className="border-t border-slate-200">
                      <td className="px-4 py-3 text-slate-700">{formatDate(t.dateISO)}</td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900">{t.patientLabel}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-900 font-semibold">{t.description}</td>
                      <td className="px-4 py-3 text-slate-700">{t.txnType}</td>
                      <td className="px-4 py-3 text-slate-700">{t.method}</td>
                      <td className="px-4 py-3 text-slate-700">{money(t.amount)}</td>
                      <td className="px-4 py-3">
                        <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-bold text-slate-700">
                          {t.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200">
              {rowsTruncated ? (
                <div className="px-4 py-3 text-xs text-amber-700 bg-amber-50 border-b border-amber-200">
                  Showing first {rowsLimited.length} bills. Narrow the date range to see more.
                </div>
              ) : null}
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50">
                  <tr className="text-left text-slate-600">
                    <th className="px-4 py-3 font-bold">Date</th>
                    <th className="px-4 py-3 font-bold">Patient</th>
                    <th className="px-4 py-3 font-bold">Status</th>
                    <th className="px-4 py-3 font-bold">Total</th>
                    <th className="px-4 py-3 font-bold">Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {rowsLimited.map((r) => (
                    <tr key={r.id} className="border-t border-slate-200">
                      <td className="px-4 py-3 text-slate-700">{formatDate(r.createdAt)}</td>
                      <td className="px-4 py-3 text-slate-900 font-semibold">
                        {r.patientName ?? ""}
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-bold text-slate-700">
                          {r.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{money(r.totalAmount)}</td>
                      <td className="px-4 py-3 text-slate-700">{money(r.remainingBalance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </ReportShell>
  );
}

