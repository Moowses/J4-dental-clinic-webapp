"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/hooks/useAuth";
import { updateUserDocument } from "@/lib/services/user-service";
import { updateUserProfile } from "@/lib/services/auth-service";
import { db } from "@/lib/firebase/firebase";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
} from "firebase/firestore";
import {
  ConfirmActionModal,
  ProcessingModal,
  ResultModal,
} from "@/components/admin/ActionFeedbackModals";
import type { Appointment } from "@/lib/types/appointment";
import type { BillingRecord } from "@/lib/types/billing";

const CROP_PREVIEW_SIZE = 220;
const OUTPUT_SIZE = 512;
const LOG_LIMIT = 40;

type ActivityLogRow = {
  id: string;
  kind: "appointment" | "service" | "payment";
  kindLabel: string;
  patientName: string;
  serviceLabel: string;
  description: string;
  dateLabel: string;
  sortMs: number;
  statusLabel: string;
  statusClass: string;
};

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

function formatLogDate(value: unknown) {
  const d = toDate(value);
  if (!d) return "Unknown date";
  return d.toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatAppointmentSlot(appt: Appointment) {
  const date = String(appt.date || "").trim();
  const time = String(appt.time || "").trim();
  if (date && time) return `${date} at ${time}`;
  return date || time || "Schedule not set";
}

function toAppointmentScheduleDate(appt: Appointment): Date | null {
  const date = String(appt.date || "").trim();
  const time = String(appt.time || "").trim();
  if (!date) return null;
  const value = time ? `${date}T${time}:00` : `${date}T00:00:00`;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatAppointmentScheduleLabel(appt: Appointment) {
  const scheduledAt = toAppointmentScheduleDate(appt);
  if (!scheduledAt) return formatAppointmentSlot(appt);
  return scheduledAt.toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatMoney(value: number) {
  return `P${Number(value || 0).toLocaleString()}`;
}

function getStatusClass(kind: ActivityLogRow["kind"]) {
  if (kind === "appointment") return "border-sky-200 bg-sky-50 text-sky-700";
  if (kind === "service") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

export default function StaffAccountSettingsPanel() {
  const { user } = useAuth();
  const [displayName, setDisplayName] = useState(user?.displayName || "");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [confirmSaveOpen, setConfirmSaveOpen] = useState(false);
  const [resultModal, setResultModal] = useState<{
    tone: "success" | "error";
    title: string;
    message: string;
  } | null>(null);

  const [photoUrl, setPhotoUrl] = useState<string | null>(user?.photoURL || null);
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
  const [activityLogs, setActivityLogs] = useState<ActivityLogRow[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);

  useEffect(() => {
    setDisplayName(user?.displayName || "");
    setPhotoUrl(user?.photoURL || null);
  }, [user?.displayName, user?.photoURL]);

  useEffect(() => {
    let active = true;

    async function loadActivityLogs() {
      setLogsLoading(true);
      setLogsError(null);

      try {
        const appointmentsQuery = query(
          collection(db, "appointments"),
          orderBy("createdAt", "desc"),
          limit(LOG_LIMIT)
        );
        const billingQuery = query(
          collection(db, "billing_records"),
          orderBy("updatedAt", "desc"),
          limit(LOG_LIMIT)
        );

        const [appointmentsSnap, billingSnap] = await Promise.all([
          getDocs(appointmentsQuery),
          getDocs(billingQuery),
        ]);

        const appointments = appointmentsSnap.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as Appointment[];
        const billingRecords = billingSnap.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as BillingRecord[];

        const patientIds = Array.from(
          new Set(
            [...appointments, ...billingRecords]
              .map((row) => String((row as { patientId?: string }).patientId || "").trim())
              .filter(Boolean)
          )
        );

        const patientPairs = await Promise.all(
          patientIds.map(async (uid) => {
            try {
              const snap = await getDoc(doc(db, "users", uid));
              return snap;
            } catch {
              return null;
            }
          })
        );

        const patientNameMap = new Map<string, string>();
        for (let i = 0; i < patientIds.length; i += 1) {
          const uid = patientIds[i];
          const userSnap = patientPairs[i];
          const data = userSnap?.data() as { displayName?: string; email?: string } | undefined;
          patientNameMap.set(uid, String(data?.displayName || data?.email || uid).trim());
        }

        const appointmentMap = new Map<string, Appointment>();
        appointments.forEach((appt) => appointmentMap.set(String(appt.id || ""), appt));

        const rows: ActivityLogRow[] = [];

        appointments.forEach((appt) => {
          const patientId = String(appt.patientId || "").trim();
          const patientName = patientNameMap.get(patientId) || patientId || "Unknown patient";
          const serviceLabel = String(appt.serviceType || "Appointment").trim() || "Appointment";
          const scheduledAt = toAppointmentScheduleDate(appt);

          rows.push({
            id: `appt-${appt.id}`,
            kind: "appointment",
            kindLabel: "Appointment",
            patientName,
            serviceLabel,
            description: `Appointment booked for ${formatAppointmentSlot(appt)}`,
            dateLabel: formatAppointmentScheduleLabel(appt),
            sortMs: scheduledAt?.getTime() || toDate(appt.createdAt)?.getTime() || 0,
            statusLabel: String(appt.status || "pending").replace(/_/g, " "),
            statusClass: getStatusClass("appointment"),
          });

          if (appt.treatment?.completedAt) {
            const procedures = Array.isArray(appt.treatment.procedures)
              ? appt.treatment.procedures.map((p) => String(p?.name || "").trim()).filter(Boolean)
              : [];
            rows.push({
              id: `svc-${appt.id}`,
              kind: "service",
              kindLabel: "Service Availed",
              patientName,
              serviceLabel: procedures[0] || serviceLabel,
              description: procedures.length
                ? `Services availed: ${procedures.join(", ")}`
                : `Service availed: ${serviceLabel}`,
              dateLabel: formatAppointmentScheduleLabel(appt),
              sortMs: scheduledAt?.getTime() || toDate(appt.treatment.completedAt)?.getTime() || 0,
              statusLabel: `Completed • ${formatMoney(Number(appt.treatment.totalBill || 0))}`,
              statusClass: getStatusClass("service"),
            });
          }
        });

        billingRecords.forEach((bill) => {
          const patientId = String(bill.patientId || "").trim();
          const patientName = patientNameMap.get(patientId) || patientId || "Unknown patient";
          const appt = appointmentMap.get(String(bill.appointmentId || ""));
          const fallbackService = String(appt?.serviceType || "Payment").trim() || "Payment";

          (Array.isArray(bill.transactions) ? bill.transactions : []).forEach((tx) => {
            const items = Array.isArray(bill.items)
              ? bill.items.map((item) => String(item?.name || "").trim()).filter(Boolean)
              : [];
            rows.push({
              id: `pay-${bill.id}-${String(tx.id || Math.random())}`,
              kind: "payment",
              kindLabel: "Payment",
              patientName,
              serviceLabel: items[0] || fallbackService,
              description: items.length
                ? `Payment for ${items.join(", ")}`
                : `Payment for ${fallbackService}`,
              dateLabel: formatLogDate(tx.date),
              sortMs: toDate(tx.date)?.getTime() || 0,
              statusLabel: `${String(tx.method || "cash").toUpperCase()} • ${formatMoney(Number(tx.amount || 0))}`,
              statusClass: getStatusClass("payment"),
            });
          });
        });

        rows.sort((a, b) => b.sortMs - a.sortMs);
        if (active) setActivityLogs(rows.slice(0, LOG_LIMIT));
      } catch (error) {
        if (active) {
          setLogsError(error instanceof Error ? error.message : "Failed to load activity logs.");
        }
      } finally {
        if (active) setLogsLoading(false);
      }
    }

    loadActivityLogs();
    return () => {
      active = false;
    };
  }, []);

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
      const name = displayName?.trim() || user.displayName || "Staff";
      await updateUserProfile(user, { displayName: name.length >= 2 ? name : "Staff", photoURL: url });

      setPhotoUrl(url);
      setPhotoSrc(null);
      setImageMeta(null);
      imageRef.current = null;
    } catch (err: unknown) {
      setPhotoError(err instanceof Error ? err.message : "Failed to upload photo.");
    } finally {
      setUploadingPhoto(false);
    }
  };

  const executeSaveName = async () => {
    if (!user) return;
    const nextName = displayName.trim();
    if (nextName.length < 2) {
      setStatus("Name must be at least 2 characters.");
      return;
    }

    setSaving(true);
    setStatus(null);
    try {
      await updateUserDocument(user.uid, { displayName: nextName });
      await updateUserProfile(user, { displayName: nextName, photoURL: user.photoURL || "" });
      setStatus("Saved.");
      setResultModal({
        tone: "success",
        title: "Success",
        message: "Account settings updated successfully.",
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to save.";
      setStatus(message);
      setResultModal({
        tone: "error",
        title: "Save Failed",
        message,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveName = async () => {
    if (!user) return;
    const nextName = displayName.trim();
    if (nextName.length < 2) {
      setStatus("Name must be at least 2 characters.");
      return;
    }
    setConfirmSaveOpen(true);
  };

  return (
    <div className="space-y-6">
      {saving ? <ProcessingModal title="Processing" message="Saving account settings..." /> : null}
      {confirmSaveOpen ? (
        <ConfirmActionModal
          title="Confirm action"
          message="Are you sure you want to save these account changes?"
          confirmLabel="Save Changes"
          onCancel={() => setConfirmSaveOpen(false)}
          onConfirm={async () => {
            setConfirmSaveOpen(false);
            await executeSaveName();
          }}
        />
      ) : null}
      {resultModal ? (
        <ResultModal
          tone={resultModal.tone}
          title={resultModal.title}
          message={resultModal.message}
          onClose={() => setResultModal(null)}
        />
      ) : null}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-extrabold text-slate-900">Account Settings</h3>
            <p className="mt-2 text-sm text-slate-600">
              Update your display name and profile photo.
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-4">
                <div className="relative h-20 w-20 overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
                  {photoUrl ? (
                    <img src={photoUrl} alt="Profile" className="h-full w-full object-cover" />
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
                    className="h-56 w-56 rounded-2xl border border-slate-200 bg-white"
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
              <label className="text-xs font-bold text-slate-600">Display Name</label>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-slate-300"
                placeholder="Full name"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-600">Email</label>
              <input
                value={user?.email || ""}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500 outline-none"
                disabled
              />
            </div>
          </div>

          <button
            type="button"
            onClick={handleSaveName}
            disabled={saving}
            className="inline-flex w-full justify-center rounded-xl bg-teal-700 px-5 py-3 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>

          {status && <p className="text-xs font-extrabold text-slate-600">{status}</p>}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-extrabold text-slate-900">Recent Activity Logs</h3>
            <p className="mt-2 text-sm text-slate-600">
              Tracks appointment entries, services availed, and payment transactions with patient names.
            </p>
          </div>
        </div>

        <div className="mt-5">
          {logsLoading ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-700">
              Loading activity logs...
            </div>
          ) : logsError ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">
              {logsError}
            </div>
          ) : !activityLogs.length ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-700">
              No logs found yet.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-4 py-3">Booked / Logged At</th>
                    <th className="px-4 py-3">Patient Name</th>
                    <th className="px-4 py-3">Service</th>
                    <th className="px-4 py-3">Details</th>
                    <th className="px-4 py-3">Type</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {activityLogs.map((row) => (
                    <tr key={row.id} className="align-top">
                      <td className="px-4 py-4 text-slate-700">{row.dateLabel}</td>
                      <td className="px-4 py-4 font-bold text-slate-900">{row.patientName}</td>
                      <td className="px-4 py-4 text-slate-800">{row.serviceLabel}</td>
                      <td className="px-4 py-4 text-slate-700">{row.description}</td>
                      <td className="px-4 py-4">
                        <div className="flex flex-col gap-2">
                          <span
                            className={`inline-flex w-fit rounded-full border px-2.5 py-1 text-xs font-bold uppercase ${row.statusClass}`}
                          >
                            {row.kindLabel}
                          </span>
                          <span className="text-xs font-semibold text-slate-600">{row.statusLabel}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
