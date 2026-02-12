"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/hooks/useAuth";
import {
  bookAppointmentAction,
  staffBookAppointmentAction,
  CalendarAvailability,
  getAvailabilityAction,
} from "@/app/actions/appointment-actions";
import {
  autoSendPatientPasswordSetupIfVerifiedAction,
  createPatientAccountByStaffAction,
  sendPatientVerificationEmailAction,
  sendUserPasswordResetByEmailAction,
} from "@/app/actions/admin-actions";

import { getAllProcedures } from "@/lib/services/clinic-service";
import type { DentalProcedure } from "@/lib/types/clinic";

import { getUserProfile, searchPatients } from "@/lib/services/user-service";
import type { UserProfile } from "@/lib/types/user";
import { PatientEditModal } from "@/components/admin/PatientRecordsPanel";

const BRAND = "#0E4B5A";
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TIME_SLOTS = ["08:00", "09:00", "10:00", "11:00", "13:00", "14:00", "15:00", "16:00"];

function formatTime12h(time: string) {
  const [hRaw, mRaw] = String(time || "").split(":");
  const h = Number(hRaw);
  const m = Number(mRaw);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return time;
  const period = h >= 12 ? "PM" : "AM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, "0")} ${period}`;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function toISODate(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function monthLabel(d: Date) {
  return d.toLocaleString(undefined, { month: "long", year: "numeric" });
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

function isPastSlotForSelectedDate(selectedISO: string, timeHHMM: string) {
  if (!selectedISO) return false;

  const now = new Date();
  const today = startOfDay(now);
  const selected = startOfDay(new Date(selectedISO + "T00:00:00"));

  if (selected.getTime() < today.getTime()) return true;
  if (selected.getTime() > today.getTime()) return false;

  const [hh, mm] = timeHHMM.split(":").map((x) => parseInt(x, 10));
  const slot = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);
  return slot.getTime() < now.getTime();
}

