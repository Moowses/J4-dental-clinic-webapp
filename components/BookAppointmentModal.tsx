"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/hooks/useAuth";
import {
  bookAppointmentAction,
  CalendarAvailability,
  getAvailabilityAction,
} from "@/app/actions/appointment-actions";
import {
  ConfirmActionModal,
  ProcessingModal,
} from "@/components/admin/ActionFeedbackModals";

import { getAllProcedures } from "@/lib/services/clinic-service";
import type { DentalProcedure } from "@/lib/types/clinic";

const BRAND = "#0E4B5A";
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TIME_SLOTS = ["08:00", "09:00", "10:00", "11:00", "13:00", "14:00", "15:00", "16:00"];

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function toISODate(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function addDays(d: Date, days: number) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}
function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function monthLabel(d: Date) {
  return d.toLocaleString(undefined, { month: "long", year: "numeric" });
}
function formatTime12h(t: string) {
  const parts = String(t || "").split(":");
  if (parts.length < 2) return t;
  const hh = Number(parts[0]);
  const mm = parts[1];
  if (!Number.isFinite(hh)) return t;
  const hour = ((hh + 11) % 12) + 1;
  const suffix = hh >= 12 ? "PM" : "AM";
  return `${hour}:${mm} ${suffix}`;
}
function buildMonthGrid(viewDate: Date) {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  const firstOfMonth = new Date(year, month, 1);
  const startWeekday = firstOfMonth.getDay();
  const gridStart = new Date(year, month, 1 - startWeekday);

  const cells: { date: Date; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    cells.push({ date: d, inMonth: d.getMonth() === month });
  }
  return cells;
}

