"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/hooks/useAuth";
import { updateUserDocument } from "@/lib/services/user-service";
import { updateUserProfile } from "@/lib/services/auth-service";

const CROP_PREVIEW_SIZE = 220;
const OUTPUT_SIZE = 512;
const PROCEED_PROMPT = "Are you sure to proceed?";

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

export default function StaffAccountSettingsPanel() {
  const { user } = useAuth();
  const [displayName, setDisplayName] = useState(user?.displayName || "");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

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

  useEffect(() => {
    setDisplayName(user?.displayName || "");
    setPhotoUrl(user?.photoURL || null);
  }, [user?.displayName, user?.photoURL]);

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
    } catch (err: any) {
      setPhotoError(err?.message || "Failed to upload photo.");
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleSaveName = async () => {
    if (!user) return;
    if (typeof window !== "undefined" && !window.confirm(PROCEED_PROMPT)) return;
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
    } catch (err: any) {
      setStatus(err?.message || "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
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
    </div>
  );
}
