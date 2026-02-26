// components/client/AppointmentRowActions.tsx
"use client";

import type { Appointment } from "@/lib/types/appointment";

export default function AppointmentRowActions({
  appointment,
  onView,
  onTransactions,
  onReschedule,
  onCancel,
  cancelDisabledReason,
  rescheduleDisabledReason,
}: {
  appointment: Appointment;
  onView: () => void;
  onTransactions: () => void;
  onReschedule: () => void;
  onCancel: () => void;
  cancelDisabledReason?: string | null;
  rescheduleDisabledReason?: string | null;
}) {
  const status = String(appointment.status || "").toLowerCase();
  const canCancel = status === "pending";
  const canReschedule = status === "pending";
  const canTransactions = status === "completed" && !!appointment.treatment;

  return (
    <div className="flex gap-2">
      <button
        className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200"
        onClick={onView}
      >
        View
      </button>

      <button
        className={[
          "rounded-lg px-3 py-2 text-xs font-bold",
          canTransactions
            ? "bg-slate-900 text-white hover:opacity-95"
            : "cursor-not-allowed bg-slate-100 text-slate-400",
        ].join(" ")}
        onClick={onTransactions}
        disabled={!canTransactions}
        title={!canTransactions ? "Available after completion" : ""}
      >
        Transactions
      </button>

      {canCancel && (
        <>
          {canReschedule && (
            <button
              className={[
                "rounded-lg px-3 py-2 text-xs font-bold",
                rescheduleDisabledReason
                  ? "cursor-not-allowed bg-slate-100 text-slate-400"
                  : "bg-blue-50 text-blue-700 hover:bg-blue-100",
              ].join(" ")}
              onClick={onReschedule}
              disabled={Boolean(rescheduleDisabledReason)}
              title={rescheduleDisabledReason || ""}
            >
              Reschedule
            </button>
          )}
          <button
            className={[
              "rounded-lg px-3 py-2 text-xs font-bold",
              cancelDisabledReason
                ? "cursor-not-allowed bg-slate-100 text-slate-400"
                : "bg-red-50 text-red-700 hover:bg-red-100",
            ].join(" ")}
            onClick={onCancel}
            disabled={Boolean(cancelDisabledReason)}
            title={cancelDisabledReason || ""}
          >
            Cancel
          </button>
        </>
      )}
    </div>
  );
}
