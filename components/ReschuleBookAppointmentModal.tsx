"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  getAvailabilityAction,
  rescheduleAppointmentAction,
} from "@/app/actions/appointment-actions";

type AppointmentLike = {
  id: string;
  patientName?: string;
  patientId?: string;
  serviceType?: string;
  date?: string; // "YYYY-MM-DD"
  time?: string; // "HH:mm"
  dentistId?: string | null;
  status?: string;
  rescheduleCount?: number;
};

type Props = {
  open: boolean;
  appointment: AppointmentLike | null;
  enforceThreeHourRule?: boolean;
  onClose: () => void;
  onRescheduled?: () => void;
};

function formatPrettyDate(ymd?: string) {
  if (!ymd) return "—";
  const d = new Date(`${ymd}T00:00:00`);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function toYMD(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function getTodayYMD() {
  return toYMD(new Date());
}

function timeToMinutes(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function formatTime12h(t?: string) {
  const value = String(t || "");
  const parts = value.split(":");
  if (parts.length < 2) return value || "—";
  const hh = Number(parts[0]);
  const mm = parts[1];
  if (!Number.isFinite(hh)) return value || "—";
  const hour = ((hh + 11) % 12) + 1;
  const suffix = hh >= 12 ? "PM" : "AM";
  return `${hour}:${mm} ${suffix}`;
}

function generateTimeSlots(start = "08:00", end = "17:00", stepMinutes = 60) {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);

  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;

  const slots: string[] = [];
  for (let t = startMin; t <= endMin; t += stepMinutes) {
    const hh = String(Math.floor(t / 60)).padStart(2, "0");
    const mm = String(t % 60).padStart(2, "0");
    slots.push(`${hh}:${mm}`);
  }
  return slots;
}

// Calendar helpers
function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
function addMonths(d: Date, months: number) {
  return new Date(d.getFullYear(), d.getMonth() + months, 1);
}
function isSameYMD(a: string, b: string) {
  return a === b;
}

const inputBase =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-300";
const PROCEED_PROMPT = "Are you sure to proceed?";

export default function ReschuleBookAppointmentModal({
  open,
  appointment,
  enforceThreeHourRule = false,
  onClose,
  onRescheduled,
}: Props) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [rescheduleReason, setRescheduleReason] = useState("");

  const [loadingAvail, setLoadingAvail] = useState(false);
  const [takenSlots, setTakenSlots] = useState<string[]>([]);
  const [holidayReason, setHolidayReason] = useState<string | null>(null);
  const [isHoliday, setIsHoliday] = useState(false);

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [mobileStep, setMobileStep] = useState<1 | 2>(1);

  const currentDate = appointment?.date || "";
  const currentTime = appointment?.time || "";

  // ✅ hourly slots
  const allSlots = useMemo(() => generateTimeSlots("08:00", "17:00", 60), []);

  const status = String(appointment?.status || "pending").toLowerCase();
  const rescheduleCount = Number(appointment?.rescheduleCount || 0);
  const isConfirmed = status === "confirmed";
  const statusBlocked = status === "cancelled" || status === "completed";
  const leadTimeBlockedReason = useMemo(() => {
    if (!enforceThreeHourRule || !appointment?.date || !appointment?.time) return null;

    const [y, m, d] = String(appointment.date).split("-").map((v) => parseInt(v, 10));
    const [hh, mm] = String(appointment.time).split(":").map((v) => parseInt(v, 10));
    if (!y || !m || !d || Number.isNaN(hh) || Number.isNaN(mm)) return null;

    const apptDate = new Date(y, m - 1, d, hh, mm, 0, 0);
    const diffMs = apptDate.getTime() - Date.now();
    const diffHours = diffMs / (1000 * 60 * 60);

    if (diffMs < 0) {
      return "This appointment has already started/passed. Please call front desk.";
    }
    if (diffHours <= 3) {
      return "You can't reschedule your appointment 3 hours before your appointment. Please call front desk about this.";
    }
    return null;
  }, [appointment?.date, appointment?.time, enforceThreeHourRule]);
  const rescheduleBlocked =
    statusBlocked || Boolean(leadTimeBlockedReason) || rescheduleCount >= 1;

  const todayYMD = useMemo(() => getTodayYMD(), []);

  // keep now updated while modal open (for time blocking)
  const [nowMinutes, setNowMinutes] = useState(() => {
    const n = new Date();
    return n.getHours() * 60 + n.getMinutes();
  });

  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => {
      const n = new Date();
      setNowMinutes(n.getHours() * 60 + n.getMinutes());
    }, 30_000);
    return () => clearInterval(t);
  }, [open]);

  // Month grid state (defaults to selected date month, else current month)
  const [monthCursor, setMonthCursor] = useState<Date>(() => startOfMonth(new Date()));

  // Close on ESC + lock scroll
  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  // Reset fields on open
  useEffect(() => {
    if (!open || !appointment) return;

    setErr(null);
    setOk(null);

    const initialDate = appointment.date || "";
    const initialTime = appointment.time || "";

    setDate(initialDate);
    setTime(initialTime);
    setRescheduleReason("");

    setTakenSlots([]);
    setHolidayReason(null);
    setIsHoliday(false);

    // set calendar month to appointment month if exists
    if (initialDate) {
      const d = new Date(`${initialDate}T00:00:00`);
      setMonthCursor(startOfMonth(d));
    } else {
      setMonthCursor(startOfMonth(new Date()));
    }
    setMobileStep(1);
  }, [open, appointment]);

  // Load availability when date changes
  useEffect(() => {
    let ignore = false;

    async function run() {
      if (!open) return;
      if (!date) return;
      if (rescheduleBlocked) return;

      // ❌ block past date (hard guard)
      if (date < todayYMD) {
        setErr("You can’t choose a past date.");
        setTakenSlots([]);
        setIsHoliday(false);
        setHolidayReason(null);
        setTime("");
        return;
      }

      setLoadingAvail(true);
      setErr(null);

      try {
        const res = await getAvailabilityAction(date);
        if (ignore) return;

        const rawTaken = Array.isArray(res?.takenSlots) ? res.takenSlots : [];

        const isToday = date === todayYMD;

        // ✅ treat past times as “taken” (so UI blocks them)
        // ✅ also remove self-slot from taken list (so it can be selected)
        const filteredTaken = rawTaken
          .map((t: any) => String(t))
          .filter((slot) => {
            // allow current appointment slot if same date
            if (date === currentDate && slot === currentTime) return false;
            return true;
          });

        const computedTaken = isToday
          ? Array.from(
              new Set([
                ...filteredTaken,
                ...allSlots.filter((slot) => timeToMinutes(slot) <= nowMinutes),
              ])
            )
          : filteredTaken;

        setTakenSlots(computedTaken);
        setIsHoliday(!!res?.isHoliday);
        setHolidayReason(res?.holidayReason ?? null);

        // clear invalid selection
        if (time && computedTaken.includes(time)) setTime("");
      } catch (e: any) {
        if (ignore) return;
        setErr(e?.message || "Failed to check availability.");
      } finally {
        if (!ignore) setLoadingAvail(false);
      }
    }

    run();
    return () => {
      ignore = true;
    };
  }, [
    open,
    date,
    currentDate,
    currentTime,
    time,
    rescheduleBlocked,
    todayYMD,
    nowMinutes,
    allSlots,
  ]);

  const canSubmit =
    !!appointment?.id &&
    !!date &&
    !!time &&
    (!isConfirmed || !!rescheduleReason.trim()) &&
    !saving &&
    !loadingAvail &&
    !isHoliday &&
    !rescheduleBlocked &&
    date >= todayYMD;
  const canProceedToTime = !!date && !rescheduleBlocked && !isHoliday;

  async function handleSave() {
    if (!appointment?.id) return;
    const proceed = window.confirm(PROCEED_PROMPT);
    if (!proceed) return;

    setSaving(true);
    setErr(null);
    setOk(null);

    try {
      const res = await rescheduleAppointmentAction(
        appointment.id,
        date,
        time,
        isConfirmed ? rescheduleReason.trim() : undefined
      );
      if (!res?.success) throw new Error(res?.error || "Failed to reschedule appointment.");

      setOk("Appointment rescheduled.");
      onRescheduled?.();
      onClose();
    } catch (e: any) {
      setErr(e?.message || "Failed to reschedule appointment.");
    } finally {
      setSaving(false);
    }
  }

  function buildCalendarCells(cursor: Date) {
    const start = startOfMonth(cursor);
    const end = endOfMonth(cursor);

    const startWeekday = start.getDay(); // 0 Sun ... 6 Sat
    const daysInMonth = end.getDate();

    const cells: Array<{ ymd: string; day: number; inMonth: boolean }> = [];

    // previous month padding
    const prevMonthEnd = new Date(cursor.getFullYear(), cursor.getMonth(), 0);
    const prevDays = prevMonthEnd.getDate();
    for (let i = startWeekday - 1; i >= 0; i--) {
      const day = prevDays - i;
      const d = new Date(cursor.getFullYear(), cursor.getMonth() - 1, day);
      cells.push({ ymd: toYMD(d), day, inMonth: false });
    }

    // this month
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(cursor.getFullYear(), cursor.getMonth(), day);
      cells.push({ ymd: toYMD(d), day, inMonth: true });
    }

    // next month padding to complete 6 rows (42 cells)
    while (cells.length < 42) {
      const idx = cells.length - (startWeekday + daysInMonth);
      const day = idx + 1;
      const d = new Date(cursor.getFullYear(), cursor.getMonth() + 1, day);
      cells.push({ ymd: toYMD(d), day, inMonth: false });
    }

    return cells;
  }

  const calendarCells = useMemo(() => buildCalendarCells(monthCursor), [monthCursor]);

  if (!open || !appointment) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="relative w-full max-w-4xl max-h-[94vh] overflow-y-auto rounded-2xl bg-white shadow-xl border border-slate-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-extrabold text-slate-900">Reschedule Appointment</h3>
            <p className="text-sm text-slate-500 mt-1">
              Choose a new date and time — conflicts and past times are blocked.
            </p>
            <p className="mt-2 text-xs font-semibold text-slate-600 md:hidden">
              Step {mobileStep} of 2: {mobileStep === 1 ? "Pick Date" : "Pick Time"}
            </p>
          </div>

          <button
            onClick={onClose}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Close
          </button>
        </div>

        <div className="p-4 md:p-6">
          {/* Summary */}
          <div className="rounded-2xl border border-slate-200 p-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm font-extrabold text-slate-900">
                  {appointment.patientName || "Unknown Patient"}
                </p>
                <p className="text-sm text-slate-700 mt-1">
                  {appointment.serviceType ? `${appointment.serviceType} • ` : ""}
                  Current: {formatPrettyDate(appointment.date)} {formatTime12h(appointment.time)}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Status:{" "}
                  <span className="font-semibold text-slate-700">
                    {(appointment.status || "pending").toUpperCase()}
                  </span>
                  {appointment.dentistId ? (
                    <>
                      {" "}
                      • Dentist:{" "}
                      <span className="font-semibold text-slate-700">
                        {String(appointment.dentistId)}
                      </span>
                    </>
                  ) : null}
                </p>
              </div>

              <div className="text-xs text-slate-500">
                <p className="font-semibold text-slate-700">Appointment ID</p>
                <p className="mt-1 break-all">{appointment.id}</p>
              </div>
            </div>
          </div>

          {!statusBlocked && leadTimeBlockedReason ? (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              {leadTimeBlockedReason}
            </div>
          ) : null}

          {statusBlocked ? (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              This appointment can’t be rescheduled because it is{" "}
              <span className="font-extrabold">{status.toUpperCase()}</span>.
            </div>
          ) : null}

          {!statusBlocked && rescheduleCount >= 1 ? (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              This appointment has already been rescheduled once. Further online rescheduling is disabled.
            </div>
          ) : null}

          {err ? (
            <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
              {err}
            </div>
          ) : null}

          {ok ? (
            <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
              {ok}
            </div>
          ) : null}

          {isHoliday ? (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              Not available: {holidayReason || "Clinic is closed on this date."}
            </div>
          ) : null}

          {isConfirmed ? (
            <div className="mt-4 rounded-2xl border border-slate-200 p-4">
              <label className="block text-xs font-extrabold text-slate-700">
                Reason for reschedule (required for confirmed appointments)
              </label>
              <textarea
                value={rescheduleReason}
                onChange={(e) => setRescheduleReason(e.target.value)}
                rows={3}
                className={`${inputBase} mt-2`}
                placeholder="Please share why you need to reschedule."
              />
            </div>
          ) : null}

          {/* Pickers */}
          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Calendar Grid */}
            <div className={`${mobileStep === 1 ? "block" : "hidden md:block"} rounded-2xl border border-slate-200 p-4 md:p-5`}>
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setMonthCursor((p) => addMonths(p, -1))}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-extrabold text-slate-700 hover:bg-slate-50"
                >
                  Prev
                </button>

                <div className="text-sm font-extrabold text-slate-900">
                  {monthCursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
                </div>

                <button
                  type="button"
                  onClick={() => setMonthCursor((p) => addMonths(p, 1))}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-extrabold text-slate-700 hover:bg-slate-50"
                >
                  Next
                </button>
              </div>

              <div className="mt-4 grid grid-cols-7 gap-1 text-xs font-extrabold text-slate-500">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                  <div key={d} className="text-center py-1">
                    {d}
                  </div>
                ))}
              </div>

              <div className="mt-2 grid grid-cols-7 gap-1">
                {calendarCells.map((c) => {
                  const isPast = c.ymd < todayYMD;
                  const selected = date && isSameYMD(date, c.ymd);
                  const isToday = c.ymd === todayYMD;

                  const disabled = rescheduleBlocked || isPast;

                  return (
                    <button
                      key={c.ymd}
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        setErr(null);
                        setOk(null);
                        setDate(c.ymd);

                        // if selecting today and current chosen time is already past => clear
                        if (c.ymd === todayYMD && time && timeToMinutes(time) <= nowMinutes) {
                          setTime("");
                        }
                      }}
                      className={[
                        "aspect-square rounded-xl border text-sm font-extrabold transition",
                        selected
                          ? "border-slate-900 bg-slate-900 text-white"
                          : disabled
                          ? "border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed"
                          : c.inMonth
                          ? "border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                          : "border-slate-200 bg-white text-slate-400 hover:bg-slate-50",
                        isToday && !selected && !disabled ? "ring-2 ring-teal-500/20" : "",
                      ].join(" ")}
                      title={isPast ? "Past date" : "Select date"}
                    >
                      {c.day}
                    </button>
                  );
                })}
              </div>

              <div className="mt-4">
                <label className="block text-xs font-extrabold text-slate-700">Selected date</label>
                <input className={`${inputBase} mt-2`} value={date} readOnly />
                <p className="mt-2 text-xs text-slate-500">
                  Past dates are disabled. Pick today or future dates only.
                </p>
              </div>

              <div className="mt-4 md:hidden">
                <button
                  type="button"
                  onClick={() => setMobileStep(2)}
                  disabled={!canProceedToTime}
                  className="w-full rounded-xl border border-slate-900 bg-slate-900 px-4 py-2.5 text-sm font-extrabold text-white disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Continue to Time
                </button>
              </div>
            </div>

            {/* Time Slots */}
            <div className={`${mobileStep === 2 ? "block" : "hidden md:block"} rounded-2xl border border-slate-200 p-4 md:p-5`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-extrabold text-slate-900">Select time</p>
                  <p className="text-xs text-slate-500 mt-1">
                    {loadingAvail
                      ? "Checking availability..."
                      : !date
                      ? "Pick a date first."
                      : isHoliday
                      ? "Clinic is closed."
                      : "Available hourly slots."}
                  </p>
                </div>
              </div>

              <div className="mt-3 md:hidden">
                <button
                  type="button"
                  onClick={() => setMobileStep(1)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  Back to Date
                </button>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
                {allSlots.map((slot) => {
                  const taken = takenSlots.includes(slot);
                  const selected = time === slot;

                  const isToday = date === todayYMD;
                  const isPastTime = isToday ? timeToMinutes(slot) <= nowMinutes : false;

                  const disabled =
                    rescheduleBlocked ||
                    !date ||
                    loadingAvail ||
                    isHoliday ||
                    taken ||
                    isPastTime;

                  return (
                    <button
                      key={slot}
                      type="button"
                      disabled={disabled}
                      onClick={() => setTime(slot)}
                      className={[
                        "rounded-xl border px-2 py-2 text-xs font-extrabold transition",
                        selected
                          ? "border-slate-900 bg-slate-900 text-white"
                          : taken || isPastTime
                          ? "border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed"
                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                        disabled && !(taken || isPastTime) ? "opacity-60 cursor-not-allowed" : "",
                      ].join(" ")}
                      title={taken ? "Taken" : isPastTime ? "Past time" : "Available"}
                    >
                      {formatTime12h(slot)}
                    </button>
                  );
                })}
              </div>

              <p className="mt-3 text-xs text-slate-500">
                Past times are disabled for today. Slots marked as taken are blocked. Your current
                slot remains selectable if you keep the same date.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className={`${mobileStep === 1 ? "hidden md:flex" : "flex"} px-4 md:px-6 py-4 border-t border-slate-100 items-center justify-end gap-2`}>
          <button
            onClick={() => setMobileStep(1)}
            className="md:hidden rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            disabled={saving}
          >
            Back
          </button>
          <button
            onClick={onClose}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            disabled={saving}
          >
            Cancel
          </button>

          <button
            onClick={handleSave}
            disabled={!canSubmit}
            className="rounded-xl border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-extrabold text-white hover:bg-black disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Saving..." : "Save reschedule"}
          </button>
        </div>
      </div>
    </div>
  );
}
