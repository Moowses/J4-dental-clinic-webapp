"use client";

import React, { useEffect, useMemo, useState } from "react";
import { getAllBillingAction } from "@/app/actions/billing-actions";
import { getUserProfile } from "@/lib/services/user-service";
import { getPatientRecord } from "@/lib/services/patient-service";
import type { UserProfile } from "@/lib/types/user";

type FilterKey = "unpaid" | "paid";

type AnyItem = {
  id: string;
  name: string;
  toothNumber?: string;
  price: number;
  payment?: { remainingAmount?: number; paidAmount?: number; status?: string; type?: string };
  status?: string; // legacy
};

type AnyBill = {
  id: string;
  appointmentId: string;
  patientId?: string;
  createdAt?: any;
  updatedAt?: any;
  items?: AnyItem[];
  transactions?: Array<{ id: string; amount: number; date: any; method?: string }>;
};

type PatientRow = {
  patientId: string;
  patientCode: string;
  patientName: string;
  billsCount: number;
  paidBills: number;
  unpaidBills: number;
  total: number;
  remaining: number;
  lastActivityMs: number;
};

function money(n: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n || 0);
}

function toDate(input: any): Date | null {
  try {
    if (!input) return null;
    if (input?.seconds) return new Date(input.seconds * 1000);
    if (typeof input === "string" || typeof input === "number") return new Date(input);
    if (input instanceof Date) return input;
    return null;
  } catch {
    return null;
  }
}

function billTotals(bill: AnyBill) {
  const items = Array.isArray(bill.items) ? bill.items : [];
  const total = items.reduce((s, it) => s + Number(it.price || 0), 0);

  // SINGLE SOURCE OF TRUTH
  const remaining =
    typeof (bill as any).remainingBalance === "number"
      ? Number((bill as any).remainingBalance)
      : 0;

  return {
    total,
    remaining,
    isPaid: remaining <= 0 && total > 0,
    isUnpaid: remaining > 0,
  };
}

function billLastActivityMs(bill: AnyBill) {
  let best = 0;
  const upd = toDate(bill.updatedAt)?.getTime() || 0;
  const crt = toDate(bill.createdAt)?.getTime() || 0;
  best = Math.max(best, upd, crt);
  const tx = bill.transactions || [];
  for (const t of tx) best = Math.max(best, toDate(t?.date)?.getTime() || 0);
  return best;
}

