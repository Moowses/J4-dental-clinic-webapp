"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { formatTime12h } from "@/lib/utils/time";

import {
  getClinicScheduleAction,
  assignDentistAction,
  deleteAppointmentAction,
  AppointmentWithPatient,
} from "@/app/actions/appointment-actions";

import { getDentistListAction } from "@/app/actions/dentist-actions";
import type { UserProfile } from "@/lib/types/user";

function formatLocalYMD(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseLocalYMD(ymd: string) {
  return new Date(`${ymd}T00:00:00`);
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function addMonths(date: Date, months: number) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

type UnassignedRow = AppointmentWithPatient & { dateStr: string };

type RangeValue = "1m" | "2m" | "3m" | "4m" | "6m";

const RANGE_OPTIONS: Array<{ value: RangeValue; label: string }> = [
  { value: "1m", label: "Next 1 month" },
  { value: "2m", label: "Next 2 months" },
  { value: "3m", label: "Next 3 months" },
  { value: "4m", label: "Next 4 months" },
  { value: "6m", label: "Next 6 months" },
];

function buildUpcomingDateRange(range: RangeValue) {
  const today = new Date();
  const end = addMonths(today, Number(range.replace("m", "")));
  const dates: string[] = [];
  const cursor = new Date(today);

  while (cursor <= end) {
    dates.push(formatLocalYMD(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

const inputBase =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-300";

function ActionLoadingOverlay({ message }: { message: string }) {
  const loaderBars = Array.from({ length: 12 });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <div className="text-lg font-extrabold text-slate-900">Processing</div>
        </div>

        <div className="p-6 flex items-center justify-center">
      <div className="w-full max-w-[280px] rounded-[28px] border border-sky-100 bg-white px-8 py-7 shadow-[0_24px_60px_rgba(14,75,90,0.16)]">
        <div className="flex flex-col items-center">
          <div className="relative h-20 w-20">
            <div className="absolute inset-0 animate-[spin_1.15s_linear_infinite]">
              {loaderBars.map((_, index) => {
                const angle = index * 30;
                const opacity = 0.18 + index * 0.06;
                return (
                  <span
                    key={index}
                    className="absolute left-1/2 top-1/2 h-4 w-1.5 -translate-x-1/2 rounded-full bg-[#4d8df7]"
                    style={{
                      transform: `translate(-50%, -50%) rotate(${angle}deg) translateY(-28px)`,
                      opacity,
                    }}
                  />
                );
              })}
            </div>
          </div>

          <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-sky-100 shadow-inner">
            <div className="h-full w-2/3 animate-pulse rounded-full bg-gradient-to-r from-[#5da6ff] via-[#2d7ef7] to-[#7bc6ff]" />
          </div>

          <div className="mt-4 text-center">
            <div className="text-[15px] font-black uppercase tracking-[0.22em] text-[#3f7ee8]">
              Please Wait
            </div>
            <div className="mt-1 text-xs font-medium text-slate-500">{message}</div>
          </div>
        </div>
      </div>
        </div>
      </div>
    </div>
  );
}

function ActionResultModal({
  tone,
  title,
  message,
  onClose,
}: {
  tone: "success" | "error";
  title: string;
  message: string;
  onClose: () => void;
}) {
  const isSuccess = tone === "success";

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onMouseDown={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <div className={`text-lg font-extrabold ${isSuccess ? "text-emerald-700" : "text-rose-700"}`}>
            {title}
          </div>
        </div>

        <div className="p-6">
          <div className="flex flex-col items-center text-center">
          <div
            className={`flex h-20 w-20 items-center justify-center rounded-full border-[6px] ${
              isSuccess
                ? "border-emerald-100 bg-emerald-50"
                : "border-rose-100 bg-rose-50"
            }`}
          >
            <div className={`text-3xl font-black ${isSuccess ? "text-emerald-600" : "text-rose-600"}`}>
              {isSuccess ? "OK" : "!"}
            </div>
          </div>

          <p className="mt-2 text-sm text-slate-600">{message}</p>

          <button
            type="button"
            onClick={onClose}
            className={`mt-5 w-full rounded-xl px-4 py-3 text-sm font-extrabold text-white ${
              isSuccess ? "bg-emerald-600 hover:bg-emerald-700" : "bg-rose-600 hover:bg-rose-700"
            }`}
          >
            Close
          </button>
        </div>
      </div>
      </div>
    </div>
  );
}

function DeleteConfirmModal({
  patientName,
  onCancel,
  onConfirm,
}: {
  patientName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onMouseDown={onCancel} />
      <div className="relative w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <div className="text-lg font-extrabold text-slate-900">Confirm action</div>
          <div className="text-sm text-slate-500 mt-1">
            Are you sure you want to delete this appointment?
          </div>
        </div>

        <div className="p-6">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-center">
          <p className="mt-2 text-sm text-slate-600">
            Patient: <span className="font-bold text-slate-900">{patientName}</span>
          </p>
        </div>

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-extrabold text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 rounded-xl bg-rose-600 px-4 py-3 text-sm font-extrabold text-white hover:bg-rose-700"
          >
            Delete
          </button>
        </div>
      </div>
      </div>
    </div>
  );
}

export default function UnassignedAppointmentsPanel({
  canDelete = false,
}: {
  canDelete?: boolean;
}) {
  const [range, setRange] = useState<RangeValue>("2m");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [dentists, setDentists] = useState<UserProfile[]>([]);
  const [rows, setRows] = useState<UnassignedRow[]>([]);

  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; patientName: string } | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteResult, setDeleteResult] = useState<{ tone: "success" | "error"; title: string; message: string } | null>(null);

  const fetchDentists = useCallback(async () => {
    const res = await getDentistListAction();
    if (res.success && res.data) setDentists(res.data as any);
  }, []);

  const fetchUnassigned = useCallback(async () => {
    setLoading(true);
    setErr(null);
    setSuccessMsg(null);

    try {
      const dates = buildUpcomingDateRange(range);

      const concurrency = 6;
      let idx = 0;
      const results: UnassignedRow[] = [];

      const workers = new Array(concurrency).fill(0).map(async () => {
        while (idx < dates.length) {
          const my = idx++;
          const dateStr = dates[my];

          const res = await getClinicScheduleAction(dateStr);
          if (res.success && res.data) {
            for (const a of res.data as any[]) {
              const appt = a as any;
              if (!appt.dentistId) {
                results.push({ ...appt, dateStr });
              }
            }
          }
        }
      });

      await Promise.all(workers);

      results.sort((a, b) => {
        const da = a.dateStr.localeCompare(b.dateStr);
        if (da !== 0) return da;
        return String(a.time || "").localeCompare(String(b.time || ""));
      });

      setRows(results);
    } catch (e: any) {
      setErr(e?.message || "Failed to load unassigned appointments.");
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    fetchDentists();
    fetchUnassigned();
  }, [fetchDentists, fetchUnassigned]);

  const dentistOptions = useMemo(
    () =>
      dentists.map((d) => ({
        id: d.uid,
        label: d.displayName || d.email || d.uid,
      })),
    [dentists]
  );

  async function handleAssign(appointmentId: string, dentistId: string) {
    if (!dentistId) return;
    setAssigningId(appointmentId);
    setErr(null);
    setSuccessMsg(null);

    try {
      await assignDentistAction(appointmentId, dentistId);
      setSuccessMsg("Doctor assigned successfully.");
      await fetchUnassigned();
    } catch (e: any) {
      setErr(e?.message || "Failed to assign doctor.");
    } finally {
      setAssigningId(null);
    }
  }

  async function handleDelete(appointmentId: string) {
    const targetName =
      rows.find((row) => String(row.id || "") === appointmentId)?.patientName ||
      "Unknown Patient";
    setDeleteTarget({ id: appointmentId, patientName: String(targetName) });
  }

  async function confirmDelete() {
    if (!deleteTarget) return;

    setDeletingId(deleteTarget.id);
    setDeleteTarget(null);
    setDeleteLoading(true);
    setErr(null);
    setSuccessMsg(null);

    try {
      const res = await deleteAppointmentAction(deleteTarget.id);
      if (!res?.success) throw new Error(res?.error || "Failed to delete appointment.");

      setSuccessMsg("Appointment deleted.");
      setDeleteTarget(null);
      setDeleteResult({
        tone: "success",
        title: "Success",
        message: "The appointment was deleted and removed from the schedule.",
      });
      await fetchUnassigned();
    } catch (e: any) {
      const message = e?.message || "Failed to delete appointment.";
      setErr(message);
      setDeleteResult({
        tone: "error",
        title: "Delete Failed",
        message,
      });
    } finally {
      setDeleteLoading(false);
      setDeletingId(null);
    }
  }

  return (
    <div className="relative bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      {deleteLoading ? <ActionLoadingOverlay message="Deleting appointment..." /> : null}
      <div className="px-6 py-4 border-b border-slate-100 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-extrabold text-slate-900">Unassigned</h3>
          <p className="text-sm text-slate-500">Appointments that need doctor assignment</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={range}
            onChange={(e) => setRange(e.target.value as RangeValue)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
          >
            {RANGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <button
            onClick={fetchUnassigned}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="p-6">
        {err ? (
          <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {err}
          </div>
        ) : null}

        {successMsg ? (
          <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            {successMsg}
          </div>
        ) : null}

        {loading ? (
          <p className="text-sm text-slate-500">Loading...</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-500 italic">No unassigned appointments.</p>
        ) : (
          <div className="space-y-3">
            {rows.map((a) => (
              <div key={`${a.dateStr}-${a.id}`} className="rounded-2xl border border-slate-200 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <p className="font-extrabold text-slate-900 truncate">
                      {a.patientName || "Unknown Patient"}
                    </p>
                    <p className="text-sm text-slate-700 mt-1">
                      {parseLocalYMD(a.dateStr).toLocaleDateString(undefined, {
                        month: "short",
                        day: "2-digit",
                        year: "numeric",
                      })}
                      {a.time ? ` • ${formatTime12h(a.time)}` : ""}
                      {a.serviceType ? ` • ${a.serviceType}` : ""}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      Status: {String(a.status || "pending").toUpperCase()}
                    </p>
                  </div>

                  <div className="w-full md:max-w-[320px]">
                    <label className="text-xs font-extrabold text-slate-600">
                      Assign Doctor
                    </label>
	                    <select
	                      className={`${inputBase} mt-1`}
	                      defaultValue=""
	                      disabled={assigningId === a.id || deletingId === a.id}
	                      onChange={(e) => handleAssign(a.id, e.target.value)}
	                    >
                      <option value="">Select dentist…</option>
                      {dentistOptions.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.label}
                        </option>
                      ))}
                    </select>

	                    {assigningId === a.id ? (
	                      <p className="mt-2 text-xs text-slate-500">Assigning...</p>
	                    ) : null}

                      {canDelete ? (
                        <button
                          type="button"
                          onClick={() => handleDelete(a.id)}
                          disabled={assigningId === a.id || deletingId === a.id}
                          className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-extrabold text-red-700 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {deletingId === a.id ? "Deleting..." : "Delete Appointment"}
                        </button>
                      ) : null}
	                  </div>
	                </div>
	              </div>
	            ))}
	          </div>
        )}
      </div>
      {deleteTarget ? (
        <DeleteConfirmModal
          patientName={deleteTarget.patientName}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
        />
      ) : null}

      {deleteResult ? (
        <ActionResultModal
          tone={deleteResult.tone}
          title={deleteResult.title}
          message={deleteResult.message}
          onClose={() => setDeleteResult(null)}
        />
      ) : null}
    </div>
  );
}