function SlotButton({
  time,
  disabled,
  selected,
  onClick,
}: {
  time: string;
  disabled: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  const base =
    "w-full rounded-xl border px-3 py-3 text-sm font-bold transition focus:outline-none focus:ring-2 focus:ring-offset-2";

  if (disabled) {
    return (
      <button type="button" disabled className={`${base} border-slate-200 bg-slate-50 text-slate-400`}>
        {formatTime12h(time)} <span className="ml-2 text-xs font-extrabold">(Booked)</span>
      </button>
    );
  }

  if (selected) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${base} border-transparent text-white`}
        style={{ backgroundColor: BRAND }}
      >
        {formatTime12h(time)} <span className="ml-2 text-xs font-extrabold">(Selected)</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`${base} border-slate-200 bg-white text-slate-800 hover:bg-slate-50`}
    >
      {formatTime12h(time)}
    </button>
  );
}

export default function BookAppointmentModal({
  open,
  onClose,
  onBooked,
}: {
  open: boolean;
  onClose: () => void;
  onBooked: () => void;
}) {
  const { user } = useAuth();
  const router = useRouter();

  const [state, formAction, isPending] = useActionState(bookAppointmentAction, { success: false, error: "" });
  const formRef = useRef<HTMLFormElement | null>(null);
  const confirmSubmitRef = useRef(false);

  const today = useMemo(() => startOfDay(new Date()), []);
  const minBookDate = useMemo(() => addDays(today, 1), [today]);
  const [viewDate, setViewDate] = useState<Date>(() => startOfDay(new Date()));
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [selectedTime, setSelectedTime] = useState<string>("");
  const [availability, setAvailability] = useState<CalendarAvailability | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [clientError, setClientError] = useState<string>("");
  const successHandledRef = useRef(false);
  const gridCells = useMemo(() => buildMonthGrid(viewDate), [viewDate]);
  const taken = useMemo(() => new Set(availability?.takenSlots || []), [availability]);
  const isHoliday = availability?.isHoliday ?? false;
  const [fullName, setFullName] = useState("");
  const isLoggedIn = !!user;
  const [procedures, setProcedures] = useState<DentalProcedure[]>([]);
  const [procLoading, setProcLoading] = useState(false);
  const [procError, setProcError] = useState("");
  const [mobileStep, setMobileStep] = useState<1 | 2>(1);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Load availability on date change
  useEffect(() => {
    if (!selectedDate) {
      setAvailability(null);
      setSelectedTime("");
      return;
    }

    let cancelled = false;
    setLoadingSlots(true);
    setSelectedTime("");

    getAvailabilityAction(selectedDate)
      .then((res) => {
        if (!cancelled) setAvailability(res);
      })
      .finally(() => {
        if (!cancelled) setLoadingSlots(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedDate]);

  // Reset on open/close
  useEffect(() => {
    if (!open) {
      setSelectedDate("");
      setSelectedTime("");
      setAvailability(null);
      setLoadingSlots(false);
      setClientError("");
      setViewDate(startOfDay(new Date()));
      setProcError("");
      setMobileStep(1);
      setConfirmOpen(false);
      return;
    }

    successHandledRef.current = false;
    setClientError("");
    setMobileStep(1);

    // auto-fill name on open
    setFullName(user?.displayName || "");
  }, [open, user?.displayName]);

  // Load procedures for dropdown (active only)
  useEffect(() => {
    if (!open) return;
    if (procedures.length > 0) return;

    let cancelled = false;
    setProcLoading(true);
    setProcError("");

    getAllProcedures(true)
      .then((res: any) => {
        if (cancelled) return;
        if (res.success && res.data) {
          setProcedures(res.data as DentalProcedure[]);
        } else {
          setProcError(res.error || "Failed to load services");
        }
      })
      .catch((e: any) => {
        if (!cancelled) setProcError(e?.message || "Failed to load services");
      })
      .finally(() => {
        if (!cancelled) setProcLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, procedures.length]);

  // Handle success
  useEffect(() => {
    if (!state.success) return;
    if (successHandledRef.current) return;

    successHandledRef.current = true;

    try {
      onBooked();
    } catch {}

    onClose();
    router.refresh();
  }, [state.success, onBooked, onClose, router]);

  if (!open) return null;

  const selectedDateObj = selectedDate ? new Date(selectedDate + "T00:00:00") : null;

  const canSubmit =
    !!selectedDate &&
    !!selectedTime &&
    !isHoliday &&
    !isPending &&
    !taken.has(selectedTime) &&
    (!procError && !procLoading);
  const canProceedToDetails = !!selectedDate && !!selectedTime && !isHoliday;

  const goPrevMonth = () => setViewDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  const goNextMonth = () => setViewDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-5xl max-h-[94vh] overflow-y-auto rounded-2xl bg-white shadow-2xl ring-1 ring-black/5">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
          <div>
            <h3 className="text-lg font-extrabold text-slate-900">Book an Appointment</h3>
            <p className="mt-1 text-xs text-slate-500">Choose a date (tomorrow onwards), then pick a time slot.</p>
            <p className="mt-2 text-xs font-semibold text-slate-600 md:hidden">
              Step {mobileStep} of 2: {mobileStep === 1 ? "Date & Time" : "Appointment Details"}
            </p>
          </div>

          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {isPending ? <ProcessingModal title="Processing" message="Booking appointment..." /> : null}
        <div className="grid grid-cols-1 md:grid-cols-[1.2fr_1fr]">
          {/* Left: Calendar + slots */}
          <div className={`${mobileStep === 1 ? "block" : "hidden md:block"} p-4 md:p-6 md:border-r border-slate-100`}>
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={goPrevMonth}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                ←
              </button>

              <div className="text-center">
                <p className="text-sm font-extrabold text-slate-900">{monthLabel(viewDate)}</p>
                <p className="text-xs text-slate-500">Same-day booking is not allowed</p>
              </div>

              <button
                type="button"
                onClick={goNextMonth}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                →
              </button>
            </div>

            <div className="mt-4 grid grid-cols-7 gap-2">
              {WEEKDAYS.map((w) => (
                <div key={w} className="text-center text-xs font-extrabold text-slate-500">
                  {w}
                </div>
              ))}
            </div>

            <div className="mt-2 grid grid-cols-7 gap-2">
              {gridCells.map(({ date, inMonth }, idx) => {
                const d0 = startOfDay(date);

                const isTooEarly = d0.getTime() < minBookDate.getTime();
                const isToday = isSameDay(d0, today);
                const isSelected = selectedDateObj ? isSameDay(d0, selectedDateObj) : false;

                const base = "h-10 rounded-xl border text-sm font-bold transition focus:outline-none";
                const classes = isTooEarly
                  ? `${base} border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed`
                  : isSelected
                  ? `${base} border-transparent text-white`
                  : `${base} border-slate-200 bg-white text-slate-800 hover:bg-slate-50`;

                return (
                  <button
                    key={idx}
                    type="button"
                    disabled={isTooEarly}
                    onClick={() => {
                      setClientError("");
                      setSelectedDate(toISODate(d0));
                      setSelectedTime("");
                    }}
                    className={classes}
                    style={isSelected ? { backgroundColor: BRAND } : undefined}
                    aria-label={toISODate(d0)}
                    title={isTooEarly ? "Appointments must be booked at least 1 day in advance." : ""}
                  >
                    <span className={`${!inMonth ? "opacity-40" : ""}`}>{d0.getDate()}</span>
                    {isToday && !isSelected && (
                      <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 align-middle" />
                    )}
                  </button>
                );
              })}
            </div>

            <div className="mt-6">
              <div className="flex items-center justify-between">
                <p className="text-xs font-extrabold text-slate-600">Time slots</p>
                {loadingSlots && <span className="text-xs font-semibold text-slate-500">Loading...</span>}
              </div>

              {!selectedDate && (
                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                  Select a date from the calendar to view slots.
                </div>
              )}

              {selectedDate && isHoliday && (
                <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
                  Clinic is closed on this day
                  {availability?.holidayReason ? `: ${availability.holidayReason}` : "."}
                </div>
              )}

              {selectedDate && !isHoliday && (
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {TIME_SLOTS.map((t) => (
                    <SlotButton
                      key={t}
                      time={t}
                      disabled={taken.has(t)}
                      selected={selectedTime === t}
                      onClick={() => {
                        setClientError("");
                        setSelectedTime(t);
                      }}
                    />
                  ))}
                </div>
              )}

              {selectedDate && !isHoliday && selectedTime && (
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                  Selected: <span className="font-extrabold">{selectedDate} • {selectedTime}</span>
                </div>
              )}
              <div className="mt-4 md:hidden">
                <button
                  type="button"
                  onClick={() => setMobileStep(2)}
                  disabled={!canProceedToDetails}
                  className="w-full rounded-xl px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
                  style={{ backgroundColor: BRAND }}
                >
                  Continue to Details
                </button>
              </div>
            </div>
          </div>

          {/* Right: Details + submit */}
          <div className={`${mobileStep === 2 ? "block" : "hidden md:block"} p-4 md:p-6`}>
            <form
              ref={formRef}
              action={formAction}
              className="space-y-4"
              onSubmit={(e) => {
                if (selectedDate) {
                  const sel = startOfDay(new Date(selectedDate + "T00:00:00"));
                  if (sel.getTime() < minBookDate.getTime()) {
                    e.preventDefault();
                    setClientError(
                      "Appointments must be booked at least 1 day in advance. Please select a future date."
                    );
                    return;
                  }
                }

                // If guest, require name
                if (!isLoggedIn && !fullName.trim()) {
                  e.preventDefault();
                  setClientError("Please enter your full name.");
                  return;
                }

                if (confirmSubmitRef.current) {
                  confirmSubmitRef.current = false;
                  return;
                }

                e.preventDefault();
                setConfirmOpen(true);
              }}
            >
              <div className="md:hidden">
                <button
                  type="button"
                  onClick={() => setMobileStep(1)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  Back to Date & Time
                </button>
              </div>
              <input type="hidden" name="date" value={selectedDate} />
              <input type="hidden" name="time" value={selectedTime} />
              <input type="hidden" name="displayName" value={fullName} />

              <div>
                <label className="text-xs font-bold text-slate-600">Full Name</label>
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  disabled={isLoggedIn}
                  placeholder="Your full name"
                  className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-slate-300 disabled:bg-slate-50 disabled:text-slate-600"
                />
                {isLoggedIn ? (
                  <p className="mt-1 text-xs text-slate-500">
                    This is taken from your account and can’t be edited here.
                  </p>
                ) : null}
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600">Service Type</label>
                <select
                  name="serviceType"
                  required
                  disabled={procLoading || !!procError}
                  className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-slate-300 disabled:bg-slate-50 disabled:text-slate-500"
                >
                  <option value="">
                    {procLoading ? "Loading services..." : "Select Service"}
                  </option>

                  {/* ✅ Title only (no price) */}
                  {procedures.map((p: any) => (
                    <option key={p.id} value={p.name || "Service"}>
                      {p.name || "Service"}
                    </option>
                  ))}
                </select>

                {procError ? (
                  <p className="mt-2 text-xs font-semibold text-red-600">{procError}</p>
                ) : null}
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600">Notes</label>
                <textarea
                  name="notes"
                  placeholder="Additional notes..."
                  className="mt-2 h-28 w-full resize-none rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-slate-300"
                />
              </div>

              {(clientError || (state as any).error) && (
                <p className="text-sm font-bold text-red-600 text-center">
                  {clientError || (state as any).error}
                </p>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 hover:bg-slate-50"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="flex-1 rounded-xl px-4 py-3 text-sm font-bold text-white hover:opacity-95 disabled:opacity-60"
                  style={{ backgroundColor: BRAND }}
                >
                  {isPending ? "Booking..." : "Confirm Booking"}
                </button>
              </div>

              <p className="text-xs text-slate-500">
                Note: Same-day appointments are not allowed. Please book at least 1 day in advance.
              </p>
            </form>
          </div>
        </div>
      </div>
      {confirmOpen ? (
        <ConfirmActionModal
          title="Confirm booking"
          message="Are you sure you want to book this appointment?"
          details={
            <div className="space-y-1 text-sm text-slate-600">
              <p>
                Date: <span className="font-bold text-slate-900">{selectedDate || "N/A"}</span>
              </p>
              <p>
                Time: <span className="font-bold text-slate-900">{selectedTime ? formatTime12h(selectedTime) : "N/A"}</span>
              </p>
            </div>
          }
          confirmLabel="Confirm Booking"
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => {
            setConfirmOpen(false);
            confirmSubmitRef.current = true;
            formRef.current?.requestSubmit();
          }}
        />
      ) : null}
    </div>
  );
}
