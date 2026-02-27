"use client";

import NextImage from "next/image";
import Link from "next/link";
import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/hooks/useAuth";
import { getUserAppointments } from "@/lib/services/appointment-service";
import { getPatientRecord } from "@/lib/services/patient-service";
import { updatePatientRecordAction } from "@/app/actions/auth-actions";
import { cancelAppointmentAction } from "@/app/actions/appointment-actions";
import { getPatientTreatmentHistoryAction } from "@/app/actions/appointment-admin-actions";
import { updateUserDocument } from "@/lib/services/user-service";
import { updateUserProfile } from "@/lib/services/auth-service";
import { formatTime12h } from "@/lib/utils/time";
import { getBillingRecordsByPatient } from "@/lib/services/billing-service";

import type { Appointment } from "@/lib/types/appointment";
import type { BillingRecord } from "@/lib/types/billing";
import type { PatientRecord } from "@/lib/types/patient";

import BookAppointmentModal from "@/components/BookAppointmentModal";
import AppointmentDetailsModal, { type AppointmentModalTab } from "@/components/client/AppointmentDetailsModal";
import AppointmentRowActions from "@/components/client/AppointmentRowActions";
import ReschuleBookAppointmentModal from "@/components/ReschuleBookAppointmentModal";
import { getDentistProfileByUid, type DentistProfile } from "@/lib/services/dentist-profile-service";
import TransactionsTable from "@/components/client/TransactionsTable";
import { getUserDisplayNameByUid } from "@/lib/services/user-service";
import { auth } from "@/lib/firebase/firebase";
import { Odontogram } from "react-odontogram";

const BRAND = "#0E4B5A";
const CROP_PREVIEW_SIZE = 240;
const OUTPUT_SIZE = 512;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function computeCrop(
  img: HTMLImageElement,
  scale: number,
  center: { x: number; y: number }
) {
  const srcSize = Math.min(img.width, img.height) / scale;
  const half = srcSize / 2;
  const cx = clamp(center.x, half, img.width - half);
  const cy = clamp(center.y, half, img.height - half);
  return { sx: cx - half, sy: cy - half, sSize: srcSize, cx, cy };
}

