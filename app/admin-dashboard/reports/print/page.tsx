"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase/firebase";
import { onAuthStateChanged } from "firebase/auth";
import {
  getBillingReport,
  getBillingReportByRange,
} from "@/app/actions/billing-report-actions";
import { getAppointmentsInRange } from "@/app/actions/appointment-actions";
import { getInventoryReport } from "@/app/actions/inventory-actions";
import { getUserDisplayNameByUid } from "@/lib/services/user-service";
import { isNoShowAppointmentStatus, normalizeBillingStatus } from "@/lib/status-normalizers";

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
};

type AppointmentRow = {
  id: string;
  startAt: string;
  status?: string;
  dentistId?: string | null;
  proceduresCount?: number;
};

type InventoryRow = {
  id: string;
  name: string;
  itemCode?: string;
  category?: string;
  qtyOnHand: number;
  reorderLevel?: number;
  unit?: string;
  expirationDate?: string;
  updatedAt?: string;
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
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function money(n: number) {
  const num = Number(n || 0);
  return `₱${num.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function normalizeBillingReport(raw: any): BillingReportResponse {
  if (raw?.rows) return raw as BillingReportResponse;
  const rowsCandidate = raw?.records ?? raw?.rows ?? raw?.data ?? raw ?? [];
  const rows: BillingRow[] = (Array.isArray(rowsCandidate) ? rowsCandidate : []).map((r: any) => ({
    id: String(r.id ?? r.billingId ?? r.docId ?? `${Math.random()}_${Date.now()}`),
    appointmentId: r.appointmentId ?? r.appointment_id,
    patientId: r.patientId ?? r.patient_id,
    patientName: r.patientName ?? r.patient_name,
    totalAmount: Number(r.totalAmount ?? r.total ?? r.amount ?? 0),
    remainingBalance: Number(r.remainingBalance ?? r.remaining ?? r.outstanding ?? 0),
    status: String(r.status ?? r.paymentStatus ?? "unpaid"),
    createdAt: r.createdAt?.toDate?.()?.toISOString?.() ?? r.createdAt ?? r.created_at,
  }));
  return { rows };
}

async function resolvePatientName(id?: string, fallback?: string) {
  if (fallback && fallback.trim() && fallback.length < 40 && !/^[A-Za-z0-9_-]{20,}$/.test(fallback)) {
    return fallback;
  }
  if (!id) return fallback || "";
  try {
    const snap = await getDoc(doc(db, "users", id));
    if (snap.exists()) {
      const u: any = snap.data();
      return (
        u.fullName ??
        u.name ??
        u.displayName ??
        u.firstName ??
        u.email ??
        fallback ??
        ""
      );
    }
  } catch {
    // ignore
  }
  return fallback || id;
}

function statusChip(status: string) {
  const s = normalizeBillingStatus(status);
  if (s === "paid") return { label: "Paid", cls: "chip chip-paid" };
  if (s === "partial") return { label: "Partial", cls: "chip chip-partial" };
  if (s === "unpaid") return { label: "Unpaid", cls: "chip chip-unpaid" };
  return { label: status || "—", cls: "chip" };
}

function ReportsPrintPageInner() {
  const params = useSearchParams();
  const type = (params.get("type") || "billing").toLowerCase();
  const view = (params.get("view") || "transactions").toLowerCase();
  const from = params.get("from");
  const to = params.get("to");
  const range = params.get("range");

  const subtitle = useMemo(() => {
    if (from && to) return `${from} to ${to}`;
    if (range) return `Last ${range} days`;
    return "Last 30 days";
  }, [from, to, range]);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [printedAt, setPrintedAt] = useState<string>("");
  const [preparedBy, setPreparedBy] = useState<string>("");
  const [billingRows, setBillingRows] = useState<BillingRow[]>([]);
  const [billingTxns, setBillingTxns] = useState<TxnRow[]>([]);
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [inventoryRows, setInventoryRows] = useState<InventoryRow[]>([]);
  const [printed, setPrinted] = useState(false);

  useEffect(() => {
    let active = true;
    const unsub = onAuthStateChanged(auth, (user) => {
      setAuthed(!!user);
      if (!user) {
        if (active) setPreparedBy("");
        setAuthReady(true);
        return;
      }

      const fallbackName =
        user.displayName?.trim() ||
        user.email?.trim() ||
        (user.uid.length > 10 ? `${user.uid.slice(0, 6)}...` : user.uid);
      if (active) setPreparedBy(fallbackName);
      setAuthReady(true);

      void (async () => {
        try {
          const resolved = await getUserDisplayNameByUid(user.uid);
          if (active && resolved?.trim()) setPreparedBy(resolved.trim());
        } catch {
          // keep fallback
        }
      })();
    });
    return () => {
      active = false;
      unsub();
    };
  }, []);

  useEffect(() => {
    setPrintedAt(new Date().toLocaleString());
  }, []);

  useEffect(() => {
    document.body.classList.add("print-report");
    return () => {
      document.body.classList.remove("print-report");
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);

    (async () => {
      try {
        if (!authReady) return;
        if (!authed) {
          setErr("Not authenticated");
          return;
        }

        if (type === "billing") {
          const raw =
            from && to
              ? await getBillingReportByRange({
                  fromISO: `${from}T00:00:00`,
                  toISO: `${to}T23:59:59`,
                })
              : await getBillingReport(Number(range || 30));

          const res = normalizeBillingReport(raw);
          if (cancelled) return;

          const enrichedRows = await Promise.all(
            (res.rows || []).map(async (r) => ({
              ...r,
              patientName: await resolvePatientName(r.patientId, r.patientName),
            }))
          );
          setBillingRows(enrichedRows || []);

          if (view === "transactions") {
            const all: TxnRow[] = [];

            for (const row of enrichedRows || []) {
              const snap = await getDoc(doc(db, "billing_records", row.id));
              if (!snap.exists()) continue;

              const rec: any = snap.data();
              const items = Array.isArray(rec.items) ? rec.items : [];
              const installments = Array.isArray(rec.paymentPlan?.installments)
                ? rec.paymentPlan!.installments!
                : [];
              const transactions = Array.isArray(rec.transactions) ? rec.transactions : [];

              for (const t of transactions) {
                const mode = String(t.mode ?? "").toLowerCase();
                const dateISO = toDate(t.date)?.toISOString?.();
                const patientLabel = row.patientName || row.patientId || "—";

                if (mode === "installment" || mode === "installment_full") {
                  const inst = installments.find((x: any) => x.id === t.installmentId);
                  const baseDesc = String(inst?.description || "").trim();
                  const baseName = baseDesc ? baseDesc.split("•")[0].trim() : "Installment";
                  all.push({
                    id: t.id ?? `${row.id}_${t.installmentId ?? "installment"}_${dateISO ?? ""}`,
                    dateISO,
                    patientLabel,
                    appointmentId: rec.appointmentId ?? row.appointmentId,
                    description:
                      mode === "installment_full"
                        ? `${baseName} - Installment Full Pay`
                        : inst?.description ?? "Installment Payment",
                    txnType: "Installment",
                    method: t.method ?? inst?.paidMethod ?? "—",
                    amount: Number(t.amount ?? 0),
                    status: String(inst?.status ?? "paid"),
                  });
                } else {
                  const paidFor =
                    (t.itemIds ?? [])
                      .map((id: string) => items.find((it: any) => it.id === id)?.name)
                      .filter(Boolean) as string[];

                  const description =
                    paidFor.length > 0
                      ? paidFor.join(", ")
                      : items.length
                      ? items.map((it: any) => it.name).join(", ")
                      : "Procedure Payment";

                  all.push({
                    id: t.id ?? `${row.id}_${(t.itemIds?.[0] ?? "item")}_${dateISO ?? ""}`,
                    dateISO,
                    patientLabel,
                    appointmentId: rec.appointmentId ?? row.appointmentId,
                    description,
                    txnType: "Procedure",
                    method: t.method ?? "—",
                    amount: Number(t.amount ?? 0),
                    status: "paid",
                  });
                }
              }
            }

            all.sort(
              (a, b) =>
                (b.dateISO ? new Date(b.dateISO).getTime() : 0) -
                (a.dateISO ? new Date(a.dateISO).getTime() : 0)
            );
            if (!cancelled) setBillingTxns(all);
          }
        } else if (type === "appointments") {
          let fromISO: string;
          let toISO: string;
          if (from && to) {
            fromISO = `${from}T00:00:00`;
            toISO = `${to}T23:59:59`;
          } else {
            const safeRangeDays = Math.max(1, Number(range || 30) || 30);
            const end = new Date();
            end.setHours(23, 59, 59, 999);
            const start = new Date(end);
            start.setDate(end.getDate() - (safeRangeDays - 1));
            start.setHours(0, 0, 0, 0);
            fromISO = start.toISOString();
            toISO = end.toISOString();
          }
          const res = (await getAppointmentsInRange({ fromISO, toISO })) as { rows: AppointmentRow[] };
          if (!cancelled) setAppointments(res?.rows || []);
        } else if (type === "inventory") {
          const res = (await getInventoryReport()) as { rows: InventoryRow[] };
          if (!cancelled) setInventoryRows(res?.rows || []);
        }
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Failed to load report.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [type, view, from, to, range, authReady, authed]);

  const readyForPrint = useMemo(() => {
    if (loading || err) return false;
    if (type === "billing") {
      return view === "transactions"
        ? billingTxns.length > 0 || billingRows.length > 0
        : billingRows.length > 0;
    }
    if (type === "appointments") return appointments.length > 0;
    if (type === "inventory") return inventoryRows.length > 0;
    return false;
  }, [loading, err, type, view, billingTxns.length, billingRows.length, appointments.length, inventoryRows.length]);

  useEffect(() => {
    if (!readyForPrint || printed) return undefined;
    const t = setTimeout(() => {
      window.print();
      setPrinted(true);
    }, 250);
    return () => clearTimeout(t);
  }, [readyForPrint, printed]);

  const title =
    type === "billing"
      ? view === "transactions"
        ? "Billing Transactions Report"
        : "Billing & Collections Report"
      : type === "appointments"
      ? "Appointment Summary Report"
      : "Inventory Report";

  const apptDaily = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of appointments) {
      const d = new Date(r.startAt);
      if (Number.isNaN(d.getTime())) continue;
      const key = d.toISOString().slice(0, 10);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .map(([day, count]) => ({ day, count }))
      .sort((a, b) => a.day.localeCompare(b.day));
  }, [appointments]);

  const apptTotals = useMemo(() => {
    const total = appointments.length;
    const cancelled = appointments.filter((a) => String(a.status || "").toLowerCase() === "cancelled").length;
    const noShow = appointments.filter((a) => isNoShowAppointmentStatus(a.status)).length;
    const procedures = appointments.reduce((sum, r) => {
      const status = String(r.status || "").toLowerCase();
      if (status !== "completed") return sum;
      return sum + Number(r.proceduresCount || 0);
    }, 0);
    return { total, cancelled, noShow, procedures };
  }, [appointments]);

  const [dentistStats, setDentistStats] = useState<
    Array<{ dentistId: string; dentistName: string; appointments: number; procedures: number }>
  >([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const map = new Map<string, { dentistId: string; appointments: number; procedures: number }>();
      for (const r of appointments) {
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

      if (!cancelled) setDentistStats(named);
    })();
    return () => {
      cancelled = true;
    };
  }, [appointments]);

  const billingTotals = useMemo(() => {
    const total = billingRows.reduce((sum, r) => sum + Number(r.totalAmount || 0), 0);
    const outstanding = billingRows.reduce((sum, r) => sum + Number(r.remainingBalance || 0), 0);
    const collected = total - outstanding;
    return { total, outstanding, collected };
  }, [billingRows]);

  return (
    <div className="min-h-screen bg-white text-black hide-chatbot">
      <style jsx global>{`
        @media print {
          @page {
            margin: 14mm;
          }
          body {
            color: #0f172a;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .no-print {
            display: none !important;
          }
          .avoid-break {
            break-inside: avoid;
            page-break-inside: avoid;
          }
        }

        * {
          box-sizing: border-box;
        }

        .paper {
          max-width: 920px;
          margin: 0 auto;
          padding: 20px 24px;
        }

        body.print-report .fixed.bottom-5.right-5.z-50,
        .hide-chatbot .fixed.bottom-5.right-5.z-50 {
          display: none !important;
        }

        .header {
          display: grid;
          grid-template-columns: 1fr;
          gap: 10px;
          margin-bottom: 12px;
        }

        .header-top {
          display: grid;
          grid-template-columns: 220px 1fr 220px;
          align-items: center;
          gap: 12px;
        }

        .clinic {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .logo {
          width: 56px;
          height: 56px;
          object-fit: contain;
        }

        .clinic-name {
          font-weight: 800;
          font-size: 14px;
          line-height: 1.1;
        }

        .clinic-address {
          font-size: 10.5px;
          color: #475569;
          margin-top: 3px;
          line-height: 1.25;
        }

        .title-wrap {
          text-align: center;
        }

        .report-title {
          font-size: 18px;
          font-weight: 900;
          letter-spacing: 0.2px;
          margin: 0;
        }

        .report-subtitle {
          font-size: 11px;
          color: #64748b;
          margin-top: 4px;
        }

        .header-meta {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          font-size: 11px;
          color: #334155;
          margin-top: 6px;
          padding-top: 8px;
          border-top: 1px solid #e2e8f0;
        }

        .meta-item b {
          color: #0f172a;
        }

        .summary {
          margin-top: 10px;
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
        }

        .summary-card {
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: 10px 12px;
          background: #ffffff;
        }

        .summary-label {
          font-size: 10.5px;
          color: #64748b;
        }
        .summary-value {
          margin-top: 4px;
          font-weight: 800;
          font-size: 13px;
          color: #0f172a;
        }

        table {
          width: 100%;
          border-collapse: collapse;
        }

        thead th {
          background: #f8fafc;
          color: #0f172a;
          font-size: 11px;
          font-weight: 800;
          border-bottom: 1px solid #e2e8f0;
          padding: 9px 10px;
          text-transform: none;
          white-space: nowrap;
        }

        tbody td {
          border-bottom: 1px solid #eef2f7;
          padding: 8px 10px;
          font-size: 11px;
          color: #0f172a;
          vertical-align: top;
        }

        tbody tr:nth-child(even) td {
          background: #fbfdff;
        }

        .num {
          text-align: right;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }

        .muted {
          color: #64748b;
        }

        .chip {
          display: inline-flex;
          align-items: center;
          border-radius: 999px;
          padding: 3px 8px;
          font-size: 10.5px;
          font-weight: 700;
          border: 1px solid #e2e8f0;
          background: #f8fafc;
          color: #334155;
          white-space: nowrap;
        }
        .chip-paid {
          background: #ecfdf5;
          border-color: #a7f3d0;
          color: #047857;
        }
        .chip-unpaid {
          background: #fff1f2;
          border-color: #fecdd3;
          color: #be123c;
        }
        .chip-partial {
          background: #fffbeb;
          border-color: #fde68a;
          color: #b45309;
        }

        .footer {
          position: fixed;
          bottom: 8mm;
          left: 0;
          right: 0;
          font-size: 11px;
          color: #64748b;
          padding: 0 14mm;
          display: flex;
          justify-content: flex-end;
          align-items: center;
          gap: 20px;
        }

        .footer > div:first-child {
          display: none;
        }

        .pagecount::after {
          content: "Page " counter(page);
        }
      `}</style>

      <div className="paper">
        {/* Header */}
        <div className="header avoid-break">
          <div className="header-top">
            {/* LEFT: Logo + Clinic info */}
            <div className="clinic">
              <img className="logo" src="/dclogo.png" alt="J4 Dental Clinic logo" />
              <div>
                <div className="clinic-name">J4 Dental Clinic</div>
                <div className="clinic-address">
                  Pereyras compound, Barangay Magugpo West, Tagum City.
                  <br />
                  Tel. No. (084) 655-8888 | Mobile No. 0917-712-3456
                </div>
              </div>
            </div>

            {/* CENTER: Title */}
                <div className="title-wrap">
                  <h1 className="report-title">{title}</h1>
                </div>

            {/* RIGHT: small meta block */}
            <div style={{ textAlign: "right" }}>
              <div className="muted" style={{ marginTop: 6, fontSize: 10.5 }}>
                Internal report
              </div>
            </div>
          </div>

          {/* Meta row */}
          <div className="header-meta">
            <div className="meta-item">
              <b>Date range:</b> {subtitle}
            </div>
            <div className="meta-item">
              <b>Type:</b> {type}
              {type === "billing" ? ` / ${view}` : ""}
            </div>
          </div>

          {/* Optional billing summary (collections view only) */}
          {type === "billing" && view !== "transactions" && !loading && !err ? (
            <div className="summary">
              <div className="summary-card">
                <div className="summary-label">Total billed</div>
                <div className="summary-value">{money(billingTotals.total)}</div>
              </div>
              <div className="summary-card">
                <div className="summary-label">Collected</div>
                <div className="summary-value">{money(billingTotals.collected)}</div>
              </div>
              <div className="summary-card">
                <div className="summary-label">Outstanding</div>
                <div className="summary-value">{money(billingTotals.outstanding)}</div>
              </div>
            </div>
          ) : null}
        </div>

        {/* Content */}
        {loading ? (
          <div style={{ fontSize: 12 }}>Loading…</div>
        ) : err ? (
          <div style={{ fontSize: 12, color: "#dc2626" }}>{err}</div>
        ) : type === "billing" ? (
          view === "transactions" ? (
            <table>
              <thead>
                <tr>
                  <th style={{ width: 60 }}>#</th>
                  <th style={{ width: 110 }}>Date</th>
                  <th style={{ width: 220 }}>Patient</th>
                  <th>Procedure / Description</th>
                  <th style={{ width: 100 }}>Type</th>
                  <th style={{ width: 110 }}>Method</th>
                  <th style={{ width: 120 }} className="num">
                    Amount
                  </th>
                  <th style={{ width: 110 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {billingTxns.map((t, idx) => {
                  const chip = statusChip(t.status);
                  return (
                    <tr key={t.id}>
                      <td className="muted">{idx + 1}</td>
                      <td>{formatDate(t.dateISO)}</td>
                      <td>{t.patientLabel}</td>
                      <td>{t.description}</td>
                      <td>{t.txnType}</td>
                      <td>{t.method}</td>
                      <td className="num">{money(t.amount)}</td>
                      <td>
                        <span className={chip.cls}>{chip.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <table>
              <thead>
                <tr>
                  <th style={{ width: 60 }}>#</th>
                  <th style={{ width: 110 }}>Date</th>
                  <th style={{ width: 240 }}>Patient</th>
                  <th style={{ width: 110 }}>Status</th>
                  <th style={{ width: 130 }} className="num">
                    Total
                  </th>
                  <th style={{ width: 130 }} className="num">
                    Outstanding
                  </th>
                </tr>
              </thead>
              <tbody>
                {billingRows.map((r, idx) => {
                  const chip = statusChip(r.status);
                  return (
                    <tr key={r.id}>
                      <td className="muted">{idx + 1}</td>
                      <td>{formatDate(r.createdAt)}</td>
                      <td>{r.patientName || r.patientId || "—"}</td>
                      <td>
                        <span className={chip.cls}>{chip.label}</span>
                      </td>
                      <td className="num">{money(r.totalAmount)}</td>
                      <td className="num">{money(r.remainingBalance)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        ) : type === "appointments" ? (
          <div style={{ display: "grid", gap: 14 }}>
            <div
              className="avoid-break"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4,1fr)",
                gap: 10,
                border: "1px solid #e2e8f0",
                borderRadius: 12,
                padding: 12,
              }}
            >
              <div>
                <div className="muted" style={{ fontSize: 10.5 }}>
                  Total appointments
                </div>
                <div style={{ fontWeight: 900 }}>{apptTotals.total}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 10.5 }}>
                  Cancellations
                </div>
                <div style={{ fontWeight: 900 }}>{apptTotals.cancelled}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 10.5 }}>
                  No-shows
                </div>
                <div style={{ fontWeight: 900 }}>{apptTotals.noShow}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 10.5 }}>
                  Procedures (completed)
                </div>
                <div style={{ fontWeight: 900 }}>{apptTotals.procedures}</div>
              </div>
            </div>

            {dentistStats.length ? (
              <table className="avoid-break">
                <thead>
                  <tr>
                    <th>Dentist</th>
                    <th style={{ width: 160 }} className="num">
                      Completed appts
                    </th>
                    <th style={{ width: 140 }} className="num">
                      Procedures
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {dentistStats.map((d) => (
                    <tr key={d.dentistId}>
                      <td>{d.dentistName}</td>
                      <td className="num">{d.appointments}</td>
                      <td className="num">{d.procedures}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}

            <table className="avoid-break" style={{ tableLayout: "fixed" }}>
              <thead>
                <tr>
                  <th style={{ width: "72%", textAlign: "left" }}>Date</th>
                  <th style={{ width: "28%" }} className="num">
                    Appointments
                  </th>
                </tr>
              </thead>
              <tbody>
                {apptDaily.map((d) => (
                  <tr key={d.day}>
                    <td style={{ textAlign: "left" }}>{d.day}</td>
                    <td className="num">{d.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 120 }}>Item ID</th>
                <th>Item Name</th>
                <th style={{ width: 140 }}>Category</th>
                <th style={{ width: 120 }} className="num">
                  Stock Qty
                </th>
                <th style={{ width: 120 }}>Unit</th>
                <th style={{ width: 130 }}>Status</th>
                <th style={{ width: 140 }}>Expiry Date</th>
              </tr>
            </thead>
            <tbody>
              {inventoryRows.map((r) => {
                const low =
                  typeof r.reorderLevel === "number" && r.qtyOnHand <= r.reorderLevel;
                const oos = r.qtyOnHand <= 0;
                const status = oos ? "Out of stock" : low ? "Low stock" : "In stock";
                return (
                  <tr key={r.id}>
                    <td>{r.itemCode || "—"}</td>
                    <td>{r.name}</td>
                    <td>{r.category || "—"}</td>
                    <td className="num">{r.qtyOnHand}</td>
                    <td>{r.unit || "—"}</td>
                    <td>{status}</td>
                    <td>{r.expirationDate || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* Print footer */}
        <div className="footer">
          <div>J4 Dental Clinic • Admin Dashboard</div>
          <div>
            Prepared by: <b>{preparedBy || "Unknown user"}</b>
          </div>
          <div className="pagecount" />
        </div>

        {/* optional button when not printing */}
        <div className="no-print" style={{ marginTop: 14 }}>
          <button
            onClick={() => window.print()}
            style={{
              border: "1px solid #e2e8f0",
              borderRadius: 10,
              padding: "8px 12px",
              fontSize: 12,
              background: "#fff",
              cursor: "pointer",
            }}
          >
            Print
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ReportsPrintPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-white text-black" />}>
      <ReportsPrintPageInner />
    </Suspense>
  );
}
