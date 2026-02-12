// components/client/AppointmentDetailsModal.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { formatTime12h } from "@/lib/utils/time";
import type { Appointment } from "@/lib/types/appointment";
import type { BillingRecord } from "@/lib/types/billing";
import type { DentistProfile } from "@/lib/services/dentist-profile-service";

function fmtTimestamp(ts: unknown) {
  try {
    if (!ts) return "-";
    const d: Date = typeof (ts as { toDate?: () => Date })?.toDate === "function"
      ? (ts as { toDate: () => Date }).toDate()
      : new Date(ts as string | number | Date);
    return Number.isNaN(d.getTime()) ? "-" : d.toLocaleString();
  } catch {
    return "-";
  }
}

function money(v: number) {
  return `P${Number(v || 0).toLocaleString()}`;
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 p-4">
      <p className="text-xs font-bold text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

export type AppointmentModalTab = "details" | "transactions";

export default function AppointmentDetailsModal({
  open,
  onClose,
  appointment,
  billingRecord,
  dentistProfile,
  dentistLoading,
  brandColor,
  initialTab = "details",
}: {
  open: boolean;
  onClose: () => void;
  appointment: Appointment | null;
  billingRecord?: BillingRecord | null;
  dentistProfile: DentistProfile | null;
  dentistLoading: boolean;
  brandColor: string;
  initialTab?: AppointmentModalTab;
}) {
  const [tab, setTab] = useState<AppointmentModalTab>("details");

  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);

  const canTransactions = useMemo(() => {
    if (!appointment) return false;
    if (billingRecord && Array.isArray(billingRecord.transactions) && billingRecord.transactions.length > 0) {
      return true;
    }
    const status = String((appointment as Appointment & { status?: string }).status || "").toLowerCase();
    return status === "completed" && !!(appointment as Appointment & { treatment?: unknown }).treatment;
  }, [appointment, billingRecord]);

  if (!open || !appointment) return null;

  const dentistId = (appointment as Appointment & { dentistId?: string }).dentistId as string | undefined;

  const dentistLabel = !dentistId
    ? "Unassigned dentist"
    : dentistLoading
      ? "Loading dentist..."
      : dentistProfile?.displayName || dentistProfile?.email || "Dentist (profile not found)";

  const treatment = (appointment as Appointment & {
    treatment?: {
      completedAt?: unknown;
      notes?: string;
      totalBill?: number;
      procedures?: { id?: string; name: string; price: number }[];
    };
  }).treatment;

  const procedures = treatment?.procedures || [];
  const totalBill =
    typeof treatment?.totalBill === "number"
      ? treatment.totalBill
      : procedures.reduce((sum, p) => sum + (Number(p.price) || 0), 0);

  const billingTxns = Array.isArray(billingRecord?.transactions) ? billingRecord!.transactions : [];

  return (
    <div className="fixed inset-0 z-50">
      <button className="absolute inset-0 bg-black/50" aria-label="Close modal" onClick={onClose} />

      <div className="absolute left-1/2 top-1/2 w-[94vw] max-w-2xl -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
          <div>
            <p className="text-lg font-extrabold text-slate-900">Appointment</p>
            <p className="text-sm text-slate-500">
              {(appointment as Appointment & { date?: string }).date} • {formatTime12h(String((appointment as Appointment & { time?: string }).time || ""))}
            </p>
          </div>

          <button
            onClick={onClose}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Close
          </button>
        </div>

        <div className="flex gap-2 border-b border-slate-200 px-5 pt-4">
          <button
            onClick={() => setTab("details")}
            className={[
              "rounded-xl px-4 py-2 text-sm font-semibold",
              tab === "details" ? "text-white" : "text-slate-700 hover:bg-slate-50",
            ].join(" ")}
            style={tab === "details" ? { backgroundColor: brandColor } : undefined}
          >
            View
          </button>

          <button
            onClick={() => canTransactions && setTab("transactions")}
            disabled={!canTransactions}
            className={[
              "rounded-xl px-4 py-2 text-sm font-semibold",
              canTransactions
                ? tab === "transactions"
                  ? "text-white"
                  : "text-slate-700 hover:bg-slate-50"
                : "cursor-not-allowed text-slate-400",
            ].join(" ")}
            style={canTransactions && tab === "transactions" ? { backgroundColor: brandColor } : undefined}
            title={!canTransactions ? "Transactions available after payment/completion" : ""}
          >
            Transactions
          </button>
        </div>

        <div className="p-5 max-h-[70vh] overflow-y-auto">
          {tab === "details" && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Info label="Service Type" value={String((appointment as Appointment & { serviceType?: string }).serviceType || "-")} />
                <Info label="Status" value={String((appointment as Appointment & { status?: string }).status || "-")} />
                <Info label="Payment" value={String((appointment as Appointment & { paymentStatus?: string }).paymentStatus || "-")} />
                <Info label="Dentist" value={dentistLabel} />
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-bold text-slate-500">Notes</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
                  {String((appointment as Appointment & { notes?: string }).notes || "").trim() || "-"}
                </p>
              </div>
            </div>
          )}

          {tab === "transactions" && (
            <div className="space-y-4">
              {billingRecord ? (
                <>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Info label="Billing Status" value={String(billingRecord.status || "-")} />
                    <Info label="Remaining Balance" value={money(Number(billingRecord.remainingBalance || 0))} />
                  </div>

                  <div className="rounded-2xl border border-slate-200 p-4">
                    <p className="text-sm font-extrabold text-slate-900">Payment Transactions</p>
                    {!billingTxns.length ? (
                      <p className="mt-2 text-sm text-slate-500">No payment transactions recorded.</p>
                    ) : (
                      <div className="mt-3 space-y-2">
                        {billingTxns
                          .slice()
                          .sort((a, b) => {
                            const ta = new Date(a.date as unknown as string).getTime();
                            const tb = new Date(b.date as unknown as string).getTime();
                            return tb - ta;
                          })
                          .map((tx) => (
                            <div
                              key={String(tx.id || Math.random())}
                              className="rounded-xl border border-slate-200 bg-white p-3"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <p className="text-sm font-extrabold text-slate-900">{money(Number(tx.amount || 0))}</p>
                                <p className="text-xs font-bold text-slate-600">{String(tx.method || "cash").toUpperCase()}</p>
                              </div>
                              <p className="mt-1 text-xs text-slate-500">{fmtTimestamp(tx.date)}</p>
                              {tx.note ? <p className="mt-1 text-xs text-slate-700">{String(tx.note)}</p> : null}
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Info label="Completed At" value={fmtTimestamp(treatment?.completedAt)} />
                    <Info label="Total Bill" value={money(Number(totalBill || 0))} />
                  </div>

                  <div className="rounded-2xl border border-slate-200 p-4">
                    <p className="text-sm font-extrabold text-slate-900">Procedures</p>

                    {!procedures.length ? (
                      <p className="mt-2 text-sm text-slate-500">No procedures recorded.</p>
                    ) : (
                      <div className="mt-3 space-y-2">
                        {procedures.map((p, idx) => (
                          <div
                            key={`${p.id || idx}`}
                            className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2"
                          >
                            <p className="truncate text-sm font-semibold text-slate-900">{p.name}</p>
                            <p className="text-sm font-bold text-slate-800">{money(Number(p.price || 0))}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

