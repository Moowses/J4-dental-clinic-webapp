"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { formatTime12h } from "@/lib/utils/time";
import {
  getClinicScheduleAction,
  assignDentistAction,
  updateAppointmentStatusAction,
  deleteAppointmentAction,
  AppointmentWithPatient,
} from "@/app/actions/appointment-actions";
import { getDentistListAction } from "@/app/actions/dentist-actions";
import ReschuleBookAppointmentModal from "@/components/ReschuleBookAppointmentModal";
import type { UserProfile } from "@/lib/types/user";
import {
  ConfirmActionModal,
  ProcessingModal,
  ResultModal,
} from "@/components/admin/ActionFeedbackModals";


function formatLocalYMD(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseLocalYMD(ymd: string) {
  return new Date(`${ymd}T00:00:00`);
}

function addMonths(date: Date, months: number) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

type UpcomingRow = AppointmentWithPatient & { dateStr: string };

type BusyMap = Record<
  string,
  { assigning?: boolean; confirming?: boolean; cancelling?: boolean; noShowing?: boolean; deleting?: boolean }
>;

const inputBase =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-300";

type RangeValue = "15d" | "30d" | "1m" | "2m" | "3m" | "4m" | "6m";
type FilterMode = "rolling" | "month";

const UPCOMING_RANGE_OPTIONS: Array<{ value: RangeValue; label: string }> = [
  { value: "1m", label: "Next 1 month" },
  { value: "2m", label: "Next 2 months" },
  { value: "3m", label: "Next 3 months" },
  { value: "4m", label: "Next 4 months" },
  { value: "6m", label: "Next 6 months" },
];

const PREVIOUS_RANGE_OPTIONS: Array<{ value: RangeValue; label: string }> = [
  { value: "15d", label: "Previous 15 days" },
  { value: "30d", label: "Previous 30 days" },
  { value: "2m", label: "Previous 2 months" },
  { value: "3m", label: "Previous 3 months" },
  { value: "4m", label: "Previous 4 months" },
  { value: "6m", label: "Previous 6 months" },
];

function buildDateRange(mode: "upcoming" | "previous", range: RangeValue) {
  const today = new Date();
  const start = new Date(today);
  const end = new Date(today);

  if (mode === "previous") {
    if (range === "15d") {
      start.setDate(start.getDate() - 15);
      end.setDate(end.getDate() - 1);
    } else if (range === "30d") {
      start.setDate(start.getDate() - 30);
      end.setDate(end.getDate() - 1);
    } else {
      start.setTime(addMonths(today, -Number(range.replace("m", ""))).getTime());
      end.setDate(end.getDate() - 1);
    }
  } else {
    if (range === "15d") {
      end.setDate(end.getDate() + 15);
    } else if (range === "30d") {
      end.setDate(end.getDate() + 30);
    } else {
      end.setTime(addMonths(today, Number(range.replace("m", ""))).getTime());
    }
  }

  const dates: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    dates.push(formatLocalYMD(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

function buildMonthDateRange(monthValue: string) {
  const [yearStr, monthStr] = monthValue.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);

  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return buildDateRange("upcoming", "2m");
  }

  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  const dates: string[] = [];
  const cursor = new Date(start);

  while (cursor <= end) {
    dates.push(formatLocalYMD(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

function getCurrentMonthValue() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
}

function pillClass(status: string) {
  const s = (status || "pending").toLowerCase();
  const base =
    "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-extrabold tracking-wide border";

  if (s === "confirmed") return `${base} bg-emerald-50 text-emerald-700 border-emerald-200`;
  if (s === "cancelled") return `${base} bg-rose-50 text-rose-700 border-rose-200`;
  if (s === "completed") return `${base} bg-slate-50 text-slate-700 border-slate-200`;
  if (s === "no_show") return `${base} bg-orange-50 text-orange-700 border-orange-200`;
  return `${base} bg-amber-50 text-amber-700 border-amber-200`;
}

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

export default function UpcomingAppointmentsPanel({
  view = "upcoming",
  canDelete = false,
  onOpenBilling,
}: {
  view?: "upcoming" | "previous" | "completed" | "cancelled" | "no_show";
  canDelete?: boolean;
  onOpenBilling?: (appointmentId: string) => void;
}) {
  const previousRescheduleMessage =
    "To book again another appointment, you can reschedule future or upcoming booking, not past booking.";
  const [range, setRange] = useState<RangeValue>(
    view === "previous" ? "30d" : "2m"
  );
  const [filterMode, setFilterMode] = useState<FilterMode>("rolling");
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonthValue);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [searchName, setSearchName] = useState("");
  const [debouncedSearchName, setDebouncedSearchName] = useState("");

  const [dentists, setDentists] = useState<UserProfile[]>([]);
  const [rows, setRows] = useState<UpcomingRow[]>([]);
  const [busy, setBusy] = useState<BusyMap>({});

  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [reschedOpen, setReschedOpen] = useState(false);
  const [reschedAppt, setReschedAppt] = useState<AppointmentWithPatient | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; patientName: string } | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteResult, setDeleteResult] = useState<{ tone: "success" | "error"; title: string; message: string } | null>(null);
  const [actionConfirm, setActionConfirm] = useState<null | {
    appointmentId: string;
    patientName: string;
    action: "confirmed" | "cancelled" | "no_show";
  }>(null);
  const [actionLoading, setActionLoading] = useState<null | {
    appointmentId: string;
    action: "confirmed" | "cancelled" | "no_show";
  }>(null);
  const [actionResult, setActionResult] = useState<null | {
    tone: "success" | "error";
    title: string;
    message: string;
  }>(null);

  

  const setRowBusy = (id: string, patch: BusyMap[string]) => {
    setBusy((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  };

  const fetchDentists = useCallback(async () => {
    try {
      const res = await getDentistListAction();
      if (res?.success && res.data) setDentists(res.data as any);
    } catch {
      // silent fail; dropdown will still render but empty
    }
  }, []);

  const fetchUpcoming = useCallback(async () => {
    setLoading(true);
    setErr(null);
    setSuccessMsg(null);

    try {
      const results: UpcomingRow[] = [];
      const searchingAllDates = debouncedSearchName.trim().length > 0;

      if (searchingAllDates) {
        const res = await getClinicScheduleAction();
        if (res?.success && res.data) {
          for (const a of res.data as any[]) {
            results.push({ ...(a as any), dateStr: String((a as any).date || "") });
          }
        }
      } else {
        const dates =
          filterMode === "month"
            ? buildMonthDateRange(selectedMonth)
            : buildDateRange(view === "previous" ? "previous" : "upcoming", range);

        const concurrency = 6;
        let idx = 0;

        const workers = new Array(concurrency).fill(0).map(async () => {
          while (idx < dates.length) {
            const my = idx++;
            const dateStr = dates[my];

            const res = await getClinicScheduleAction(dateStr);
            if (res?.success && res.data) {
              for (const a of res.data as any[]) {
                results.push({ ...(a as any), dateStr });
              }
            }
          }
        });

        await Promise.all(workers);
      }

      results.sort((a, b) => {
        const da = a.dateStr.localeCompare(b.dateStr);
        if (da !== 0) return da;
        return String(a.time || "").localeCompare(String(b.time || ""));
      });

      if (view === "previous" || (searchingAllDates && view !== "upcoming")) {
        results.reverse();
      }

      setRows(results);
    } catch (e: any) {
      setErr(e?.message || "Failed to load upcoming appointments.");
    } finally {
      setLoading(false);
    }
  }, [debouncedSearchName, filterMode, range, selectedMonth, view]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearchName(searchName.trim());
    }, 350);

    return () => window.clearTimeout(timer);
  }, [searchName]);

  useEffect(() => {
    setRange(view === "previous" ? "30d" : "2m");
    setFilterMode("rolling");
  }, [view]);

  useEffect(() => {
    fetchDentists();
    fetchUpcoming();
  }, [fetchDentists, fetchUpcoming]);

  const dentistOptions = useMemo(
    () =>
      dentists.map((d) => ({
        id: d.uid,
        label: d.displayName || d.email || d.uid,
      })),
    [dentists]
  );

  const visibleRows = useMemo(() => {
    const getStatus = (a: UpcomingRow) => String(a.status || "").toLowerCase();
    const query = debouncedSearchName.trim().toLowerCase();
    const byView =
      view === "completed"
        ? rows.filter((a) => getStatus(a) === "completed")
        : view === "previous"
        ? rows
        : view === "cancelled"
        ? rows.filter((a) => getStatus(a) === "cancelled")
        : view === "no_show"
        ? rows.filter((a) => getStatus(a) === "no_show")
        : rows.filter((a) => {
            const s = getStatus(a);
            return s !== "completed" && s !== "cancelled" && s !== "no_show";
          });

    if (!query) return byView;

    return byView.filter((a) => {
      const patientName = String(a.patientName || "").toLowerCase();
      return patientName.includes(query);
    });
  }, [debouncedSearchName, rows, view]);

  const hasRowsForView = useMemo(() => {
    const getStatus = (a: UpcomingRow) => String(a.status || "").toLowerCase();
    if (view === "completed") {
      return rows.some((a) => getStatus(a) === "completed");
    }
    if (view === "previous") {
      return rows.length > 0;
    }
    if (view === "cancelled") {
      return rows.some((a) => getStatus(a) === "cancelled");
    }
    if (view === "no_show") {
      return rows.some((a) => getStatus(a) === "no_show");
    }
    return rows.some((a) => {
      const s = getStatus(a);
      return s !== "completed" && s !== "cancelled" && s !== "no_show";
    });
  }, [rows, view]);

  async function handleAssign(appointmentId: string, dentistId: string) {
    if (!dentistId) return;

    setRowBusy(appointmentId, { assigning: true });
    setErr(null);
    setSuccessMsg(null);

    try {
      const res = await assignDentistAction(appointmentId, dentistId);
      if (!res?.success) throw new Error(res?.error || "Failed to assign doctor.");

      setSuccessMsg("Doctor assigned successfully.");
      await fetchUpcoming();
    } catch (e: any) {
      setErr(e?.message || "Failed to assign doctor.");
    } finally {
      setRowBusy(appointmentId, { assigning: false });
    }
  }

  function openStatusConfirm(appointmentId: string, action: "confirmed" | "cancelled" | "no_show") {
    const targetName =
      visibleRows.find((row) => String(row.id || "") === appointmentId)?.patientName ||
      "Unknown Patient";
    setActionConfirm({
      appointmentId,
      patientName: String(targetName),
      action,
    });
  }

  function openPreviousStatusConfirm(row: UpcomingRow, action: "confirmed" | "cancelled" | "no_show") {
    if (!row.dentistId) {
      setActionResult({
        tone: "error",
        title: "Dentist Required",
        message: "Please select dentist and try again.",
      });
      return;
    }

    openStatusConfirm(String(row.id || ""), action);
  }

  async function runStatusAction(appointmentId: string, action: "confirmed" | "cancelled" | "no_show") {
    setActionLoading({ appointmentId, action });
    setErr(null);
    setSuccessMsg(null);
    setActionConfirm(null);

    const busyPatch =
      action === "confirmed"
        ? { confirming: true }
        : action === "cancelled"
        ? { cancelling: true }
        : { noShowing: true };
    setRowBusy(appointmentId, busyPatch);

    const successMessage =
      action === "confirmed"
        ? "Appointment confirmed."
        : action === "cancelled"
        ? "Appointment cancelled."
        : "Appointment marked as no show.";
    const failureMessage =
      action === "confirmed"
        ? "Failed to confirm appointment."
        : action === "cancelled"
        ? "Failed to cancel appointment."
        : "Failed to mark appointment as no show.";

    try {
      const res = await updateAppointmentStatusAction(appointmentId, action);
      if (!res?.success) throw new Error(res?.error || failureMessage);

      setSuccessMsg(successMessage);
      setActionResult({
        tone: "success",
        title: "Success",
        message: successMessage,
      });
      await fetchUpcoming();
    } catch (e: any) {
      const message = e?.message || failureMessage;
      setErr(message);
      setActionResult({
        tone: "error",
        title: "Update Failed",
        message,
      });
    } finally {
      setActionLoading(null);
      setRowBusy(
        appointmentId,
        action === "confirmed"
          ? { confirming: false }
          : action === "cancelled"
          ? { cancelling: false }
          : { noShowing: false }
      );
    }
  }

  async function handleDelete(appointmentId: string) {
    const targetName =
      visibleRows.find((row) => String(row.id || "") === appointmentId)?.patientName ||
      "Unknown Patient";
    setDeleteTarget({ id: appointmentId, patientName: String(targetName) });
  }

  async function confirmDelete() {
    if (!deleteTarget) return;

    setDeleteTarget(null);
    setDeleteLoading(true);
    setRowBusy(deleteTarget.id, { deleting: true });
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
      await fetchUpcoming();
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
      setRowBusy(deleteTarget.id, { deleting: false });
    }
  }

  function openRescheduleModal(a: AppointmentWithPatient) {
    setReschedAppt(a);
    setReschedOpen(true);
  }

  const rangeOptions = view === "previous" ? PREVIOUS_RANGE_OPTIONS : UPCOMING_RANGE_OPTIONS;

  return (
    <div className="relative bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      {actionLoading ? (
        <ProcessingModal
          title="Processing"
          message={
            actionLoading.action === "confirmed"
              ? "Confirming appointment..."
              : actionLoading.action === "cancelled"
              ? "Cancelling appointment..."
              : "Updating appointment status..."
          }
        />
      ) : null}
      {deleteLoading ? <ActionLoadingOverlay message="Deleting appointment..." /> : null}
      <div className="px-6 py-4 border-b border-slate-100 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-extrabold text-slate-900">
            {view === "completed"
              ? "Completed"
              : view === "previous"
              ? "Previous Bookings"
              : view === "cancelled"
              ? "Cancelled"
              : view === "no_show"
              ? "No Show"
              : "Upcoming"}
          </h3>
          <p className="text-sm text-slate-500">
            {view === "completed"
              ? "Completed appointments list"
              : view === "previous"
              ? "Past bookings so staff can review finished, cancelled, and no-show visits"
              : view === "cancelled"
              ? "Cancelled appointments list"
              : view === "no_show"
              ? "No show appointments list"
              : "Appointments with doctor assignment and actions"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={filterMode}
            onChange={(e) => setFilterMode(e.target.value as FilterMode)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
          >
            <option value="rolling">Rolling range</option>
            <option value="month">Specific month</option>
          </select>

          {filterMode === "month" ? (
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
            />
          ) : (
            <select
              value={range}
              onChange={(e) => setRange(e.target.value as RangeValue)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
            >
              {rangeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          )}

          <input
            type="search"
            value={searchName}
            onChange={(e) => setSearchName(e.target.value)}
            placeholder="Search patient name"
            className="min-w-[210px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-300"
          />

          <button
            onClick={fetchUpcoming}
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
        ) : visibleRows.length === 0 ? (
          <p className="text-sm text-slate-500 italic">
            {searchName.trim() && hasRowsForView
              ? "No appointments match that patient name."
              : view === "completed"
              ? "No completed appointments."
              : view === "previous"
              ? "No previous bookings found."
              : view === "cancelled"
              ? "No cancelled appointments."
              : view === "no_show"
              ? "No no show appointments."
              : "No upcoming appointments."}
          </p>
        ) : (
          <div className="space-y-3">
            {visibleRows.map((a) => {
              const id = String(a.id || "");
              const status = String(a.status || "pending").toLowerCase();

              const isCancelled = status === "cancelled";
              const isCompleted = status === "completed";
              const isNoShow = status === "no_show";
              const isConfirmed = status === "confirmed";
              const isPrevious = view === "previous";

              const isBusy =
                !!busy[id]?.assigning ||
                !!busy[id]?.confirming ||
                !!busy[id]?.cancelling ||
                !!busy[id]?.noShowing ||
                !!busy[id]?.deleting;

              return (
                <div
                  key={`${a.dateStr}-${id}`}
                  className="rounded-2xl border border-slate-200 px-5 py-4"
                >
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    {/* LEFT: Patient + time */}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-extrabold text-slate-900 truncate">
                          {a.patientName || "Unknown Patient"}
                        </p>
                        <span className={pillClass(a.status || "pending")}>
                          {String(a.status || "pending").replaceAll("_", " ").toUpperCase()}
                        </span>
                      </div>

                      <p className="text-sm text-slate-700 mt-1">
                        {parseLocalYMD(a.dateStr).toLocaleDateString(undefined, {
                          month: "short",
                          day: "2-digit",
                          year: "numeric",
                        })}
                        {a.time ? ` • ${formatTime12h(a.time)}` : ""}
                        {a.serviceType ? ` • ${a.serviceType}` : ""}
                      </p>
                    </div>

                    {/* RIGHT: Assign dropdown */}
                    <div className="w-full md:max-w-[320px]">
                      <label className="text-xs font-extrabold text-slate-600">
                        {isPrevious ? "Assigned Doctor" : "Assign Doctor"}
                      </label>

                      <select
                        className={`${inputBase} mt-1`}
                        value={a.dentistId || ""}
                        disabled={isBusy || isCancelled || isCompleted || isNoShow}
                        onChange={(e) => handleAssign(id, e.target.value)}
                      >
                        <option value="">Select dentist…</option>
                        {dentistOptions.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.label}
                          </option>
                        ))}
                      </select>

                      {busy[id]?.assigning ? (
                        <p className="mt-2 text-xs text-slate-500">Assigning...</p>
                      ) : null}
                    </div>
                  </div>

                  {/* ACTIONS */}
                  {!isPrevious ? (
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => openStatusConfirm(id, "confirmed")}
                        disabled={isBusy || isCancelled || isCompleted || isNoShow || isConfirmed}
                        className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-extrabold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {busy[id]?.confirming ? "Confirming..." : "Confirm"}
                      </button>

                      <button
                        onClick={() => openStatusConfirm(id, "cancelled")}
                        disabled={isBusy || isCancelled || isCompleted || isNoShow}
                        className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-extrabold text-rose-800 hover:bg-rose-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {busy[id]?.cancelling ? "Cancelling..." : "Cancel"}
                      </button>

                      <button
                        onClick={() => openStatusConfirm(id, "no_show")}
                        disabled={isBusy || isCancelled || isCompleted || isNoShow}
                        className="rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-xs font-extrabold text-orange-800 hover:bg-orange-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {busy[id]?.noShowing ? "Saving..." : "No Show"}
                      </button>

                      <button
                         onClick={() => openRescheduleModal(a)}  
                        disabled={isBusy || isCancelled || isCompleted || isNoShow}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-extrabold text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Reschedule
                      </button>

                      {canDelete ? (
                        <button
                          onClick={() => handleDelete(id)}
                          disabled={isBusy}
                          className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-extrabold text-red-700 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {busy[id]?.deleting ? "Deleting..." : "Delete"}
                        </button>
                      ) : null}

                      {isCompleted && onOpenBilling ? (
                        <button
                          type="button"
                          onClick={() => onOpenBilling(id)}
                          disabled={isBusy}
                          className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-extrabold text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Billing
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openPreviousStatusConfirm(a, "confirmed")}
                        disabled={isBusy || isCancelled || isCompleted || isNoShow || isConfirmed}
                        title={!a.dentistId ? "Please select dentist and try again." : ""}
                        className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-extrabold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {busy[id]?.confirming ? "Confirming..." : "Confirm"}
                      </button>

                      <button
                        type="button"
                        onClick={() => openPreviousStatusConfirm(a, "cancelled")}
                        disabled={isBusy || isCancelled || isCompleted || isNoShow}
                        title={!a.dentistId ? "Please select dentist and try again." : ""}
                        className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-extrabold text-rose-800 hover:bg-rose-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {busy[id]?.cancelling ? "Cancelling..." : "Cancel"}
                      </button>

                      <button
                        onClick={() => openPreviousStatusConfirm(a, "no_show")}
                        disabled={isBusy || isCancelled || isCompleted || isNoShow}
                        title={!a.dentistId ? "Please select dentist and try again." : ""}
                        className="rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-xs font-extrabold text-orange-800 hover:bg-orange-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {busy[id]?.noShowing ? "Saving..." : "No Show"}
                      </button>

                      <button
                        type="button"
                        title={previousRescheduleMessage}
                        aria-disabled="true"
                        className="cursor-not-allowed rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-extrabold text-slate-700 opacity-50"
                      >
                        Reschedule
                      </button>

                      {canDelete ? (
                        <button
                          onClick={() => handleDelete(id)}
                          disabled={isBusy}
                          className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-extrabold text-red-700 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {busy[id]?.deleting ? "Deleting..." : "Delete"}
                        </button>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
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

      {actionConfirm ? (
        <ConfirmActionModal
          title="Confirm action"
          message={
            actionConfirm.action === "confirmed"
              ? "Are you sure you want to confirm this appointment?"
              : actionConfirm.action === "cancelled"
              ? "Are you sure you want to cancel this appointment?"
              : "Are you sure you want to mark this appointment as no show?"
          }
          details={
            <p className="text-sm text-slate-600">
              Patient: <span className="font-bold text-slate-900">{actionConfirm.patientName}</span>
            </p>
          }
          confirmLabel={
            actionConfirm.action === "confirmed"
              ? "Confirm"
              : actionConfirm.action === "cancelled"
              ? "Cancel Appointment"
              : "Mark No Show"
          }
          tone={actionConfirm.action === "cancelled" ? "danger" : "default"}
          onCancel={() => setActionConfirm(null)}
          onConfirm={async () => {
            await runStatusAction(actionConfirm.appointmentId, actionConfirm.action);
          }}
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

      {actionResult ? (
        <ResultModal
          tone={actionResult.tone}
          title={actionResult.title}
          message={actionResult.message}
          onClose={() => setActionResult(null)}
        />
      ) : null}

      {/* Reschedule Modal */}
      <ReschuleBookAppointmentModal
        open={reschedOpen}
        appointment={
          reschedAppt
            ? ({
                ...reschedAppt,
                // your list uses dateStr, modal expects date
                date: (reschedAppt as any).date ?? (reschedAppt as any).dateStr,
              } as any)
            : null
        }
        onClose={() => {
          setReschedOpen(false);
          setReschedAppt(null);
        }}
        onRescheduled={fetchUpcoming}
      />

    </div>

  );
}
