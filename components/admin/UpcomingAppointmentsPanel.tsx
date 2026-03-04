"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { formatTime12h } from "@/lib/utils/time";
import {
  getClinicScheduleAction,
  assignDentistAction,
  updateAppointmentStatusAction,
  AppointmentWithPatient,
} from "@/app/actions/appointment-actions";
import { getDentistListAction } from "@/app/actions/dentist-actions";
import ReschuleBookAppointmentModal from "@/components/ReschuleBookAppointmentModal";
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

type UpcomingRow = AppointmentWithPatient & { dateStr: string };

type BusyMap = Record<
  string,
  { assigning?: boolean; confirming?: boolean; cancelling?: boolean; noShowing?: boolean }
>;

const inputBase =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-300";
const PROCEED_PROMPT = "Are you sure to proceed?";

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

export default function UpcomingAppointmentsPanel({
  view = "upcoming",
}: {
  view?: "upcoming" | "completed" | "cancelled" | "no_show";
}) {
  const [days, setDays] = useState<7 | 14 | 30>(14);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [dentists, setDentists] = useState<UserProfile[]>([]);
  const [rows, setRows] = useState<UpcomingRow[]>([]);
  const [busy, setBusy] = useState<BusyMap>({});

  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [reschedOpen, setReschedOpen] = useState(false);
const [reschedAppt, setReschedAppt] = useState<AppointmentWithPatient | null>(null);

  

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
      const start = new Date();
      const dates: string[] = [];
      for (let i = 0; i < days; i++) dates.push(formatLocalYMD(addDays(start, i)));

      const concurrency = 6;
      let idx = 0;
      const results: UpcomingRow[] = [];

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

      results.sort((a, b) => {
        const da = a.dateStr.localeCompare(b.dateStr);
        if (da !== 0) return da;
        return String(a.time || "").localeCompare(String(b.time || ""));
      });

      setRows(results);
    } catch (e: any) {
      setErr(e?.message || "Failed to load upcoming appointments.");
    } finally {
      setLoading(false);
    }
  }, [days]);

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
    if (view === "completed") {
      return rows.filter((a) => getStatus(a) === "completed");
    }
    if (view === "cancelled") {
      return rows.filter((a) => getStatus(a) === "cancelled");
    }
    if (view === "no_show") {
      return rows.filter((a) => getStatus(a) === "no_show");
    }
    return rows.filter((a) => {
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

  async function handleConfirm(appointmentId: string) {
    if (typeof window !== "undefined" && !window.confirm(PROCEED_PROMPT)) return;

    setRowBusy(appointmentId, { confirming: true });
    setErr(null);
    setSuccessMsg(null);

    try {
      const res = await updateAppointmentStatusAction(appointmentId, "confirmed");
      if (!res?.success) throw new Error(res?.error || "Failed to confirm appointment.");

      setSuccessMsg("Appointment confirmed.");
      await fetchUpcoming();
    } catch (e: any) {
      setErr(e?.message || "Failed to confirm appointment.");
    } finally {
      setRowBusy(appointmentId, { confirming: false });
    }
  }

  async function handleCancel(appointmentId: string) {
    if (typeof window !== "undefined" && !window.confirm(PROCEED_PROMPT)) return;

    setRowBusy(appointmentId, { cancelling: true });
    setErr(null);
    setSuccessMsg(null);

    try {
      const res = await updateAppointmentStatusAction(appointmentId, "cancelled");
      if (!res?.success) throw new Error(res?.error || "Failed to cancel appointment.");

      setSuccessMsg("Appointment cancelled.");
      await fetchUpcoming();
    } catch (e: any) {
      setErr(e?.message || "Failed to cancel appointment.");
    } finally {
      setRowBusy(appointmentId, { cancelling: false });
    }
  }

  async function handleNoShow(appointmentId: string) {
    setRowBusy(appointmentId, { noShowing: true });
    setErr(null);
    setSuccessMsg(null);

    try {
      const res = await updateAppointmentStatusAction(appointmentId, "no_show");
      if (!res?.success) throw new Error(res?.error || "Failed to mark appointment as no show.");

      setSuccessMsg("Appointment marked as no show.");
      await fetchUpcoming();
    } catch (e: any) {
      setErr(e?.message || "Failed to mark appointment as no show.");
    } finally {
      setRowBusy(appointmentId, { noShowing: false });
    }
  }

 function openRescheduleModal(a: AppointmentWithPatient) {
  setReschedAppt(a);
  setReschedOpen(true);
}

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-extrabold text-slate-900">
            {view === "completed"
              ? "Completed"
              : view === "cancelled"
              ? "Cancelled"
              : view === "no_show"
              ? "No Show"
              : "Upcoming"}
          </h3>
          <p className="text-sm text-slate-500">
            {view === "completed"
              ? "Completed appointments list"
              : view === "cancelled"
              ? "Cancelled appointments list"
              : view === "no_show"
              ? "No show appointments list"
              : "Appointments with doctor assignment and actions"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value) as 7 | 14 | 30)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
          >
            <option value={7}>Next 7 days</option>
            <option value={14}>Next 14 days</option>
            <option value={30}>Next 30 days</option>
          </select>

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
            {view === "completed"
              ? "No completed appointments."
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

              const isBusy =
                !!busy[id]?.assigning ||
                !!busy[id]?.confirming ||
                !!busy[id]?.cancelling ||
                !!busy[id]?.noShowing;

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
                        Assign Doctor
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
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => handleConfirm(id)}
                      disabled={isBusy || isCancelled || isCompleted || isNoShow || isConfirmed}
                      className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-extrabold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {busy[id]?.confirming ? "Confirming..." : "Confirm"}
                    </button>

                    <button
                      onClick={() => handleCancel(id)}
                      disabled={isBusy || isCancelled || isCompleted || isNoShow}
                      className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-extrabold text-rose-800 hover:bg-rose-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {busy[id]?.cancelling ? "Cancelling..." : "Cancel"}
                    </button>

                    <button
                      onClick={() => handleNoShow(id)}
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
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
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