export default function BillingOverviewPanel({
  onSelectBill,
  refreshKey = 0,
}: {
  // Backwards compatibility: we pass `pid:<patientId>` to open patient manager.
  onSelectBill: (billingIdOrPatientKey: string) => void;
  refreshKey?: number;
}) {
  const [filter, setFilter] = useState<FilterKey>("unpaid");
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<PatientRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const res = await getAllBillingAction("all");
        if (!res?.success) throw new Error(res?.error || "Failed to load billing records.");

        const bills = (res.data || []) as AnyBill[];

        const filtered = bills.filter((b) => {
          const t = billTotals(b);
          if (filter === "paid") return t.isPaid;
          return t.isUnpaid;
        });

        const patientIds = Array.from(
          new Set(filtered.map((b) => b.patientId).filter(Boolean) as string[])
        );

        const profileMap = new Map<string, UserProfile>();
        const patientCodeMap = new Map<string, string>();
        await Promise.all(
          patientIds.map(async (pid) => {
            const pr = await getUserProfile(pid);
            if (pr?.success && pr.data) profileMap.set(pid, pr.data as any);
            const record = await getPatientRecord(pid);
            const code = (record as any)?.data?.patientId;
            if (code) patientCodeMap.set(pid, String(code));
          })
        );

        const agg = new Map<string, PatientRow>();
        for (const b of filtered) {
          const pid = b.patientId;
          if (!pid) continue;

          const profile: any = profileMap.get(pid);
          const patientCode = patientCodeMap.get(pid) || "â€”";
          const name =
            profile?.displayName ||
            profile?.fullName ||
            profile?.name ||
            profile?.email ||
            `${pid.slice(0, 10)}...`;

          const t = billTotals(b);
          const last = billLastActivityMs(b);

          const prev = agg.get(pid);
          if (!prev) {
            agg.set(pid, {
              patientId: pid,
              patientCode,
              patientName: name,
              billsCount: 1,
              paidBills: t.isPaid ? 1 : 0,
              unpaidBills: t.isUnpaid ? 1 : 0,
              total: t.total,
              remaining: t.remaining,
              lastActivityMs: last,
            });
          } else {
            if (!prev.patientCode || prev.patientCode === "â€”") prev.patientCode = patientCode;
            prev.billsCount += 1;
            prev.paidBills += t.isPaid ? 1 : 0;
            prev.unpaidBills += t.isUnpaid ? 1 : 0;
            prev.total += t.total;
            prev.remaining += t.remaining;
            prev.lastActivityMs = Math.max(prev.lastActivityMs || 0, last);
          }
        }

        const out = Array.from(agg.values()).sort((a, b) => {
          const aOpen = a.remaining > 0;
          const bOpen = b.remaining > 0;
          if (aOpen !== bOpen) return aOpen ? -1 : 1;
          return (b.lastActivityMs || 0) - (a.lastActivityMs || 0);
        });

        if (!alive) return;
        setRows(out);
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message || "Failed to load billing overview.");
        setRows([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [filter, refreshKey]);

  const stats = useMemo(() => {
    const totalPatients = rows.length;
    const openPatients = rows.filter((r) => r.remaining > 0).length;
    const unpaidBills = rows.reduce((s, r) => s + r.unpaidBills, 0);
    return { totalPatients, openPatients, unpaidBills };
  }, [rows]);

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-extrabold text-slate-900">Billing</h3>
          <p className="text-sm text-slate-500">Patient summary (billing is per appointment)</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-extrabold px-3 py-1 rounded-full bg-slate-100 border border-slate-200 text-slate-700">
            Patients: {stats.totalPatients}
          </span>
          <span className="text-xs font-extrabold px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-700">
            With Balance: {stats.openPatients}
          </span>
          <span className="text-xs font-extrabold px-3 py-1 rounded-full bg-slate-100 border border-slate-200 text-slate-700">
            Open Bills: {stats.unpaidBills}
          </span>

          <div className="ml-0 sm:ml-2 flex gap-1">
            {(["unpaid", "paid"] as const).map((k) => {
              const active = filter === k;
              return (
                <button
                  key={k}
                  onClick={() => setFilter(k)}
                  className={`px-3 py-2 rounded-xl text-xs font-extrabold uppercase transition ${
                    active
                      ? "bg-slate-900 text-white"
                      : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {k}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="p-6">
        {loading ? (
          <p className="text-sm text-slate-500">Loading billing…</p>
        ) : err ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {err}
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-500 italic">No billing records found.</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="w-full text-left">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-xs font-extrabold text-slate-600">
                  <th className="p-3">Patient ID</th>
                  <th className="p-3">Patient name</th>
                  <th className="p-3">Bill</th>
                  <th className="p-3">Paid bills</th>
                  <th className="p-3">Remaining</th>
                  <th className="p-3">Total</th>
                  <th className="p-3">Unpaid</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const open = r.remaining > 0;
                  return (
                    <tr
                      key={r.patientId}
                      className="text-sm hover:bg-slate-50 cursor-pointer"
                      title="Click here to view more"
                      onClick={() => onSelectBill(`pid:${r.patientId}|f:${filter}`)}
                    >
                      <td className="p-3 text-slate-600 font-mono whitespace-nowrap">
                        {r.patientCode}
                      </td>
                      <td className="p-3">
                        <div className="font-extrabold text-slate-900">{r.patientName}</div>
                      </td>
                      <td className="p-3 text-slate-700 font-bold whitespace-nowrap">{r.billsCount}</td>
                      <td className="p-3 text-slate-700 font-bold whitespace-nowrap">{r.paidBills}</td>
                      <td className="p-3 text-slate-700 font-bold whitespace-nowrap">₱ {money(r.remaining)}</td>
                      <td className="p-3 text-slate-700 font-bold whitespace-nowrap">₱ {money(r.total)}</td>
                      <td className="p-3">
                        <span
                          className={`text-xs font-extrabold px-3 py-1 rounded-full border ${
                            open
                              ? "bg-amber-50 text-amber-700 border-amber-200"
                              : "bg-emerald-50 text-emerald-700 border-emerald-200"
                          }`}
                        >
                          {open ? `${r.unpaidBills} open` : "0 open"}
                        </span>
                      </td>
                      <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => onSelectBill(`pid:${r.patientId}|f:${filter}`)}
                          className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-extrabold hover:bg-slate-800 transition"
                        >
                          Manage
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="px-4 py-3 border-t border-slate-200 bg-white text-[11px] text-slate-500">
              Billing is created when the dentist finishes an appointment. Click any patient row to manage unpaid items.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