function SlotButton({
  time,
  disabled,
  selected,
  onClick,
  label,
}: {
  time: string;
  disabled: boolean;
  selected: boolean;
  onClick: () => void;
  label?: string;
}) {
  const base =
    "w-full rounded-xl border px-3 py-3 text-sm font-bold transition focus:outline-none focus:ring-2 focus:ring-offset-2";

  if (disabled) {
    return (
      <button type="button" disabled className={`${base} border-slate-200 bg-slate-50 text-slate-400`}>
        {formatTime12h(time)} <span className="ml-2 text-xs font-extrabold">({label || "Unavailable"})</span>
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

type CreatedPatientAccount = {
  uid: string;
  email: string;
  patientId?: string;
};

type TakenAccountInfo = {
  uid: string;
  email: string;
  emailVerified?: boolean;
};

function CreatePatientAccountModal({
  open,
  onClose,
  idToken,
  suggestedEmail,
  onCreated,
  onProfileCompleted,
}: {
  open: boolean;
  onClose: () => void;
  idToken: string;
  suggestedEmail?: string;
  onCreated: (payload: CreatedPatientAccount) => void;
  onProfileCompleted?: (uid: string) => void | Promise<void>;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState("");
  const [creating, setCreating] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [created, setCreated] = useState<CreatedPatientAccount | null>(null);
  const [emailTaken, setEmailTaken] = useState(false);
  const [takenAccount, setTakenAccount] = useState<TakenAccountInfo | null>(null);
  const [sendingVerify, setSendingVerify] = useState(false);
  const [autoSetupStatus, setAutoSetupStatus] = useState<
    "idle" | "checking" | "waiting_verification" | "sent" | "error"
  >("idle");
  const looksLikeEmail = (value?: string) =>
    Boolean(value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()));

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setEmail(looksLikeEmail(suggestedEmail) ? (suggestedEmail || "").trim() : "");
    setCreating(false);
    setSendingReset(false);
    setMsg("");
    setError("");
    setCreated(null);
    setEmailTaken(false);
    setTakenAccount(null);
    setSendingVerify(false);
    setAutoSetupStatus("idle");
  }, [open]);

  const handleCreate = async () => {
    setCreating(true);
    setError("");
    setMsg("");
    setEmailTaken(false);
    setTakenAccount(null);
    try {
      const res = await createPatientAccountByStaffAction({
        idToken,
        email: email.trim(),
      });
      if (!res?.success) {
        if (res?.code === "EMAIL_TAKEN") {
          setEmailTaken(true);
          setTakenAccount(
            res?.uid && res?.email
              ? {
                  uid: String(res.uid),
                  email: String(res.email),
                  emailVerified: Boolean(res.emailVerified),
                }
              : null
          );
          setError(res?.error || "This email is already taken.");
          return;
        }
        if (res?.uid && res?.email) {
          const payload: CreatedPatientAccount = {
            uid: String(res.uid),
            email: String(res.email),
            patientId: res.patientId ? String(res.patientId) : undefined,
          };
          setCreated(payload);
          setStep(2);
          onCreated(payload);
          setError(res?.error || "Account created, but verification email failed.");
          return;
        }
        setError(res?.error || "Failed to create account.");
        return;
      }
      const payload: CreatedPatientAccount = {
        uid: String(res.uid || ""),
        email: String(res.email || email.trim()),
        patientId: res.patientId ? String(res.patientId) : undefined,
      };
      setCreated(payload);
      setStep(2);
      setMsg(
        "Step 1 completed: verification email sent. After the patient confirms email, send password setup email."
      );
      onCreated(payload);
    } finally {
      setCreating(false);
    }
  };

  const handleSendTakenReset = async () => {
    if (!idToken || !email.trim()) return;
    setSendingReset(true);
    setError("");
    setMsg("");
    try {
      const res = await sendUserPasswordResetByEmailAction({
        idToken,
        email: email.trim(),
      });
      if (!res?.success) {
        setError(res?.error || "Failed to send reset password email.");
        return;
      }
      setMsg("Reset password email sent.");
    } finally {
      setSendingReset(false);
    }
  };

  const handleSendTakenVerify = async () => {
    if (!idToken || !takenAccount?.uid) return;
    setSendingVerify(true);
    setError("");
    setMsg("");
    try {
      const res = await sendPatientVerificationEmailAction({
        idToken,
        targetUid: takenAccount.uid,
      });
      if (!res?.success) {
        setError(res?.error || "Failed to send verification email.");
        return;
      }
      setMsg("Verification email sent.");
    } finally {
      setSendingVerify(false);
    }
  };

  useEffect(() => {
    if (!open || step !== 2 || !created?.uid || !idToken) return;
    let active = true;
    setAutoSetupStatus("checking");

    const run = async () => {
      const res = await autoSendPatientPasswordSetupIfVerifiedAction({
        idToken,
        targetUid: created.uid,
      });
      if (!active) return;
      if (!res?.success) {
        setAutoSetupStatus("error");
        const errMsg = res && "error" in res ? res.error : "";
        setError(errMsg || "Failed to auto-check password setup status.");
        return;
      }
      const setupStatus = "status" in res ? res.status : undefined;
      if (setupStatus === "waiting_verification") {
        setAutoSetupStatus("waiting_verification");
        return;
      }
      if (setupStatus === "sent_now" || setupStatus === "already_sent") {
        setAutoSetupStatus("sent");
        setMsg("Password setup email is ready/sent after email verification.");
      }
    };

    run();
    const t = setInterval(run, 8000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [open, step, created?.uid, idToken]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 p-4">
        <div className="flex w-full max-w-6xl max-h-[92vh] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <p className="text-base font-extrabold text-slate-900">Create Patient Account</p>
              <p className="text-xs text-slate-500">Step {step} of 2</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              aria-label="Close"
            >
              x
            </button>
          </div>

          <div className="space-y-4 overflow-y-auto px-5 py-5">
            {step === 1 ? (
              <>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                  Step 1: Create user account email. We send a verification email first. After email
                  confirmation, send password setup email.
                </div>
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-600">
                    Account Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="patient@email.com"
                    className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-slate-300"
                  />
                </div>

                {emailTaken ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                    This email is already taken. Do you want to send reset password?
                    <div className="mt-2 flex flex-wrap gap-2">
                      {!takenAccount?.emailVerified && takenAccount?.uid ? (
                        <button
                          type="button"
                          onClick={handleSendTakenVerify}
                          disabled={sendingVerify || !idToken}
                          className="rounded-lg border border-amber-300 bg-white px-3 py-1 font-bold text-amber-700 disabled:opacity-60"
                        >
                          {sendingVerify ? "Sending..." : "Send Verification Email"}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={handleSendTakenReset}
                        disabled={sendingReset || !idToken}
                        className="rounded-lg border border-amber-300 bg-white px-3 py-1 font-bold text-amber-700 disabled:opacity-60"
                      >
                        {sendingReset ? "Sending..." : "Send Reset Password"}
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={onClose}
                    className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleCreate}
                    disabled={creating || !idToken || !email.trim()}
                    className="flex-1 rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white hover:bg-black disabled:opacity-60"
                  >
                    {creating ? "Creating..." : "Create Account"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                  Step 2: Complete patient record form below.
                </div>
                <div className="rounded-xl border border-teal-200 bg-teal-50 p-3 text-xs text-teal-800">
                  Patient cannot access the dashboard until email is confirmed and password is set.
                  This flow sends 2 separate emails.
                </div>
                <div className="rounded-xl border border-slate-200 p-3 text-xs text-slate-700">
                  <p>
                    <span className="font-bold">Email:</span> {created?.email || "—"}
                  </p>
                  <p>
                    <span className="font-bold">Patient ID:</span> {created?.patientId || "Pending"}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700">
                  <span className="font-bold">Password Setup Email:</span>{" "}
                  {autoSetupStatus === "checking" && "Checking verification status..."}
                  {autoSetupStatus === "waiting_verification" &&
                    "Waiting for patient to confirm email (auto-send will trigger after confirmation)."}
                  {autoSetupStatus === "sent" && "Sent automatically after email verification."}
                  {autoSetupStatus === "error" && "Error checking auto-send status."}
                  {autoSetupStatus === "idle" && "Pending..."}
                </div>

                {created?.uid ? (
                  <PatientEditModal
                    inline
                    patientId={created.uid}
                    onSaved={async () => {
                      setMsg("Patient record saved.");
                      if (onProfileCompleted) {
                        await onProfileCompleted(created.uid);
                      }
                    }}
                    onClose={onClose}
                    initialEmail={created.email}
                    lockEmail
                    onboardingMode
                    title="Step 2: Complete Patient Record"
                    subtitle="Fill required personal/contact details. Email is locked to the created account."
                    confirmOnSave
                    confirmMessage="Are you sure you want to proceed?"
                  />
                ) : null}
              </>
            )}

            {error ? <p className="text-sm font-bold text-red-600">{error}</p> : null}
            {msg ? <p className="text-sm font-bold text-emerald-700">{msg}</p> : null}
          </div>
        </div>
      </div>

    </>
  );
}

export default function WalkInBookingModal({
  open,
  onClose,
  onBooked,
  forceStaff = false, // ✅ pass true from admin-dashboard
}: {
  open: boolean;
  onClose: () => void;
  onBooked: () => void;
  forceStaff?: boolean;
}) {
  const { user } = useAuth();
  const router = useRouter();

  const role = (user as any)?.role as
    | "admin"
    | "front-desk"
    | "staff"
    | "client"
    | undefined;

  // ✅ staff mode works even if user.role isn't present
  const isStaff = forceStaff || role === "admin" || role === "front-desk" || role === "staff";

  const [state, formAction, isPending] = useActionState(
    isStaff ? staffBookAppointmentAction : bookAppointmentAction,
    { success: false, error: "" }
  );

  const today = useMemo(() => startOfDay(new Date()), []);
  const minBookDate = useMemo(() => today, [today]);

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

  // Patient selection (staff)
  const [patientQuery, setPatientQuery] = useState("");
  const [patientResults, setPatientResults] = useState<UserProfile[]>([]);
  const [patientLoading, setPatientLoading] = useState(false);
  const [patientOpen, setPatientOpen] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<UserProfile | null>(null);

  // Name used for booking (display only + passed to action)
  const [fullName, setFullName] = useState("");
  const [idToken, setIdToken] = useState("");
  const [createPatientOpen, setCreatePatientOpen] = useState(false);

  const [procedures, setProcedures] = useState<DentalProcedure[]>([]);
  const [procLoading, setProcLoading] = useState(false);
  const [procError, setProcError] = useState("");

  // Load availability
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

  // Procedures
  useEffect(() => {
    if (!open) return;
    if (procedures.length > 0) return;

    let cancelled = false;
    setProcLoading(true);
    setProcError("");

    getAllProcedures(true)
      .then((res: any) => {
        if (cancelled) return;
        if (res.success && res.data) setProcedures(res.data as DentalProcedure[]);
        else setProcError(res.error || "Failed to load services");
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

  useEffect(() => {
    let active = true;
    if (!open || !isStaff || !user) {
      setIdToken("");
      return;
    }
    user
      .getIdToken()
      .then((t: string) => {
        if (active) setIdToken(t);
      })
      .catch(() => {
        if (active) setIdToken("");
      });
    return () => {
      active = false;
    };
  }, [open, isStaff, user]);

  // Patient search (debounced + only when 2+ chars)
  useEffect(() => {
    if (!open) return;
    if (!isStaff) return;

    const term = patientQuery.trim();

    if (term.length < 2) {
      setPatientResults([]);
      setPatientLoading(false);
      return;
    }

    setPatientLoading(true);

    const t = setTimeout(async () => {
      const res = await searchPatients(term);
      if (res.success && res.data) setPatientResults(res.data as UserProfile[]);
      else setPatientResults([]);
      setPatientLoading(false);
    }, 250);

    return () => clearTimeout(t);
  }, [patientQuery, open, isStaff]);

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

      setPatientQuery("");
      setPatientResults([]);
      setPatientOpen(false);
      setSelectedPatient(null);
      setCreatePatientOpen(false);

      setFullName("");
      return;
    }

    successHandledRef.current = false;
    setClientError("");

    // ✅ IMPORTANT: in staff mode, DO NOT auto-fill from logged-in user
    if (isStaff) {
      setFullName("");
    } else {
      // client mode (kept behavior)
      setFullName(user?.displayName || "");
    }
  }, [open, isStaff, user?.displayName]);

  // When staff selects patient → set fullName
  useEffect(() => {
    if (!isStaff) return;
    if (!selectedPatient) return;
    setFullName(selectedPatient.displayName || "");
  }, [selectedPatient, isStaff]);

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
  const selectedIsPastDate =
    !!selectedDateObj && startOfDay(selectedDateObj).getTime() < minBookDate.getTime();
  const selectedTimeIsPastForToday =
    !!selectedDate && !!selectedTime && isPastSlotForSelectedDate(selectedDate, selectedTime);

  const patientReady = !isStaff || !!selectedPatient;

  const canSubmit =
    patientReady &&
    !!selectedDate &&
    !!selectedTime &&
    !selectedIsPastDate &&
    !selectedTimeIsPastForToday &&
    !isHoliday &&
    !isPending &&
    !taken.has(selectedTime) &&
    (!procError && !procLoading);

  const goPrevMonth = () => setViewDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  const goNextMonth = () => setViewDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
          <div>
            <h3 className="text-lg font-extrabold text-slate-900">Walk-In Booking</h3>
            <p className="mt-1 text-xs text-slate-500">
              Select patient → date → time → service. Past dates and past times are blocked.
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

        <div className="grid grid-cols-1 md:grid-cols-[1.2fr_1fr]">
          {/* Left: Calendar + slots (UNCHANGED DESIGN) */}
          <div className="p-6 md:border-r border-slate-100">
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
                <p className="text-xs text-slate-500">Today is allowed (past time slots disabled)</p>
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
                    title={isTooEarly ? "Past dates cannot be booked." : ""}
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
                  {TIME_SLOTS.map((t) => {
                    const booked = taken.has(t);
                    const past = isPastSlotForSelectedDate(selectedDate, t);
                    const disabled = booked || past;

                    return (
                      <SlotButton
                        key={t}
                        time={t}
                        disabled={disabled}
                        label={booked ? "Booked" : past ? "Past" : "Unavailable"}
                        selected={selectedTime === t}
                        onClick={() => {
                          setClientError("");
                          setSelectedTime(t);
                        }}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right: Patient + details */}
          <div className="p-6">
            <form
              action={formAction}
              className="space-y-4"
              onSubmit={(e) => {
                if (isStaff && !selectedPatient) {
                  e.preventDefault();
                  setClientError("Please select a patient first.");
                  return;
                }

                if (selectedDate) {
                  const sel = startOfDay(new Date(selectedDate + "T00:00:00"));
                  if (sel.getTime() < minBookDate.getTime()) {
                    e.preventDefault();
                    setClientError("Past dates cannot be booked.");
                    return;
                  }
                }

                if (selectedDate && selectedTime && isPastSlotForSelectedDate(selectedDate, selectedTime)) {
                  e.preventDefault();
                  setClientError("That time slot is already in the past. Please choose a later slot.");
                  return;
                }
              }}
            >
              <input type="hidden" name="date" value={selectedDate} />
              <input type="hidden" name="time" value={selectedTime} />
              <input type="hidden" name="displayName" value={fullName} />
              <input type="hidden" name="patientId" value={selectedPatient?.uid || ""} />

              {/* Staff patient search */}
              {isStaff ? (
                <div className="relative">
                  <label className="text-xs font-bold text-slate-600">Search Patient (Name / Email)</label>

                  <input
                    value={patientQuery}
                    onChange={(e) => {
                      const v = e.target.value;
                      setPatientQuery(v);
                      setPatientOpen(true);
                      setSelectedPatient(null);
                      setFullName("");
                      setClientError("");
                    }}
                    onFocus={() => setPatientOpen(true)}
                    placeholder="Type at least 2 characters..."
                    className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-slate-300"
                  />

                  <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                    {patientQuery.trim().length < 2
                      ? "Type at least 2 characters to search."
                      : patientLoading
                      ? "Searching..."
                      : "Select a patient from results."}
                  </div>

                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={() => setCreatePatientOpen(true)}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-extrabold text-slate-700 hover:bg-slate-50"
                    >
                      + Create user if no account
                    </button>
                  </div>

                  {patientOpen && patientQuery.trim().length >= 2 ? (
                    <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
                      <div className="max-h-64 overflow-auto">
                        {patientLoading ? (
                          <div className="px-4 py-3 text-sm text-slate-500">Searching...</div>
                        ) : patientResults.length === 0 ? (
                          <div className="px-4 py-3 text-sm text-slate-500">
                            No patients found.
                            <button
                              type="button"
                              onClick={() => setCreatePatientOpen(true)}
                              className="ml-2 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-extrabold text-slate-700 hover:bg-slate-50"
                            >
                              Create account
                            </button>
                          </div>
                        ) : (
                          patientResults.map((p) => (
                            <button
                              key={p.uid}
                              type="button"
                              onClick={() => {
                                setSelectedPatient(p);
                                setPatientQuery(p.displayName || p.email || "");
                                setPatientOpen(false);
                                setClientError("");
                              }}
                              className="w-full px-4 py-3 text-left hover:bg-slate-50"
                            >
                              <div className="text-sm font-extrabold text-slate-900">
                                {p.displayName || p.email || "Unnamed Patient"}
                              </div>
                              <div className="text-xs text-slate-500">{p.email || ""}</div>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  ) : null}

                  {selectedPatient ? (
                    <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                      Selected:{" "}
                      <span className="font-extrabold">
                        {selectedPatient.displayName || selectedPatient.email}
                      </span>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div>
                  <label className="text-xs font-bold text-slate-600">Full Name</label>
                  <input
                    value={fullName}
                    disabled
                    className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-slate-300 disabled:bg-slate-50 disabled:text-slate-600"
                  />
                </div>
              )}

              <div>
                <label className="text-xs font-bold text-slate-600">Service Type</label>
                <select
                  name="serviceType"
                  required
                  disabled={procLoading || !!procError}
                  className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-slate-300 disabled:bg-slate-50 disabled:text-slate-500"
                >
                  <option value="">{procLoading ? "Loading services..." : "Select Service"}</option>
                  {procedures.map((p: any) => (
                    <option key={p.id} value={p.name || "Service"}>
                      {p.name || "Service"}
                    </option>
                  ))}
                </select>
                {procError ? <p className="mt-2 text-xs font-semibold text-red-600">{procError}</p> : null}
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
                Flow: Select patient → date → time → service. Past dates and past time slots are blocked.
              </p>
            </form>
          </div>
        </div>
      </div>

      <CreatePatientAccountModal
        open={createPatientOpen}
        onClose={() => setCreatePatientOpen(false)}
        idToken={idToken}
        suggestedEmail={patientQuery}
        onCreated={async ({ uid, email }) => {
          setPatientQuery(email || "");
          setPatientOpen(false);
          const res = await searchPatients(email || "");
          if (!res.success || !res.data) return;
          const found = (res.data as UserProfile[]).find((p) => p.uid === uid);
          if (!found) return;
          setSelectedPatient(found);
          setPatientQuery(found.displayName || found.email || email || "");
          setPatientResults(res.data as UserProfile[]);
          setPatientOpen(false);
          setClientError("");
          setFullName(found.displayName || "");
        }}
        onProfileCompleted={async (uid) => {
          const res = await getUserProfile(uid);
          if (!res?.success || !res.data) return;
          const updated = res.data as UserProfile;
          setSelectedPatient(updated);
          setPatientQuery(updated.displayName || updated.email || "");
          setFullName(updated.displayName || updated.email || "");
          setClientError("");
        }}
      />
    </div>
  );
}
