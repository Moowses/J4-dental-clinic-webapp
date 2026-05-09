"use client";

import React from "react";

export function ConfirmActionModal({
  title = "Confirm action",
  message,
  details,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "default",
  onCancel,
  onConfirm,
}: {
  title?: string;
  message: string;
  details?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const confirmClass =
    tone === "danger"
      ? "bg-rose-600 hover:bg-rose-700"
      : "bg-slate-900 hover:opacity-95";

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onMouseDown={onCancel} />
      <div className="relative w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <div className="text-lg font-extrabold text-slate-900">{title}</div>
          <div className="text-sm text-slate-500 mt-1">{message}</div>
        </div>

        <div className="p-6 space-y-4">
          {details ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              {details}
            </div>
          ) : null}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-extrabold text-slate-700 hover:bg-slate-50"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className={`flex-1 rounded-xl px-4 py-3 text-sm font-extrabold text-white ${confirmClass}`}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ProcessingModal({
  title = "Processing",
  message,
}: {
  title?: string;
  message: string;
}) {
  const loaderBars = Array.from({ length: 12 });

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <div className="text-lg font-extrabold text-slate-900">{title}</div>
        </div>

        <div className="px-6 py-8">
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

            <div className="mt-5 h-2.5 w-full max-w-[240px] overflow-hidden rounded-full bg-sky-100 shadow-inner">
              <div className="h-full w-2/3 animate-pulse rounded-full bg-gradient-to-r from-[#5da6ff] via-[#2d7ef7] to-[#7bc6ff]" />
            </div>

            <div className="mt-5 text-center">
              <div className="text-[15px] font-black uppercase tracking-[0.22em] text-[#3f7ee8]">
                Please Wait
              </div>
              <div className="mt-1 text-xs font-medium text-slate-500">{message}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ResultModal({
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
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
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
                isSuccess ? "border-emerald-100 bg-emerald-50" : "border-rose-100 bg-rose-50"
              }`}
            >
              <div className={`text-3xl font-black ${isSuccess ? "text-emerald-600" : "text-rose-600"}`}>
                {isSuccess ? "OK" : "!"}
              </div>
            </div>

            <p className="mt-4 text-sm text-slate-600">{message}</p>

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