function StatusBadge({ status }: { status: string }) {
  const s = (status || "").toLowerCase();
  const cls =
    s === "pending"
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : s === "cancelled"
      ? "bg-red-50 text-red-700 border-red-200"
      : "bg-emerald-50 text-emerald-700 border-emerald-200";

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-bold uppercase ${cls}`}>
      {status}
    </span>
  );
}

function AppointmentsTable({
  appointments,
  loading,
  onAddAppointment,
  onOpenModal,
  onReschedule,
  onCancel,
  getCancelDisabledReason,
  getRescheduleDisabledReason,
}: {
  appointments: Appointment[];
  loading: boolean;
  onAddAppointment: () => void;
  onOpenModal: (appt: Appointment, tab: AppointmentModalTab) => void;
  onReschedule: (appt: Appointment) => void;
  onCancel: (appt: Appointment) => void;
  getCancelDisabledReason: (appt: Appointment) => string | null;
  getRescheduleDisabledReason: (appt: Appointment) => string | null;
}) {
  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold text-slate-800">Loading appointment history...</p>
        <div className="mt-4 space-y-3">
          <div className="h-12 rounded-xl bg-slate-100" />
          <div className="h-12 rounded-xl bg-slate-100" />
          <div className="h-12 rounded-xl bg-slate-100" />
        </div>
      </div>
    );
  }

  if (!appointments.length) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-extrabold text-slate-900">My Appointment History</h3>
        <p className="mt-2 text-sm text-slate-600">No appointments booked yet.</p>

        <button
          type="button"
          onClick={onAddAppointment}
          className="mt-5 inline-flex w-fit rounded-xl px-5 py-3 text-sm font-semibold text-white hover:opacity-95"
          style={{ backgroundColor: BRAND }}
        >
          Book your first appointment
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-slate-100 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-extrabold text-slate-900">My Appointment History</h3>
          <p className="mt-1 text-xs text-slate-500">Review your bookings and appointment status.</p>
        </div>

        <button
          type="button"
          onClick={onAddAppointment}
          className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white hover:opacity-95"
          style={{ backgroundColor: BRAND }}
        >
          <span className="text-lg leading-none">+</span>
          Add Appointment
        </button>
      </div>

      <div className="md:hidden p-4 space-y-3">
        {appointments.map((appt) => {
          const service = String((appt as any).serviceType || "");
          const date = String((appt as any).date || "");
          const time = formatTime12h(String((appt as any).time || ""));
          const id = String((appt as any).id || "");
          const status = String((appt as any).status || "");

          return (
            <div key={id} className="rounded-2xl border border-slate-200 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-extrabold text-slate-900">{service}</p>
                  <p className="text-xs text-slate-500">Ref: {id}</p>
                </div>
                <StatusBadge status={status} />
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
                <div>
                  <div className="font-extrabold text-slate-500">Date</div>
                  <div className="text-slate-800">{date}</div>
                </div>
                <div>
                  <div className="font-extrabold text-slate-500">Time</div>
                  <div className="text-slate-800">{time}</div>
                </div>
              </div>

              <div className="mt-3">
                <AppointmentRowActions
                  appointment={appt}
                  onView={() => onOpenModal(appt, "details")}
                  onTransactions={() => onOpenModal(appt, "transactions")}
                  onReschedule={() => onReschedule(appt)}
                  onCancel={() => onCancel(appt)}
                  cancelDisabledReason={getCancelDisabledReason(appt)}
                  rescheduleDisabledReason={getRescheduleDisabledReason(appt)}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs font-bold text-slate-600">
            <tr>
              <th className="px-6 py-3">Service</th>
              <th className="px-6 py-3">Date</th>
              <th className="px-6 py-3">Time</th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3">Action</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100">
            {appointments.map((appt) => (
              <tr key={(appt as any).id} className="hover:bg-slate-50/60">
                <td className="px-6 py-4">
                  <p className="font-bold text-slate-900">{String((appt as any).serviceType || "")}</p>
                  <p className="text-xs text-slate-500">Ref: {String((appt as any).id || "")}</p>
                </td>

                <td className="px-6 py-4 text-slate-700">{String((appt as any).date || "")}</td>
                <td className="px-6 py-4 text-slate-700">
                  {formatTime12h(String((appt as any).time || ""))}
                </td>

                <td className="px-6 py-4">
                  <StatusBadge status={String((appt as any).status || "")} />
                </td>

                <td className="px-6 py-4">
                  <AppointmentRowActions
                    appointment={appt}
                    onView={() => onOpenModal(appt, "details")}
                    onTransactions={() => onOpenModal(appt, "transactions")}
                    onReschedule={() => onReschedule(appt)}
                    onCancel={() => onCancel(appt)}
                    cancelDisabledReason={getCancelDisabledReason(appt)}
                    rescheduleDisabledReason={getRescheduleDisabledReason(appt)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
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

function ActiveInstallmentsPanel({
  billingRecords,
  appointments,
  loading,
}: {
  billingRecords: BillingRecord[];
  appointments: Appointment[];
  loading: boolean;
}) {
  const apptMap = useMemo(() => {
    const map = new Map<string, Appointment>();
    for (const a of appointments) map.set(String(a.id || ""), a);
    return map;
  }, [appointments]);

  const activePlans = useMemo(() => {
    const formatItemName = (it: BillingRecord["items"][number]) => {
      const base = String(it?.name || "").trim();
      const tooth = String(it?.toothNumber || "").trim();
      return tooth ? `${base} (${tooth})` : base;
    };

    const summarizePlanProcedure = (bill: BillingRecord) => {
      const items = Array.isArray(bill?.items) ? bill.items : [];
      const prioritized = items.filter((it) => {
        const s = String(it?.status || "").toLowerCase();
        return s === "plan" || s === "partial" || s === "unpaid";
      });
      const pool = prioritized.length ? prioritized : items;
      const names = pool.map(formatItemName).filter(Boolean);
      if (names.length > 0) return names[0];

      const installments = Array.isArray(bill?.paymentPlan?.installments)
        ? bill.paymentPlan.installments
        : [];
      const firstDesc = String(installments[0]?.description || "").trim();
      if (firstDesc) return firstDesc.split(" â€¢ Installment")[0] || firstDesc;

      const appt = apptMap.get(String(bill.appointmentId || ""));
      return String(appt?.serviceType || "Installment Plan");
    };

    return billingRecords
      .map((bill) => {
        const installments = Array.isArray(bill?.paymentPlan?.installments) ? bill.paymentPlan.installments : [];
        if (!installments.length) return null;

        const total = installments.length;
        const paid = installments.filter((inst) => String(inst?.status || "").toLowerCase() === "paid").length;
        const remaining = Math.max(0, total - paid);

        const lastPaidAtMs = installments
          .map((inst) => toDate(inst?.paidAt)?.getTime() || 0)
          .reduce((max, curr) => Math.max(max, curr), 0);
        const lastPaidAt = lastPaidAtMs > 0 ? new Date(lastPaidAtMs) : null;

        const progressPct = total > 0 ? Math.round((paid / total) * 100) : 0;
        return {
          id: String(bill.id || bill.appointmentId || ""),
          procedureName: summarizePlanProcedure(bill),
          total,
          paid,
          remaining,
          progressPct,
          lastPaidAt,
        };
      })
      .filter(Boolean) as Array<{
      id: string;
      procedureName: string;
      total: number;
      paid: number;
      remaining: number;
      progressPct: number;
      lastPaidAt: Date | null;
    }>;
  }, [apptMap, billingRecords]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold text-slate-800">Loading active installments...</p>
        <div className="mt-4 space-y-3">
          <div className="h-20 rounded-xl bg-slate-100" />
          <div className="h-20 rounded-xl bg-slate-100" />
        </div>
      </div>
    );
  }

  if (!activePlans.length) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-extrabold text-slate-900">Active Installments</h3>
        <p className="mt-2 text-sm text-slate-600">No active installment plans right now.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="border-b border-slate-100 px-6 py-4">
        <h3 className="text-lg font-extrabold text-slate-900">Active Installments</h3>
        <p className="mt-1 text-xs text-slate-500">Track your remaining months and latest installment payment.</p>
      </div>

      <div className="space-y-4 p-6">
        {activePlans.map((plan) => (
          <div key={plan.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-extrabold text-slate-900">{plan.procedureName}</p>
                <p className="text-xs text-slate-500">{plan.total} month plan</p>
              </div>
              {plan.remaining <= 0 ? (
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">
                  Paid
                </span>
              ) : (
                <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-xs font-bold text-cyan-700">
                  {plan.remaining} month{plan.remaining === 1 ? "" : "s"} remaining
                </span>
              )}
            </div>

            <div className="mt-4">
              <div className="mb-1 flex items-center justify-between text-xs font-bold text-slate-600">
                <span>
                  Monthly payments: {plan.paid} / {plan.total}
                </span>
                <span>{plan.progressPct}%</span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-cyan-600 transition-all"
                  style={{ width: `${plan.progressPct}%` }}
                />
              </div>
            </div>

            <p className="mt-3 text-xs text-slate-600">
              Last payment made:{" "}
              <span className="font-bold text-slate-800">
                {plan.lastPaidAt ? plan.lastPaidAt.toLocaleDateString() : "No payment yet"}
              </span>
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function AccountSettingsForm({
  userDisplayName,
  email,
  record,
  userPhotoUrl,
  onPhotoUpdated,
}: {
  userDisplayName: string;
  email: string;
  record: PatientRecord | null;
  userPhotoUrl?: string | null;
  onPhotoUpdated?: (url: string) => void;
}) {
  const [state, formAction, isPending] = useActionState(updatePatientRecordAction, { success: false });
  const { user } = useAuth();
  const [photoSrc, setPhotoSrc] = useState<string | null>(null);
  const [imageMeta, setImageMeta] = useState<{ width: number; height: number } | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const [cropScale, setCropScale] = useState(1);
  const [cropCenter, setCropCenter] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragCenterRef = useRef<{ x: number; y: number } | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const drawPreview = useCallback(() => {
    const img = imageRef.current;
    const canvas = previewRef.current;
    if (!img || !canvas || !imageMeta) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { sx, sy, sSize } = computeCrop(img, cropScale, cropCenter);
    ctx.clearRect(0, 0, CROP_PREVIEW_SIZE, CROP_PREVIEW_SIZE);
    ctx.drawImage(img, sx, sy, sSize, sSize, 0, 0, CROP_PREVIEW_SIZE, CROP_PREVIEW_SIZE);
  }, [cropCenter, cropScale, imageMeta]);

  useEffect(() => {
    drawPreview();
  }, [drawPreview]);

  const handlePhotoSelect = (file: File | null) => {
    if (!file) return;
    setPhotoError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result || "");
      setPhotoSrc(src);
      const img = new window.Image();
      img.onload = () => {
        imageRef.current = img;
        setImageMeta({ width: img.width, height: img.height });
        setCropScale(1);
        setCropCenter({ x: img.width / 2, y: img.height / 2 });
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!imageRef.current || !imageMeta) return;
    setDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    dragCenterRef.current = { ...cropCenter };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragging || !imageRef.current || !imageMeta || !dragStartRef.current || !dragCenterRef.current) return;
    const img = imageRef.current;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    const srcSize = Math.min(img.width, img.height) / cropScale;
    const factor = srcSize / CROP_PREVIEW_SIZE;
    const next = {
      x: dragCenterRef.current.x - dx * factor,
      y: dragCenterRef.current.y - dy * factor,
    };
    const half = srcSize / 2;
    setCropCenter({
      x: clamp(next.x, half, img.width - half),
      y: clamp(next.y, half, img.height - half),
    });
  };

  const handlePointerUp = () => {
    setDragging(false);
    dragStartRef.current = null;
    dragCenterRef.current = null;
  };

  const uploadProfilePhoto = async () => {
    if (!user || !imageRef.current || !imageMeta) return;
    const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;
    if (!cloudName || !uploadPreset) {
      setPhotoError("Cloudinary env vars missing.");
      return;
    }

    setUploadingPhoto(true);
    setPhotoError(null);

    try {
      const img = imageRef.current;
      const { sx, sy, sSize } = computeCrop(img, cropScale, cropCenter);
      const out = document.createElement("canvas");
      out.width = OUTPUT_SIZE;
      out.height = OUTPUT_SIZE;
      const ctx = out.getContext("2d");
      if (!ctx) throw new Error("Canvas not supported");
      ctx.drawImage(img, sx, sy, sSize, sSize, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

      const blob: Blob | null = await new Promise((resolve) =>
        out.toBlob((b) => resolve(b), "image/jpeg", 0.92)
      );
      if (!blob) throw new Error("Failed to prepare image.");

      const form = new FormData();
      form.append("file", blob, "profile.jpg");
      form.append("upload_preset", uploadPreset);

      const res = await fetch(
        `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
        { method: "POST", body: form }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message || "Upload failed");
      }

      const url = String(data?.secure_url || "");
      if (!url) throw new Error("Upload failed");

      await updateUserDocument(user.uid, { photoURL: url });
      const name = user.displayName || userDisplayName || "Patient";
      await updateUserProfile(user, { displayName: name.length >= 2 ? name : "Patient", photoURL: url });

      setPhotoSrc(null);
      setImageMeta(null);
      imageRef.current = null;
      onPhotoUpdated?.(url);
    } catch (err: any) {
      setPhotoError(err?.message || "Failed to upload photo.");
    } finally {
      setUploadingPhoto(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-extrabold text-slate-900">Account Settings</h3>
          <p className="mt-2 text-sm text-slate-600">Keep your contact details updated so the clinic can reach you.</p>
        </div>

        {state.success && (
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-extrabold text-emerald-700 border border-emerald-200">
            Saved
          </span>
        )}
      </div>

      <form action={formAction} className="mt-5 space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-4">
              <div className="relative h-20 w-20 overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
                {userPhotoUrl ? (
                  <img src={userPhotoUrl} alt="Profile" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs font-bold text-slate-400">
                    No Photo
                  </div>
                )}
              </div>
              <div>
                <p className="text-sm font-extrabold text-slate-900">Profile Photo</p>
                <p className="text-xs text-slate-500">Square 2x2 crop</p>
              </div>
            </div>

            <label className="inline-flex cursor-pointer items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-extrabold text-slate-700 hover:bg-slate-50">
              Select Photo
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handlePhotoSelect(e.target.files?.[0] || null)}
              />
            </label>
          </div>

          {photoSrc && (
            <div className="mt-4">
              <p className="text-xs font-extrabold uppercase tracking-widest text-slate-600">
                Crop Preview
              </p>
              <div className="mt-3 flex flex-col gap-4 md:flex-row md:items-start">
                <canvas
                  ref={previewRef}
                  width={CROP_PREVIEW_SIZE}
                  height={CROP_PREVIEW_SIZE}
                  className="h-60 w-60 rounded-2xl border border-slate-200 bg-white"
                  style={{ touchAction: "none" }}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerLeave={handlePointerUp}
                />

                <div className="flex-1">
                  <label className="text-xs font-bold text-slate-600">Zoom</label>
                  <input
                    type="range"
                    min={1}
                    max={3}
                    step={0.05}
                    value={cropScale}
                    onChange={(e) => setCropScale(Number(e.target.value))}
                    className="mt-2 w-full"
                  />
                  <p className="mt-2 text-xs text-slate-500">
                    Drag the preview to reposition the crop.
                  </p>
                  <button
                    type="button"
                    disabled={uploadingPhoto}
                    onClick={uploadProfilePhoto}
                    className="mt-4 inline-flex w-full justify-center rounded-xl bg-slate-900 px-4 py-2 text-xs font-extrabold text-white hover:bg-black disabled:opacity-60"
                  >
                    {uploadingPhoto ? "Uploading..." : "Upload Photo"}
                  </button>
                  {photoError && (
                    <p className="mt-2 text-xs font-extrabold text-rose-600">{photoError}</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="text-xs font-bold text-slate-600">Full Name</label>
            <input
              name="displayName"
              defaultValue={userDisplayName}
              className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-slate-300"
              placeholder="Full name"
              required
            />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-600">Email</label>
            <input
              defaultValue={email}
              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500 outline-none"
              disabled
            />
          </div>
        </div>



        <button
          type="submit"
          disabled={isPending}
          className="inline-flex w-full justify-center rounded-xl px-5 py-3 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-60"
          style={{ backgroundColor: BRAND }}
        >
          {isPending ? "Saving..." : "Save Changes"}
        </button>

        {state.error && <p className="text-sm font-bold text-red-600">{state.error}</p>}
      </form>
    </div>
  );
}

function toMillis(value: any) {
  if (!value) return 0;
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  const d = new Date(value);
  const ms = d.getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function universalToFdi(universal: number) {
  if (universal >= 1 && universal <= 8) return 19 - universal;
  if (universal >= 9 && universal <= 16) return universal + 12;
  if (universal >= 17 && universal <= 24) return 55 - universal;
  if (universal >= 25 && universal <= 32) return universal + 16;
  return null;
}

function fdiToUniversal(fdi: number) {
  const map: Record<number, number> = {
    11: 8, 12: 7, 13: 6, 14: 5, 15: 4, 16: 3, 17: 2, 18: 1,
    21: 9, 22: 10, 23: 11, 24: 12, 25: 13, 26: 14, 27: 15, 28: 16,
    31: 24, 32: 23, 33: 22, 34: 21, 35: 20, 36: 19, 37: 18, 38: 17,
    41: 25, 42: 26, 43: 27, 44: 28, 45: 29, 46: 30, 47: 31, 48: 32,
  };
  return map[fdi] ?? null;
}

function keyToToothId(key: string) {
  const raw = String(key || "").trim();
  if (!raw) return null;
  if (raw.startsWith("teeth-")) return raw;
  const num = Number(raw);
  if (!Number.isFinite(num)) return null;
  if (num >= 1 && num <= 32) {
    const fdi = universalToFdi(num);
    return fdi ? `teeth-${fdi}` : null;
  }
  if (num >= 11 && num <= 48) return `teeth-${num}`;
  return null;
}

function keyToUniversal(key: string) {
  const raw = String(key || "").trim();
  if (!raw) return null;
  if (raw.startsWith("teeth-")) {
    const num = Number(raw.replace("teeth-", ""));
    if (!Number.isFinite(num)) return null;
    if (num >= 11 && num <= 48) {
      const uni = fdiToUniversal(num);
      return uni ? String(uni) : null;
    }
  }
  const num = Number(raw);
  if (!Number.isFinite(num)) return null;
  if (num >= 1 && num <= 32) return String(num);
  if (num >= 11 && num <= 48) {
    const uni = fdiToUniversal(num);
    return uni ? String(uni) : null;
  }
  return null;
}

function payloadToUniversal(payload: any) {
  const raw = payload?.notations?.universal || payload?.notations?.fdi || "";
  if (!raw) return "";
  const num = Number(raw);
  if (Number.isFinite(num)) return String(num);
  return String(raw);
}

function ClientTreatmentHistoryModal({
  patientId,
  patientName,
  patientEmail,
  onClose,
}: {
  patientId: string;
  patientName?: string | null;
  patientEmail?: string | null;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<
    Array<{
      appointmentId: string;
      dentistId?: string | null;
      dentistName?: string | null;
      date?: string;
      time?: string;
      completedAt?: any;
      notes?: string;
      procedures?: Array<{ name?: string; toothNumber?: string; price?: number | null }>;
      imageUrls?: string[];
      dentalChart?: Record<string, { status?: string; notes?: string }>;
    }>
  >([]);
  const [openAttachments, setOpenAttachments] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let active = true;
    setLoading(true);
    setGroups([]);

    const load = async () => {
      const user = auth.currentUser;
      const token = user ? await user.getIdToken() : null;
      if (!token) {
        if (!active) return;
        setLoading(false);
        return;
      }

      const res = await getPatientTreatmentHistoryAction({
        patientId,
        idToken: token,
      });

      if (!active) return;
      if (!res?.success || !res.data) {
        setGroups([]);
        setLoading(false);
        return;
      }

      const list = Array.isArray(res.data.groups) ? res.data.groups : [];
      const withNames = await Promise.all(
        list.map(async (g) => ({
          ...g,
          dentistName: g.dentistId ? await getUserDisplayNameByUid(g.dentistId) : null,
        }))
      );
      setGroups(withNames);
      setLoading(false);
    };

    load();
    return () => {
      active = false;
    };
  }, [patientId]);

  const formatLabel = (g: { date?: string; time?: string; completedAt?: any }) => {
    if (g.date && g.time) return `${g.date} ${g.time}`;
    if (g.date) return g.date;
    const ts = g.completedAt ? toMillis(g.completedAt) : 0;
    if (ts) return new Date(ts).toLocaleString();
    return "Unknown date";
  };

  const chartHistory = useMemo(() => {
    const map = new Map<string, Array<{ date: string; status?: string; notes?: string }>>();

    for (const g of groups) {
      const label = formatLabel(g);
      const chart = g.dentalChart || {};
      for (const [rawKey, entry] of Object.entries(chart)) {
        const uniKey = keyToUniversal(rawKey);
        if (!uniKey) continue;
        const status = (entry as any)?.status ?? (entry as any)?.state ?? (entry as any)?.condition ?? "";
        const notes = (entry as any)?.notes ?? (entry as any)?.note ?? (entry as any)?.description ?? "";
        if (!status && !notes) continue;
        const list = map.get(uniKey) ?? [];
        list.push({ date: label, status: String(status || ""), notes: String(notes || "") });
        map.set(uniKey, list);
      }
    }

    for (const list of map.values()) {
      list.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    }

    return map;
  }, [groups]);

  const isExtractedEntry = (e: { status?: string; notes?: string }) => {
    const status = String(e.status || "").toLowerCase();
    const notes = String(e.notes || "").toLowerCase();
    return (
      status.includes("extract") ||
      status.includes("removed") ||
      status.includes("denture") ||
      notes.includes("extract") ||
      notes.includes("removed") ||
      notes.includes("denture")
    );
  };

  const extractedSet = new Set(
    Array.from(chartHistory.entries())
      .filter(([_, entries]) => entries.some((e) => isExtractedEntry(e)))
      .map(([key]) => keyToToothId(key))
      .filter(Boolean) as string[]
  );

  const notedSet = new Set(
    Array.from(chartHistory.entries())
      .filter(([key, entries]) => {
        if (extractedSet.has(keyToToothId(key) || "")) return false;
        return entries.some((e) => {
          const status = String(e.status || "").trim();
          const notes = String(e.notes || "").trim();
          return Boolean(status || notes);
        });
      })
      .map(([key]) => keyToToothId(key))
      .filter(Boolean) as string[]
  );

  const notedSelected = Array.from(notedSet);
  const extractedSelected = Array.from(extractedSet);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-6xl rounded-2xl bg-white border border-slate-200 shadow-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-extrabold text-slate-900">Treatment Records</h3>
            <p className="text-sm text-slate-500">
              {patientName ? `${patientName}` : "Patient"} {patientEmail ? `â€¢ ${patientEmail}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-extrabold text-slate-700 hover:bg-slate-50"
          >
            Close
          </button>
        </div>

        <div className="p-5 max-h-[85vh] overflow-y-auto">
          {loading ? (
            <p className="text-sm text-slate-500">Loading...</p>
          ) : groups.length === 0 ? (
            <p className="text-sm text-slate-500">No treatment history found.</p>
          ) : (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-extrabold uppercase tracking-widest text-slate-600">
                  Dental Chart (combined history)
                </p>
                <div className="mt-2 grid gap-2 text-xs text-slate-600 sm:grid-cols-3">
                  <div className="inline-flex items-center gap-2">
                    <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-400" />
                    Teeth with notes
                  </div>
                  <div className="inline-flex items-center gap-2">
                    <span className="inline-block h-2.5 w-2.5 rounded-full bg-slate-900" />
                    Extracted / removed / dentures
                  </div>
                  <div className="inline-flex items-center gap-2">
                    Hover teeth to view history
                  </div>
                </div>
                <p className="mt-2 text-[11px] text-slate-500">
                  Highlighted teeth: {Array.from(chartHistory.keys()).join(", ") || "â€”"}
                </p>

                <div className="mt-3 relative">
                  <div className="pointer-events-none opacity-90">
                    <Odontogram
                      key={`combined-extracted-${extractedSelected.join(",")}`}
                      defaultSelected={extractedSelected}
                      theme="light"
                      colors={{ lightBlue: "#0f172a", darkBlue: "#0f172a", baseBlue: "#0f172a" }}
                      tooltip={{ content: () => null }}
                      showTooltip={false}
                    />
                  </div>
                  <div className="pointer-events-none absolute inset-0">
                    <Odontogram
                      key={`combined-notes-${notedSelected.join(",")}`}
                      defaultSelected={notedSelected}
                      theme="light"
                      colors={{ lightBlue: "#fbbf24", darkBlue: "#f59e0b", baseBlue: "#fde68a" }}
                      showTooltip={true}
                      tooltip={{
                        content: (payload: any) => {
                          const key = payloadToUniversal(payload);
                          const entries = key ? chartHistory.get(key) || [] : [];
                          return (
                            <div>
                              <div>Tooth: {key || "â€”"}</div>
                              {entries.length ? (
                                <div className="mt-1 space-y-1">
                                  {entries.map((e, idx) => (
                                    <div key={`${key}-${idx}`}>
                                      <div>{e.date}</div>
                                      <div>
                                        Status: {e.status || "â€”"}
                                        {isExtractedEntry(e) ? " (Extracted)" : ""}
                                      </div>
                                      <div>Notes: {e.notes || "â€”"}</div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div>No history</div>
                              )}
                            </div>
                          );
                        },
                      }}
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-extrabold uppercase tracking-widest text-slate-600">
                  Treatment History
                </p>
                <div className="mt-3 space-y-3">
                  {groups.map((g) => (
                    <div key={g.appointmentId} className="rounded-xl border border-slate-200 bg-white p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-extrabold text-slate-900">
                            {formatLabel(g)}
                          </p>
                          <p className="text-xs text-slate-500">
                            Dentist: {g.dentistName || "â€”"}
                          </p>
                        </div>
                      </div>

                      {g.procedures && g.procedures.length ? (
                        <div className="mt-2 space-y-1 text-sm text-slate-700">
                          {g.procedures.map((p, idx) => (
                            <div key={`${g.appointmentId}-p-${idx}`} className="flex items-center justify-between">
                              <span className="truncate">{p.name || "Procedure"}</span>
                              <span className="text-xs text-slate-500">
                                {p.toothNumber ? `Tooth ${p.toothNumber}` : ""}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-2 text-xs text-slate-500">No procedures recorded.</p>
                      )}

                      {g.notes ? (
                        <div className="mt-2 text-xs text-slate-700">
                          <span className="font-extrabold">Notes:</span> {g.notes}
                        </div>
                      ) : null}

                      {g.imageUrls && g.imageUrls.length ? (
                        <div className="mt-3">
                          <button
                            type="button"
                            onClick={() =>
                              setOpenAttachments((prev) => ({
                                ...prev,
                                [g.appointmentId]: !prev[g.appointmentId],
                              }))
                            }
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-extrabold text-slate-700 hover:bg-slate-50"
                          >
                            {openAttachments[g.appointmentId] ? "Hide attachments" : "Show attachments"}
                          </button>

                          {openAttachments[g.appointmentId] ? (
                            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                              {g.imageUrls.map((url, idx) => (
                                <a
                                  key={`${g.appointmentId}-${idx}`}
                                  href={url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="block"
                                >
                                  <img
                                    src={url}
                                    alt={`Attachment ${idx + 1}`}
                                    loading="lazy"
                                    className="h-24 w-full rounded-xl border border-slate-200 object-cover"
                                  />
                                </a>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ClientDashboardPage() {
  const { user, role, loading, logout } = useAuth();

  const [active, setActive] = useState<"dashboard" | "transactions" | "settings">("dashboard");
  const [paymentTab, setPaymentTab] = useState<"history" | "installments">("history");

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [billingRecords, setBillingRecords] = useState<BillingRecord[]>([]);
  const [installmentsLoading, setInstallmentsLoading] = useState(true);

  const [record, setRecord] = useState<PatientRecord | null>(null);
  const [recordLoading, setRecordLoading] = useState(true);

  const [openBooking, setOpenBooking] = useState(false);
  const [openReschedule, setOpenReschedule] = useState(false);
  const [openTreatmentRecord, setOpenTreatmentRecord] = useState(false);

  const normalizedRole = (role ?? "").toString().trim().toLowerCase();
  const patientName = useMemo(() => user?.displayName || user?.email?.split("@")[0] || "Patient", [user]);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    setPhotoUrl(user?.photoURL || null);
  }, [user?.photoURL]);

  const [openApptModal, setOpenApptModal] = useState(false);
  const [selectedAppt, setSelectedAppt] = useState<Appointment | null>(null);
  const [selectedBillingRecord, setSelectedBillingRecord] = useState<BillingRecord | null>(null);
  const [initialTab, setInitialTab] = useState<AppointmentModalTab>("details");

const [dentistName, setDentistName] = useState<string | null>(null);
const [dentistLoading, setDentistLoading] = useState(false);
const [dentistNameMap, setDentistNameMap] = useState<Record<string, string>>({});



  
  const reqIdRef = useRef(0);

  const refreshAppointments = useCallback(async () => {
    if (!user?.uid) return;

    const myReq = ++reqIdRef.current;
    setHistoryLoading(true);

    try {
      const res = await getUserAppointments(user.uid);
      if (reqIdRef.current !== myReq) return;
      if (res?.success) setAppointments(res.data || []);
    } catch {
    } finally {
      if (reqIdRef.current === myReq) setHistoryLoading(false);
    }
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) return;
    refreshAppointments();
  }, [user?.uid, refreshAppointments]);

  useEffect(() => {
    if (!user?.uid) {
      setBillingRecords([]);
      setInstallmentsLoading(false);
      return;
    }

    let cancelled = false;
    setInstallmentsLoading(true);

    getBillingRecordsByPatient(user.uid, "all")
      .then((res) => {
        if (cancelled) return;
        if (res?.success && Array.isArray(res.data)) {
          setBillingRecords(res.data);
          return;
        }
        setBillingRecords([]);
      })
      .catch(() => {
        if (!cancelled) setBillingRecords([]);
      })
      .finally(() => {
        if (!cancelled) setInstallmentsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  useEffect(() => {
  let cancelled = false;

  async function load() {
    const ids = Array.from(
      new Set(
        (appointments || [])
          .map((a) => String((a as any).dentistId || "").trim())
          .filter(Boolean)
      )
    );

    if (!ids.length) {
      setDentistNameMap({});
      return;
    }

    const pairs = await Promise.all(
      ids.map(async (id) => {
        const name = await getUserDisplayNameByUid(id);
        return [id, name || "Dentist"] as const;
      })
    );

    if (!cancelled) setDentistNameMap(Object.fromEntries(pairs));
  }

  load();
  return () => {
    cancelled = true;
  };
}, [appointments]);


  useEffect(() => {
    if (!user?.uid) return;

    let cancelled = false;
    setRecordLoading(true);

    getPatientRecord(user.uid)
      .then((res) => {
        if (cancelled) return;
        if (res?.success) setRecord(res.data || null);
      })
      .finally(() => {
        if (!cancelled) setRecordLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

 useEffect(() => {
  let mounted = true;

  async function run() {
    const dentistId = (selectedAppt as any)?.dentistId as string | undefined;

    if (!dentistId) {
      setDentistName(null);
      setDentistLoading(false);
      return;
    }

    setDentistLoading(true);
    try {
      const name = await getUserDisplayNameByUid(dentistId);
      if (mounted) setDentistName(name);
    } finally {
      if (mounted) setDentistLoading(false);
    }
  }

  run();
  return () => {
    mounted = false;
  };
}, [selectedAppt]);


  function openModal(appt: Appointment, tab: AppointmentModalTab) {
    setSelectedAppt(appt);
    setSelectedBillingRecord(null);
    setInitialTab(tab);
    setOpenApptModal(true);
  }

  function getAppointmentDateTimeLocal(appt: Appointment): Date | null {
    const dateStr = String((appt as any).date || "").trim(); // "YYYY-MM-DD"
    const timeStr = String((appt as any).time || "").trim(); // "HH:mm"

    if (!dateStr || !timeStr) return null;

    const [y, m, d] = dateStr.split("-").map((v) => parseInt(v, 10));
    const [hh, mm] = timeStr.split(":").map((v) => parseInt(v, 10));

    if (!y || !m || !d || Number.isNaN(hh) || Number.isNaN(mm)) return null;

    return new Date(y, m - 1, d, hh, mm, 0, 0);
  }

  function getCancelDisabledReason(appt: Appointment): string | null {
    const status = String((appt as any).status || "").toLowerCase();
    if (status !== "pending" && status !== "confirmed") {
      return "Only pending or confirmed appointments can be cancelled.";
    }

    const dt = getAppointmentDateTimeLocal(appt);
    if (!dt) return null;

    const now = new Date();
    const diffMs = dt.getTime() - now.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);

    if (diffMs < 0) {
      return "This appointment has already started/passed. Please call front desk.";
    }

    if (diffHours <= 3) {
      return "You can't cancel your appointment 3 hours before your appointment. Please call front desk about this.";
    }

    return null;
  }

  function getRescheduleDisabledReason(appt: Appointment): string | null {
    const status = String((appt as any).status || "").toLowerCase();
    if (status !== "pending" && status !== "confirmed") {
      return "Only pending or confirmed appointments can be rescheduled.";
    }

    const dt = getAppointmentDateTimeLocal(appt);
    if (!dt) return null;

    const now = new Date();
    const diffMs = dt.getTime() - now.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);

    if (diffMs < 0) {
      return "This appointment has already started/passed. Please call front desk.";
    }

    if (diffHours <= 3) {
      return "You can't reschedule your appointment 3 hours before your appointment. Please call front desk about this.";
    }

    return null;
  }

  async function handleCancelAppointment(appt: Appointment) {
    const reason = getCancelDisabledReason(appt);
    if (reason) {
      alert(reason);
      return;
    }

    const id = String((appt as any).id || "");
    if (!id) return;

    try {
      const res = await cancelAppointmentAction(id);
      if (!res?.success) {
        alert(res?.error || "Failed to cancel appointment.");
        return;
      }
      await refreshAppointments();
    } catch (e: any) {
      alert(e?.message || "Failed to cancel appointment.");
    }
  }

  function handleOpenReschedule(appt: Appointment) {
    const reason = getRescheduleDisabledReason(appt);
    if (reason) {
      alert(reason);
      return;
    }
    setSelectedAppt(appt);
    setOpenReschedule(true);
  }

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <div className="text-sm text-slate-600">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center px-4">
        <div className="max-w-md w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm text-center">
          <h2 className="text-xl font-extrabold text-slate-900">Please sign in</h2>
          <p className="mt-2 text-sm text-slate-600">You need an account to access your dashboard.</p>
          <Link
            href="/"
            className="mt-5 inline-flex w-full justify-center rounded-xl px-5 py-3 text-sm font-semibold text-white hover:opacity-95"
            style={{ backgroundColor: BRAND }}
          >
            Go to Home
          </Link>
        </div>
      </div>
    );
  }

  if (normalizedRole && normalizedRole !== "client") {
    return (
      <div className="min-h-[70vh] flex items-center justify-center px-4">
        <div className="max-w-md w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm text-center">
          <h2 className="text-xl font-extrabold text-slate-900">Access restricted</h2>
          <p className="mt-2 text-sm text-slate-600">
            This dashboard is for patients only. if you administer the clinic, please use the admin link.
          </p>
          <button
            onClick={logout}
            className="mt-5 inline-flex w-full justify-center rounded-xl px-5 py-3 text-sm font-semibold text-white hover:opacity-95"
            style={{ backgroundColor: BRAND }}
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl px-4 py-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
          <aside className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="border-b border-slate-100 p-5">
              <div className="flex items-center gap-3">
                <div className="relative h-10 w-10">
                  <NextImage src="/dclogo.png" alt="J4 Dental Clinic" fill className="object-contain" />
                </div>
                <div className="leading-tight">
                  <p className="text-sm font-extrabold text-slate-900">Patient Portal</p>
                  <p className="text-xs text-slate-500">J4 Dental Clinic</p>
                </div>
              </div>
            </div>

            <div className="p-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:block">
                <button
                  onClick={() => setActive("dashboard")}
                  className={`rounded-xl px-3 py-2 text-center text-xs font-bold transition lg:w-full lg:px-4 lg:py-3 lg:text-left lg:text-sm ${
                    active === "dashboard"
                      ? "bg-slate-900 text-white"
                      : "text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  Dashboard
                </button>
                <button
                  onClick={() => {
                    setActive("transactions");
                    setPaymentTab("history");
                  }}
                  className={`rounded-xl px-3 py-2 text-center text-xs font-bold transition lg:mt-2 lg:w-full lg:px-4 lg:py-3 lg:text-left lg:text-sm ${
                    active === "transactions"
                      ? "bg-slate-900 text-white"
                      : "text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  Payment History
                </button>
                <button
                  type="button"
                  onClick={() => setOpenTreatmentRecord(true)}
                  className="rounded-xl px-3 py-2 text-center text-xs font-bold transition text-slate-700 hover:bg-slate-50 lg:mt-2 lg:w-full lg:px-4 lg:py-3 lg:text-left lg:text-sm"
                >
                  Treatment Record
                </button>

                <button
                  onClick={() => setActive("settings")}
                  className={`rounded-xl px-3 py-2 text-center text-xs font-bold transition lg:mt-2 lg:w-full lg:px-4 lg:py-3 lg:text-left lg:text-sm ${
                    active === "settings"
                      ? "bg-slate-900 text-white"
                      : "text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  Settings
                </button>
                <button
                  onClick={logout}
                  className="rounded-xl px-3 py-2 text-center text-xs font-bold text-red-600 hover:bg-red-50 lg:hidden"
                >
                  Logout
                </button>
              </div>

              <div className="my-3 border-t border-slate-100" />

              <button
                onClick={logout}
                className="hidden w-full rounded-xl px-4 py-3 text-left text-sm font-bold text-red-600 hover:bg-red-50 lg:block"
              >
                Logout
              </button>
            </div>
          </aside>

          <section className="space-y-6">
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div
                className="p-6"
                style={{
                  background: "linear-gradient(90deg, rgba(14,75,90,1) 0%, rgba(27,166,200,1) 100%)",
                }}
              >
                <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-4">
                      <div className="relative h-16 w-16 overflow-hidden rounded-2xl bg-white/15 ring-1 ring-white/20">
                        {photoUrl ? (
                          <img src={photoUrl} alt={patientName} className="h-full w-full object-cover" />
                        ) : (
                          <NextImage src="/clinic6.jpg" alt={patientName} fill className="object-cover" />
                        )}
                      </div>

                    <div className="text-white">
                      <p className="text-xs font-bold text-white/85">Patient Dashboard</p>
                      <h1 className="mt-1 text-xl font-extrabold">{patientName}</h1>
                      <p className="mt-1 text-xs text-white/80">{user.email}</p>
                    </div>
                  </div>

                  <div className="flex gap-3" />
                </div>
              </div>

              <div className="p-6">
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-[11px] font-bold text-slate-500">Upcoming</p>
                      <p className="mt-1 text-lg font-extrabold text-slate-900">
                        {appointments.filter((a) => String((a as any).status).toLowerCase() === "pending").length}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] font-bold text-slate-500">Bookings</p>
                      <p className="mt-1 text-lg font-extrabold text-slate-900">{appointments.length}</p>
                    </div>
                    <div>
                      <p className="text-[11px] font-bold text-slate-500">Role</p>
                      <p className="mt-1 text-xs font-extrabold uppercase tracking-wide text-slate-900">
                        {normalizedRole || "client"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {active === "dashboard" ? (
              <AppointmentsTable
                appointments={appointments}
                loading={historyLoading}
                onAddAppointment={() => setOpenBooking(true)}
                onOpenModal={openModal}
                onReschedule={handleOpenReschedule}
                onCancel={handleCancelAppointment}
                getCancelDisabledReason={getCancelDisabledReason}
                getRescheduleDisabledReason={getRescheduleDisabledReason}
              />
            ) : active === "transactions" ? (
              <div className="space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setPaymentTab("history")}
                      className={`rounded-xl px-4 py-2 text-sm font-bold transition ${
                        paymentTab === "history"
                          ? "bg-slate-900 text-white"
                          : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      Payment History
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaymentTab("installments")}
                      className={`rounded-xl px-4 py-2 text-sm font-bold transition ${
                        paymentTab === "installments"
                          ? "bg-slate-900 text-white"
                          : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      Active Installment
                    </button>
                  </div>
                </div>

                {paymentTab === "history" ? (
                  <TransactionsTable
                    appointments={appointments}
                    billingRecords={billingRecords}
                    dentistNameMap={dentistNameMap}
                    onOpenModal={(appt, bill) => {
                      setSelectedAppt(appt);
                      setSelectedBillingRecord(bill);
                      setInitialTab("transactions");
                      setOpenApptModal(true);
                    }}
                  />
                ) : (
                  <ActiveInstallmentsPanel
                    billingRecords={billingRecords}
                    appointments={appointments}
                    loading={installmentsLoading}
                  />
                )}
              </div>
            ) : recordLoading ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <p className="text-sm font-semibold text-slate-800">Loading account settings...</p>
                <div className="mt-4 space-y-3">
                  <div className="h-12 rounded-xl bg-slate-100" />
                  <div className="h-12 rounded-xl bg-slate-100" />
                  <div className="h-12 rounded-xl bg-slate-100" />
                </div>
              </div>
            ) : (
                <AccountSettingsForm
                  userDisplayName={patientName}
                  email={user.email || ""}
                  record={record}
                  userPhotoUrl={photoUrl}
                  onPhotoUpdated={setPhotoUrl}
                />
              )}
          </section>
        </div>
      </div>

      <AppointmentDetailsModal
        open={openApptModal}
        onClose={() => {
          setOpenApptModal(false);
          setSelectedBillingRecord(null);
        }}
        appointment={selectedAppt}
        billingRecord={selectedBillingRecord}
        dentistProfile={dentistName ? { uid: (selectedAppt as any)?.dentistId || "", displayName: dentistName } : null}
        dentistLoading={dentistLoading}
        brandColor={BRAND}
        initialTab={initialTab}
      />

      <BookAppointmentModal open={openBooking} onClose={() => setOpenBooking(false)} onBooked={refreshAppointments} />
      <ReschuleBookAppointmentModal
        open={openReschedule}
        appointment={selectedAppt}
        enforceThreeHourRule
        onClose={() => setOpenReschedule(false)}
        onRescheduled={async () => {
          setOpenReschedule(false);
          await refreshAppointments();
        }}
      />
      {openTreatmentRecord && user?.uid && (
        <ClientTreatmentHistoryModal
          patientId={user.uid}
          patientName={patientName}
          patientEmail={user.email || null}
          onClose={() => setOpenTreatmentRecord(false)}
        />
      )}
    
    </main>
  );
}



