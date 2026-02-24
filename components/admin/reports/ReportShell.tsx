"use client";

import type { ReactNode } from "react";

export default function ReportShell({
  reportName,
  subtitle,
  children,
  empty,
}: {
  reportName: string;
  subtitle?: string;
  children: ReactNode;
  empty?: { title: string; description?: string };
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="border-b border-slate-200 p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-extrabold tracking-wide text-slate-900">
              J4 Dental Clinic
            </p>
            <p className="text-xl font-extrabold text-slate-900">{reportName}</p>
            {subtitle ? (
              <p className="text-sm text-slate-500 mt-1">{subtitle}</p>
            ) : null}
          </div>

          <div />
        </div>
      </div>

      {/* Body */}
      <div className="p-5">
        {empty ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center">
            <p className="text-sm font-bold text-slate-900">{empty.title}</p>
            {empty.description ? (
              <p className="mt-1 text-sm text-slate-600">{empty.description}</p>
            ) : null}
          </div>
        ) : (
          children
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-slate-200 p-4 text-xs text-slate-500">
        End of report.
      </div>
    </div>
  );
}
