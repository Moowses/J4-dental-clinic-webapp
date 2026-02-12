"use client";

import type { Appointment } from "@/lib/types/appointment";
import type { BillingRecord } from "@/lib/types/billing";

function money(v: number) {
  return `P${Number(v || 0).toLocaleString()}`;
}

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

type HistoryRow = {
  id: string;
  appointmentId: string;
  billKey: string;
  dateText: string;
  sortMs: number;
  procedureLabel: string;
  dentist: string;
  amount: number;
  paymentText: string;
  statusText: string;
  statusClass: string;
};

type TxRow = {
  id?: string;
  date?: unknown;
  amount?: number;
  method?: string;
  mode?: string;
  installmentId?: string;
};

type InstRow = {
  id?: string;
  description?: string;
};

export default function TransactionsTable({
  appointments,
  billingRecords,
  onOpenModal,
  dentistNameMap,
}: {
  appointments: Appointment[];
  billingRecords: BillingRecord[];
  onOpenModal: (appt: Appointment, bill: BillingRecord) => void;
  dentistNameMap: Record<string, string>;
}) {
  const apptMap = new Map<string, Appointment>();
  for (const a of appointments) apptMap.set(String(a.id || ""), a);

  const resolveDentistName = (appt?: Appointment): string => {
    if (!appt) return "N/A";
    const dentistId = String((appt as Appointment & { dentistId?: string }).dentistId || "").trim();
    if (!dentistId) return "N/A";
    return dentistNameMap[dentistId] || "Dentist";
  };

  const historyRows: HistoryRow[] = (billingRecords || [])
    .flatMap((bill) => {
      const apptId = String(bill?.appointmentId || "");
      const appt = apptMap.get(apptId);
      const dentist = resolveDentistName(appt);

      const items = Array.isArray(bill?.items) ? bill.items : [];
      const preferredItems = items.filter((it) => {
        const s = String(it?.status || "").toLowerCase();
        return s === "plan" || s === "partial" || s === "unpaid" || s === "paid";
      });
      const procedureName =
        String((preferredItems[0] || items[0] || { name: "" })?.name || "").trim() ||
        String((appt as Appointment & { serviceType?: string })?.serviceType || "Procedure");

      const installments = Array.isArray(bill?.paymentPlan?.installments)
        ? bill.paymentPlan.installments
        : [];
      const totalTerms = installments.length;
      const instMeta = new Map<string, { idx: number; description: string }>();
      installments.forEach((inst: InstRow, i) => {
        const descRaw = String(inst?.description || "").trim();
        const desc = descRaw ? descRaw.split(" • Installment")[0] || descRaw : procedureName;
        instMeta.set(String(inst?.id || ""), { idx: i + 1, description: desc });
      });

      const txns = Array.isArray(bill?.transactions) ? bill.transactions : [];
      const txnsWithTime = txns.map((tx: TxRow, idx) => ({ tx, idx, ms: toDate(tx?.date)?.getTime() || 0 }));
      const latestTxn = txnsWithTime.sort((a, b) => b.ms - a.ms || b.idx - a.idx)[0]?.tx;
      const billIsPaid = String(bill?.status || "").toLowerCase() === "paid";

      return txns.map((tx: TxRow) => {
        const txDate = toDate(tx?.date);
        const mode = String(tx?.mode || "").toLowerCase();
        const inst = instMeta.get(String(tx?.installmentId || ""));
        const isFullInstallmentPay = mode === "installment_full";
        const isInstallmentPay = mode === "installment";
        const isLatestForBill = String(tx?.id || "") === String(latestTxn?.id || "");
        const shouldShowPaid = isFullInstallmentPay || (billIsPaid && isLatestForBill);

        const procedureLabel = isFullInstallmentPay
          ? `Paid full ${procedureName}`
          : isInstallmentPay && inst
          ? `${inst.description} ${inst.idx} of ${totalTerms || "?"}`
          : procedureName;

        return {
          id: `${apptId}-${String(tx?.id || Math.random())}`,
          appointmentId: apptId,
          billKey: String(bill?.id || bill?.appointmentId || apptId),
          dateText: txDate ? txDate.toLocaleDateString() : "-",
          sortMs: txDate?.getTime() || 0,
          procedureLabel,
          dentist,
          amount: Number(tx?.amount || 0),
          paymentText: String(tx?.method || "cash").toUpperCase(),
          statusText: shouldShowPaid ? "Paid" : "Partial",
          statusClass: shouldShowPaid
            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
            : "bg-amber-50 text-amber-700 border-amber-200",
        } satisfies HistoryRow;
      });
    })
    .sort((a, b) => b.sortMs - a.sortMs);

  if (!historyRows.length) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold text-slate-700">No payment history yet.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="border-b border-slate-100 px-6 py-4">
        <h3 className="text-lg font-extrabold text-slate-900">Payment History</h3>
        <p className="mt-1 text-xs text-slate-500">Installment and full-payment records (latest first).</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs font-bold text-slate-600">
            <tr>
              <th className="px-6 py-3">Date</th>
              <th className="px-6 py-3">Case / Procedure</th>
              <th className="px-6 py-3">Dentist</th>
              <th className="px-6 py-3">Amount</th>
              <th className="px-6 py-3">Payment</th>
              <th className="px-6 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {historyRows.map((row) => {
              const appt = apptMap.get(row.appointmentId);
              const bill = (billingRecords || []).find(
                (b) => String(b?.id || b?.appointmentId || "") === row.billKey
              );
              return (
                <tr
                  key={row.id}
                  onClick={() => (appt && bill ? onOpenModal(appt, bill) : undefined)}
                  className={`transition ${appt ? "cursor-pointer hover:bg-slate-50" : ""}`}
                >
                  <td className="px-6 py-4 text-slate-700">{row.dateText}</td>
                  <td className="px-6 py-4 font-semibold text-slate-900">{row.procedureLabel}</td>
                  <td className="px-6 py-4 font-semibold text-slate-900">{row.dentist}</td>
                  <td className="px-6 py-4 font-extrabold text-slate-900">{money(row.amount)}</td>
                  <td className="px-6 py-4 font-semibold text-slate-900">{row.paymentText}</td>
                  <td className="px-6 py-4">
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-bold uppercase ${row.statusClass}`}>
                      {row.statusText}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

