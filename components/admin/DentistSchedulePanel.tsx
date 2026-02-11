"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getDentistScheduleAction } from "@/app/actions/appointment-actions";
import {
  getTreatmentToolsAction,
  completeTreatmentAction,
} from "@/app/actions/treatment-actions";
import { getPatientTreatmentHistoryAction } from "@/app/actions/appointment-admin-actions";

import { Odontogram } from "react-odontogram";
import { formatTime12h } from "@/lib/utils/time";
import { getUserDisplayNameByUid } from "@/lib/services/user-service";
import { getPatientRecord } from "@/lib/services/patient-service";
import { auth } from "@/lib/firebase/firebase";

import type { Appointment } from "@/lib/types/appointment";
import type { DentalProcedure } from "@/lib/types/clinic";
import type { InventoryItem } from "@/lib/types/inventory";

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100">
        <h3 className="text-lg font-extrabold text-slate-900">{title}</h3>
        {subtitle ? <p className="text-sm text-slate-500">{subtitle}</p> : null}
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

const inputBase =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-300";

function StatusPill({ status }: { status: string }) {
  const s = (status || "").toLowerCase();
  const cls =
    s === "pending"
      ? "bg-orange-50 text-orange-700 border-orange-200"
      : s === "confirmed"
        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
        : s === "completed"
          ? "bg-blue-50 text-blue-700 border-blue-200"
          : s === "cancelled"
            ? "bg-red-50 text-red-700 border-red-200"
            : "bg-slate-50 text-slate-700 border-slate-200";

  return (
    <span
      className={`inline-flex items-center px-3 py-1 rounded-full border text-[11px] font-extrabold uppercase tracking-wide ${cls}`}
    >
      {status}
    </span>
  );
}

function toISODate(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString().split("T")[0];
}

function addDays(isoDate: string, days: number) {
  const d = new Date(isoDate + "T00:00:00");
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

function formatNiceDate(isoDate: string) {
  const d = new Date(isoDate + "T00:00:00");
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
}

function formatRangeLabel(startISO: string, days: number) {
  const start = new Date(startISO + "T00:00:00");
  const end = new Date(startISO + "T00:00:00");
  end.setDate(end.getDate() + (days - 1));

  const startLabel = start.toLocaleDateString(undefined, {
    month: "short",
    day: "2-digit",
  });
  const endLabel = end.toLocaleDateString(undefined, {
    month: "short",
    day: "2-digit",
    year: "numeric",
  });

  return `${startLabel} – ${endLabel}`;
}

function formatLocalYMD(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseLocalYMD(ymd: string) {
  return new Date(`${ymd}T00:00:00`);
}

function parseTimeToSortable(time?: string) {
  if (!time) return "99:99";
  const t = time.trim().toUpperCase();

  const hhmm = t.match(/^(\d{1,2}):(\d{2})$/);
  if (hhmm) {
    const h = String(hhmm[1]).padStart(2, "0");
    const m = String(hhmm[2]).padStart(2, "0");
    return `${h}:${m}`;
  }

  const ampm = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const m = String(ampm[2]).padStart(2, "0");
    const ap = ampm[3];
    if (ap === "AM") {
      if (h === 12) h = 0;
    } else {
      if (h !== 12) h += 12;
    }
    return `${String(h).padStart(2, "0")}:${m}`;
  }

  return "99:99";
}

function universalToFdi(universal: number) {
  if (universal >= 1 && universal <= 8) return 19 - universal;
  if (universal >= 9 && universal <= 16) return universal + 12;
  if (universal >= 17 && universal <= 24) return 55 - universal;
  if (universal >= 25 && universal <= 32) return universal + 16;
  return null;
}

function fdiToUniversal(fdi: number) {
  if (fdi >= 11 && fdi <= 18) return 19 - fdi;
  if (fdi >= 21 && fdi <= 28) return fdi - 12;
  if (fdi >= 31 && fdi <= 38) return 55 - fdi;
  if (fdi >= 41 && fdi <= 48) return fdi - 16;
  return null;
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
    return null;
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

function toothToUniversal(tooth: any) {
  return (
    tooth?.notations?.universal ||
    tooth?.notations?.fdi ||
    String(tooth?.id || "").replace("teeth-", "")
  );
}

function payloadToUniversal(payload: any) {
  const raw = payload?.notations?.universal || payload?.notations?.fdi || "";
  if (!raw) return "";
  const num = Number(raw);
  if (Number.isFinite(num)) return String(num);
  return String(raw);
}

function toMillis(value: any) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? 0 : d.getTime();
  }
  if (typeof value === "object") {
    if (typeof (value as any).toMillis === "function") return (value as any).toMillis();
    if (typeof (value as any).seconds === "number") return (value as any).seconds * 1000;
  }
  return 0;
}

function buildChartHistory(
  groups: Array<{
    date?: string;
    time?: string;
    completedAt?: any;
    dentalChart?: Record<string, { status?: string; notes?: string }>;
  }>
) {
  const map: Record<string, Array<{ date: string; status?: string; notes?: string }>> = {};
  const formatLabel = (g: { date?: string; time?: string; completedAt?: any }) => {
    if (g.date && g.time) return `${g.date} ${g.time}`;
    if (g.date) return g.date;
    const ts = toMillis(g.completedAt);
    if (ts) return new Date(ts).toLocaleString();
    return "Unknown date";
  };

  for (const g of groups || []) {
    const label = formatLabel(g);
    const chart = g.dentalChart || {};
    for (const [rawKey, entry] of Object.entries(chart)) {
      const uniKey = keyToUniversal(rawKey);
      if (!uniKey) continue;
      const status =
        (entry as any)?.status ??
        (entry as any)?.state ??
        (entry as any)?.condition ??
        "";
      const notes =
        (entry as any)?.notes ??
        (entry as any)?.note ??
        (entry as any)?.description ??
        "";
      if (!status && !notes) continue;
      if (!map[uniKey]) map[uniKey] = [];
      map[uniKey].push({ date: label, status: String(status || ""), notes: String(notes || "") });
    }
  }

  Object.values(map).forEach((list) => {
    list.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  });

  return map;
}

function DentalChartModal({
  open,
  chart,
  history,
  historyLoading,
  onClose,
  onSave,
}: {
  open: boolean;
  chart: Record<string, { status?: string; notes?: string }>;
  history?: Record<string, Array<{ date: string; status?: string; notes?: string }>>;
  historyLoading?: boolean;
  onClose: () => void;
  onSave: (chart: Record<string, { status?: string; notes?: string }>) => void;
}) {
  const [draft, setDraft] = useState<Record<string, { status?: string; notes?: string }>>({});
  const [toothNumber, setToothNumber] = useState("");
  const [status, setStatus] = useState("");
  const [notes, setNotes] = useState("");
  const [extracted, setExtracted] = useState(false);
  const [selectedTeeth, setSelectedTeeth] = useState<any[]>([]);
  const pendingRef = React.useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(chart || {});
    setToothNumber("");
    setStatus("");
    setNotes("");
    setExtracted(false);
    setSelectedTeeth([]);
  }, [open, chart]);

  if (!open) return null;
  const confirmProceed = () => window.confirm("Are you sure you want to proceed?");

  const isExtractedEntry = (entry?: { status?: string; notes?: string }) => {
    const statusValue = String(entry?.status || "").toLowerCase();
    const notesValue = String(entry?.notes || "").toLowerCase();
    return (
      statusValue.includes("extract") ||
      statusValue.includes("removed") ||
      statusValue.includes("denture") ||
      notesValue.includes("extract") ||
      notesValue.includes("removed") ||
      notesValue.includes("denture")
    );
  };

  const rows = Object.entries(draft);
  const initialSelected = rows
    .map(([key]) => keyToToothId(key))
    .filter(Boolean) as string[];

  const historyMap = history || {};
  const extractedSelected = Array.from(
    new Set(
      Object.entries(historyMap)
        .filter(([_, entries]) => entries.some((e) => isExtractedEntry(e)))
        .map(([key]) => keyToToothId(key))
        .filter(Boolean) as string[]
    )
  );
  const notedSelected = Array.from(
    new Set(
      Object.entries(historyMap)
        .filter(([key, entries]) => {
          const toothId = keyToToothId(key);
          if (toothId && extractedSelected.includes(toothId)) return false;
          return entries.some((e) => {
            const statusValue = String(e.status || "").trim();
            const notesValue = String(e.notes || "").trim();
            return Boolean(statusValue || notesValue);
          });
        })
        .map(([key]) => keyToToothId(key))
        .filter(Boolean) as string[]
    )
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-[920px] rounded-2xl bg-white shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <h3 className="text-lg font-extrabold text-slate-900">Dental Chart</h3>
          <p className="text-xs text-slate-500 mt-0.5">Add or update tooth notes</p>
          <div className="mt-2 text-[11px] text-slate-500 space-y-1">
            <p>1) Click a tooth to load current notes.</p>
            <p>2) Use “Extracted” for removed teeth (marks black).</p>
            <p>3) Add / Update, then Save Dental Chart.</p>
            <p>Yellow = teeth with notes, Black = extracted.</p>
          </div>
        </div>

        <div className="p-5 space-y-4 max-h-[72vh] overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-[140px_160px_1fr] gap-3">
            <input
              value={toothNumber}
              onChange={(e) => setToothNumber(e.target.value)}
              className={inputBase}
              placeholder="Tooth #"
            />
            <input
              value={status}
              onChange={(e) => {
                const next = e.target.value;
                setStatus(next);
                if (next.toLowerCase().includes("extract")) setExtracted(true);
              }}
              className={inputBase}
              placeholder="Status (e.g. caries)"
            />
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={inputBase}
              placeholder="Notes"
            />
          </div>
          <label className="flex items-center gap-2 text-xs font-extrabold text-slate-600 uppercase tracking-widest">
            <input
              type="checkbox"
              checked={extracted}
              onChange={(e) => {
                const next = e.target.checked;
                setExtracted(next);
                if (next) setStatus("extracted");
              }}
              className="h-4 w-4 rounded border-slate-300 text-slate-900"
            />
            Extracted
            {extracted ? (
              <span className="text-[11px] font-normal normal-case text-slate-500">
                (overrides status)
              </span>
            ) : null}
          </label>

          <div className="rounded-2xl border border-slate-200 bg-white p-2.5 max-w-[700px] mx-auto">
            <p className="text-xs font-extrabold uppercase tracking-widest text-slate-600">
              Adult Chart (1-32)
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Click a tooth to load its notes below, then use Add/Update and Save. Finalize Treatment to store in records.
            </p>
            {historyLoading ? (
              <p className="mt-2 text-xs text-slate-500">Loading history...</p>
            ) : Object.keys(historyMap).length === 0 ? (
              <p className="mt-2 text-xs text-slate-500">No prior dental chart history found.</p>
            ) : (
              <div className="mt-2 grid gap-2 text-xs text-slate-600 sm:grid-cols-3">
                <div className="inline-flex items-center gap-2">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-400" />
                  Teeth with notes
                </div>
                <div className="inline-flex items-center gap-2">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-slate-900" />
                  Extracted / removed / dentures
                </div>
                <div className="inline-flex items-center gap-2">Hover teeth to view history</div>
              </div>
            )}
            <div className="mt-3 relative mx-auto w-[52%] min-w-[190px]">
              <div className="absolute inset-0 pointer-events-none">
                <Odontogram
                  key={`history-extracted-${extractedSelected.join(",")}`}
                  defaultSelected={extractedSelected}
                  theme="light"
                  colors={{ lightBlue: "#0f172a", darkBlue: "#0f172a", baseBlue: "#0f172a" }}
                  tooltip={{ content: () => null }}
                  showTooltip={false}
                />
              </div>
              <div className="absolute inset-0 pointer-events-none">
                <Odontogram
                  key={`history-notes-${notedSelected.join(",")}`}
                  defaultSelected={notedSelected}
                  theme="light"
                  colors={{ lightBlue: "#fbbf24", darkBlue: "#f59e0b", baseBlue: "#fde68a" }}
                  tooltip={{ content: () => null }}
                  showTooltip={false}
                />
              </div>
              <div className="relative">
                <Odontogram
                  key={initialSelected.join(",")}
                  defaultSelected={initialSelected}
                  theme="light"
                  colors={{}}
                  tooltip={{
                    content: (payload: any) => {
                      const key = payloadToUniversal(payload);
                      const entry = key ? draft[key] : null;
                      const entries = key ? historyMap[key] || [] : [];
                      return (
                        <div>
                          <div>Tooth: {key || "—"}</div>
                          <div>Current Status: {entry?.status || "—"}</div>
                          <div>Current Notes: {entry?.notes || "—"}</div>
                          {entries.length ? (
                            <div className="mt-2">
                              <div className="text-[11px] font-extrabold uppercase tracking-widest text-slate-600">
                                History
                              </div>
                              <div className="mt-1 space-y-1">
                                {entries.map((e, idx) => (
                                  <div key={`${key}-${idx}`}>
                                    <div>{e.date}</div>
                                    <div>
                                      Status: {e.status || "—"}
                                      {isExtractedEntry(e) ? " (Extracted)" : ""}
                                    </div>
                                    <div>Notes: {e.notes || "—"}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    },
                  }}
                  onChange={(next: any) => {
                    if (!next || typeof next !== "object") return;
                    const list = Array.isArray(next) ? next : [];
                    if (!list.length) return;
                    const picked = list[list.length - 1];
                    const key = String(toothToUniversal(picked) || "").trim();
                    if (!key) return;
                    if (pendingRef.current) {
                      window.clearTimeout(pendingRef.current);
                    }
                    pendingRef.current = window.setTimeout(() => {
                      setToothNumber(key);
                      setStatus(draft[key]?.status || "");
                      setNotes(draft[key]?.notes || "");
                      setExtracted(isExtractedEntry(draft[key]));
                      setSelectedTeeth(list);
                    }, 0);
                  }}
                />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (!confirmProceed()) return;
                const key = toothNumber.trim();
                if (!key) return;
                const next = {
                  ...draft,
                  [key]: {
                    status: extracted ? "extracted" : status.trim() || undefined,
                    notes: notes.trim() || undefined,
                  },
                };
                setDraft(next);
                setToothNumber("");
                setStatus("");
                setNotes("");
                setExtracted(false);
              }}
              className="px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-extrabold hover:bg-black"
            >
              Add / Update
            </button>
            <button
              onClick={() => {
                setToothNumber("");
                setStatus("");
                setNotes("");
                setExtracted(false);
              }}
              className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-extrabold hover:bg-slate-50"
            >
              Clear
            </button>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-extrabold uppercase tracking-widest text-slate-600">
              Entries
            </p>
            {rows.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">No dental chart entries yet.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {rows.map(([tooth, entry]) => (
                  <div
                    key={tooth}
                    className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-extrabold text-slate-900">Tooth {tooth}</p>
                      <p className="text-xs text-slate-600">
                        {entry.status || "No status"}{" "}
                        {entry.notes ? `- ${entry.notes}` : ""}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        const next = { ...draft };
                        delete next[tooth];
                        setDraft(next);
                      }}
                      className="text-xs font-extrabold text-rose-600 hover:text-rose-700"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <button
              onClick={() => {
                if (!confirmProceed()) return;
                onSave(draft);
                onClose();
              }}
              className="w-full rounded-xl bg-emerald-700 py-3 text-white font-black hover:bg-emerald-800 transition"
            >
              Save Dental Chart
            </button>
            <button
              onClick={onClose}
              className="w-full text-center text-sm text-slate-500 hover:text-slate-700"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TreatmentModal({
  appointment,
  onClose,
  onComplete,
}: {
  appointment: Appointment;
  onClose: () => void;
  onComplete: () => void;
}) {
  const [tools, setTools] = useState<{
    procedures: (DentalProcedure & {
      requiredInventory?: { inventoryItemId: string; quantity: number }[];
    })[];
    inventory: InventoryItem[];
  } | null>(null);

  const [procList, setProcList] = useState<
    {
      id: string;
      name: string;
      price: number;
      toothNumber: string;
      isCustom: boolean;
    }[]
  >([]);

    const [usedInv, setUsedInv] = useState<{ [id: string]: number }>({});
    const [notes, setNotes] = useState("");
    const [isSaving, setIsSaving] = useState(false);
    const [chartOpen, setChartOpen] = useState(false);
    const [dentalChart, setDentalChart] = useState<
      Record<string, { status?: string; notes?: string }>
    >({});
    const [historyMap, setHistoryMap] = useState<
      Record<string, Array<{ date: string; status?: string; notes?: string }>>
    >({});
    const [historyLoading, setHistoryLoading] = useState(false);
    const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    getTreatmentToolsAction().then((res) => {
      if (res.success && res.data) setTools(res.data as any);
    });
  }, []);

  useEffect(() => {
    setHistoryMap({});
    setHistoryLoading(false);
  }, [appointment.id]);

  useEffect(() => {
    if (!chartOpen) return;
    const patientId = String((appointment as any)?.patientId || "").trim();
    if (!patientId) return;

    let active = true;
    setHistoryLoading(true);
    (async () => {
      const token = await auth.currentUser?.getIdToken();
      if (!token) {
        if (active) setHistoryLoading(false);
        return;
      }
      const res = await getPatientTreatmentHistoryAction({
        patientId,
        idToken: token,
      });
      if (!active) return;
      if (!res?.success || !res.data) {
        setHistoryMap({});
        setHistoryLoading(false);
        return;
      }
      setHistoryMap(buildChartHistory(res.data.groups || []));
      setHistoryLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [chartOpen, appointment]);

  const addProcedure = (p: any) => {
    setProcList([
      ...procList,
      {
        id: p.id,
        name: p.name,
        price: p.basePrice,
        toothNumber: "",
        isCustom: false,
      },
    ]);

    if (p.requiredInventory && p.requiredInventory.length > 0) {
      const newUsedInv = { ...usedInv };
      p.requiredInventory.forEach((item: any) => {
        newUsedInv[item.inventoryItemId] =
          (newUsedInv[item.inventoryItemId] || 0) + item.quantity;
      });
      setUsedInv(newUsedInv);
    }
  };

  const addCustomProcedure = () => {
    setProcList([
      ...procList,
      {
        id: crypto.randomUUID(),
        name: "Custom Procedure",
        price: 0,
        toothNumber: "",
        isCustom: true,
      },
    ]);
  };

  const removeProcedure = (index: number) => {
    setProcList(procList.filter((_, i) => i !== index));
  };

  const updateProcedure = (
    index: number,
    field: "name" | "price" | "toothNumber",
    value: any,
  ) => {
    const newList = [...procList];
    newList[index] = { ...newList[index], [field]: value };
    setProcList(newList);
  };

  const estimatedTotal = useMemo(() => {
    return procList.reduce((sum, p) => sum + Number(p.price || 0), 0);
  }, [procList]);

  const inventorySummary = useMemo(() => {
    return (
      tools?.inventory
        .filter((i) => usedInv[i.id] > 0)
        .map((i) => ({ id: i.id, name: i.name, quantity: usedInv[i.id] })) || []
    );
  }, [tools, usedInv]);

  const dentalChartCount = useMemo(() => {
    return Object.keys(dentalChart || {}).length;
  }, [dentalChart]);

  const handleSave = async () => {
    setIsSaving(true);
    const res = await completeTreatmentAction(appointment.id, {
      notes,
      dentalChart: Object.keys(dentalChart).length ? dentalChart : undefined,
      imageUrls: imageUrls.length ? imageUrls : undefined,
      procedures: procList.map((p) => ({
        id: p.id,
        name: p.name,
        price: Number(p.price),
        toothNumber: p.toothNumber,
        })),
        inventoryUsed: inventorySummary,
      });

    if (res.success) {
      onComplete();
      onClose();
    } else {
      alert(res.error);
    }
    setIsSaving(false);
  };

  const uploadImages = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;
    if (!cloudName || !uploadPreset) {
      setUploadError("Cloudinary env vars missing.");
      return;
    }

    setUploading(true);
    setUploadError(null);
    setUploadProgress(0);
    const nextUrls: string[] = [];

    const fileList = Array.from(files);
    const uploadSingle = (file: File, index: number, total: number) =>
      new Promise<string | null>((resolve, reject) => {
        const form = new FormData();
        form.append("file", file);
        form.append("upload_preset", uploadPreset);

        const xhr = new XMLHttpRequest();
        xhr.open("POST", `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`);
        xhr.upload.onprogress = (evt) => {
          if (!evt.lengthComputable) return;
          const overall = (index + evt.loaded / evt.total) / total;
          setUploadProgress(Math.round(overall * 100));
        };
        xhr.onload = () => {
          try {
            const data = JSON.parse(xhr.responseText || "{}");
            if (xhr.status >= 200 && xhr.status < 300 && data?.secure_url) {
              resolve(String(data.secure_url));
              return;
            }
            reject(new Error(data?.error?.message || "Upload failed"));
          } catch {
            reject(new Error("Upload failed"));
          }
        };
        xhr.onerror = () => reject(new Error("Upload failed"));
        xhr.send(form);
      });

    for (let i = 0; i < fileList.length; i += 1) {
      const file = fileList[i];
      try {
        const url = await uploadSingle(file, i, fileList.length);
        if (url) nextUrls.push(url);
      } catch (err: any) {
        setUploadError(err?.message || "Failed to upload image.");
      }
    }

    if (nextUrls.length) {
      setImageUrls((prev) => [...prev, ...nextUrls]);
    }
    setUploading(false);
    setUploadProgress(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-4xl rounded-2xl bg-white shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200">
          <h3 className="text-base font-extrabold text-slate-900">
            Record Treatment — {appointment.serviceType}
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5">Dentist tools</p>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5 max-h-[78vh] overflow-y-auto">
          {/* Notes top */}
          <textarea
            placeholder="Clinical Notes..."
            className="w-full rounded-xl border border-slate-200 bg-white p-3 h-24 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/15"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-extrabold text-slate-900">Dental Chart</p>
                  <p className="text-[11px] text-slate-500">
                    Entries: {Object.keys(dentalChart).length}
                  </p>
                </div>
                <button
                  onClick={() => setChartOpen(true)}
                  className="text-[11px] font-extrabold text-black px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50"
                >
                  Open Dental Chart
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-extrabold text-slate-900">Attachments</p>
                  <p className="text-[11px] text-slate-500">
                    Add photos for this appointment (multiple allowed).
                  </p>
                </div>
                <label className="text-[11px] font-extrabold text-black px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer">
                  {uploading ? "Uploading..." : "Upload Images"}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => uploadImages(e.target.files)}
                    disabled={uploading}
                  />
                </label>
              </div>

              {uploadError ? (
                <p className="mt-2 text-[11px] font-extrabold text-rose-600">{uploadError}</p>
              ) : null}

              {uploading && (
                <div className="mt-3">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full bg-slate-900 transition-all"
                      style={{ width: `${uploadProgress ?? 0}%` }}
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {uploadProgress ?? 0}%
                  </p>
                </div>
              )}

              {imageUrls.length > 0 ? (
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {imageUrls.map((url, idx) => (
                    <div key={`${url}_${idx}`} className="relative group">
                      <img
                        src={url}
                        alt={`Attachment ${idx + 1}`}
                        className="h-28 w-full object-cover rounded-xl border border-slate-200"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setImageUrls((prev) => prev.filter((_, i) => i !== idx))
                        }
                        className="absolute top-2 right-2 rounded-full bg-white/90 border border-slate-200 text-slate-700 text-xs px-2 py-1 opacity-0 group-hover:opacity-100 transition"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-[11px] text-slate-500">No images uploaded yet.</p>
              )}
            </div>
          </div>

          {/* Two panels */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* LEFT: Procedures */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs font-extrabold text-slate-900">Procedures</p>

                {/* Keep functionality: add from catalog + custom */}
                <div className="flex items-center gap-2">
                  <select
                    className="text-[11px] px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/15"
                    onChange={(e) => {
                      const p = tools?.procedures.find(
                        (proc) => proc.id === e.target.value,
                      );
                      if (p) addProcedure(p);
                      e.target.value = "";
                    }}
                  >
                    <option value="">+ Add from Catalog</option>
                    {tools?.procedures.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} (Php{p.basePrice})
                      </option>
                    ))}
                  </select>

                  <button
                    onClick={addCustomProcedure}
                    className="text-[11px] font-extrabold text-black px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50"
                  >
                    + Custom
                  </button>

                </div>
              </div>

              <div className="mt-3 space-y-2 max-h-[360px] overflow-y-auto pr-1">
                {procList.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-center">
                      <p className="text-xs text-slate-500">No procedures added yet.</p>
                      <p className="text-[10px] text-slate-400 mt-1">
                        Add from catalog or create a custom procedure
                      </p>
                    </div>
                ) : (
                  procList.map((p, idx) => (
                    <div
                      key={p.id}
                      className="rounded-xl border border-slate-200 bg-white p-3 hover:bg-slate-50 transition"
                    >
                      {/* Top row: checkbox look + name + row price + remove */}
                      <div className="flex items-start gap-3">
                        <div className="pt-1">
                          <div className="h-4 w-4 rounded border border-slate-300 bg-white" />
                        </div>

                        <div className="min-w-0 flex-1">
                          <input
                            value={p.name}
                            onChange={(e) =>
                              updateProcedure(idx, "name", e.target.value)
                            }
                            className="w-full bg-transparent text-xs font-extrabold text-slate-900 focus:outline-none"
                            placeholder="Procedure name"
                          />

                          {/* Inputs row: tooth # and price */}
                          <div className="mt-2 flex flex-wrap gap-2">
                            <input
                              value={p.toothNumber}
                              onChange={(e) =>
                                updateProcedure(idx, "toothNumber", e.target.value)
                              }
                              className="w-full sm:w-[200px] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/15"
                              placeholder="Tooth # (e.g. 14, UL)"
                            />

                            <input
                              type="number"
                              value={p.price}
                              onChange={(e) =>
                                updateProcedure(idx, "price", e.target.value)
                              }
                              className="w-full sm:w-[140px] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-slate-700 text-right font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/15"
                              placeholder="0"
                            />
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="text-xs font-extrabold text-slate-900">
                            Php{Number(p.price || 0).toLocaleString()}
                          </span>
                          <button
                            onClick={() => removeProcedure(idx)}
                            className="h-8 w-8 rounded-full border border-slate-200 bg-white text-slate-400 hover:text-red-600 hover:border-red-200 hover:bg-red-50 transition"
                            aria-label="Remove procedure"
                            title="Remove"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Total */}
              <div className="mt-4 flex items-center justify-between rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
                <span className="text-[11px] font-extrabold uppercase tracking-wide text-slate-600">
                  Estimated Total
                </span>
                <span className="font-black text-slate-900 font-mono text-sm sm:text-base md:text-lg leading-none text-right break-all">
                  Php{estimatedTotal.toLocaleString()}
                </span>
              </div>
            </div>

            {/* RIGHT: Inventory Used */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-extrabold text-slate-900">Inventory Used</p>

              <div className="mt-3 space-y-2 max-h-[300px] overflow-y-auto pr-1">
                {tools?.inventory
                  .filter((i) => String(i.tag || "").toLowerCase() === "consumable")
                  .map((i) => (
                    <div
                      key={i.id}
                      className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3 hover:bg-slate-50 transition"
                    >
                      <div className="min-w-0">
                          <p className="text-xs font-extrabold text-slate-900 truncate">
                            {i.name}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            Current stock: {i.stock}
                          </p>
                        </div>

                      <div className="flex items-center gap-3">
                        <button
                          onClick={() =>
                            setUsedInv({
                              ...usedInv,
                              [i.id]: Math.max(0, (usedInv[i.id] || 0) - 1),
                            })
                          }
                          className="h-8 w-10 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-extrabold"
                        >
                          -
                        </button>

                        <span className="w-6 text-center text-xs font-black text-slate-900">
                          {usedInv[i.id] || 0}
                        </span>

                        <button
                          onClick={() =>
                            setUsedInv({
                              ...usedInv,
                              [i.id]: (usedInv[i.id] || 0) + 1,
                            })
                          }
                          className="h-8 w-10 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-extrabold"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>

            {/* Bottom actions */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                onClick={() => setConfirmOpen(true)}
                disabled={isSaving || procList.length === 0}
                className="w-full rounded-xl bg-emerald-700 py-2.5 text-white text-sm font-black hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {isSaving ? "Finalizing Treatment..." : "Finalize Treatment"}
              </button>

              <button
                onClick={onClose}
                className="w-full rounded-xl bg-rose-600 py-2.5 text-white text-sm font-black hover:bg-rose-700 transition"
              >
                Cancel
              </button>
            </div>
        </div>
      </div>
        <DentalChartModal
          open={chartOpen}
          chart={dentalChart}
          history={historyMap}
          historyLoading={historyLoading}
          onClose={() => setChartOpen(false)}
          onSave={(next) => setDentalChart(next)}
        />
        {confirmOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-xl rounded-2xl bg-white shadow-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200">
                <h3 className="text-lg font-extrabold text-slate-900">Finalize Treatment</h3>
                <p className="text-sm text-slate-500">
                  Review the summary before saving.
                </p>
              </div>
              <div className="p-6 space-y-4">
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <p className="text-xs font-extrabold uppercase tracking-widest text-slate-600">
                    Summary
                  </p>
                  <div className="mt-2 text-sm text-slate-700 space-y-1">
                    <p>Procedures: {procList.length}</p>
                    <p>Inventory used: {inventorySummary.length}</p>
                    <p>Dental chart entries: {dentalChartCount}</p>
                    <p>Attachments: {imageUrls.length}</p>
                    <p>Total bill: ₱{estimatedTotal.toFixed(2)}</p>
                  </div>
                </div>

                {procList.length > 0 && (
                  <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                    <p className="text-xs font-extrabold uppercase tracking-widest text-slate-600">
                      Procedures
                    </p>
                    <div className="mt-2 space-y-1 text-sm text-slate-700">
                      {procList.map((p, idx) => (
                        <p key={`${p.id || "proc"}_${idx}`}>
                          {p.name || "Unnamed"}{" "}
                          {p.toothNumber ? `(tooth ${p.toothNumber})` : ""} - ₱
                          {Number(p.price || 0).toFixed(2)}
                        </p>
                      ))}
                    </div>
                  </div>
                )}

                {inventorySummary.length > 0 && (
                  <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                    <p className="text-xs font-extrabold uppercase tracking-widest text-slate-600">
                      Inventory Used
                    </p>
                    <div className="mt-2 space-y-1 text-sm text-slate-700">
                      {inventorySummary.map((i) => (
                        <p key={i.id}>
                          {i.name} - {i.quantity}
                        </p>
                      ))}
                    </div>
                  </div>
                )}

                {dentalChartCount === 0 && (
                  <p className="text-sm text-slate-500">
                    Dental chart is empty for this treatment.
                  </p>
                )}

                {imageUrls.length === 0 && (
                  <p className="text-sm text-slate-500">
                    No attachments added for this treatment.
                  </p>
                )}
              </div>
              <div className="px-6 py-4 border-t border-slate-200 flex flex-col gap-2">
                <button
                  onClick={async () => {
                    if (!window.confirm("Are you sure you want to proceed?")) return;
                    setConfirmOpen(false);
                    await handleSave();
                  }}
                  disabled={isSaving}
                  className="w-full rounded-xl bg-emerald-700 py-3 text-white font-black hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  {isSaving ? "Finalizing Treatment..." : "Confirm & Save"}
                </button>
                <button
                  onClick={() => setConfirmOpen(false)}
                  className="w-full text-center text-sm text-slate-500 hover:text-slate-700"
                >
                  Back
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

export default function DentistSchedulePanel() {
  const todayISO = useMemo(() => toISODate(new Date()), []);
  const [startDate, setStartDate] = useState(todayISO);

  const [rangeDays, setRangeDays] = useState<7 | 30>(7);
    const [scheduleView, setScheduleView] = useState<"upcoming" | "completed" | "cancelled">("upcoming");

  const [schedule, setSchedule] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [patientNameMap, setPatientNameMap] = useState<Record<string, string>>({});
  const [patientCodeMap, setPatientCodeMap] = useState<Record<string, string>>({});

  const [activeTreatment, setActiveTreatment] = useState<Appointment | null>(null);
  const [patientScheduleOpen, setPatientScheduleOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarCursorMonth, setCalendarCursorMonth] = useState<Date>(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [calendarSelectedDate, setCalendarSelectedDate] = useState(todayISO);
  const [calendarByDate, setCalendarByDate] = useState<Record<string, Appointment[]>>({});
  const [calendarLoadingDates, setCalendarLoadingDates] = useState<Record<string, boolean>>({});
  const [calendarLoadingSelected, setCalendarLoadingSelected] = useState(false);
  const calendarByDateRef = useRef<Record<string, Appointment[]>>({});
  const calendarLoadingDatesRef = useRef<Record<string, boolean>>({});

  const datesToFetch = useMemo(() => {
    const list: string[] = [];
    for (let i = 0; i < rangeDays; i++) list.push(addDays(startDate, i));
    return list;
  }, [startDate, rangeDays]);

  const refresh = useCallback(async () => {
    setLoading(true);

    const results = await Promise.all(
      datesToFetch.map(async (d) => {
        const res = await getDentistScheduleAction(d);
        if (res?.success && res.data) {
          const rows = ((res.data as Appointment[]) || []).map((a) => ({
            ...a,
            date: (a as any).date || d,
          }));
          return rows;
        }
        return [];
      }),
    );

    const merged = results.flat();

    merged.sort((a, b) => {
      const da = String((a as any).date || "");
      const db = String((b as any).date || "");
      if (da !== db) return da.localeCompare(db);

      const ta = parseTimeToSortable((a as any).time);
      const tb = parseTimeToSortable((b as any).time);
      return ta.localeCompare(tb);
    });

    setSchedule(merged);
    setLoading(false);
  }, [datesToFetch]);

  const fetchDentistCalendarDate = useCallback(
    async (dateStr: string, force = false) => {
      if (!dateStr) return;
      if (!force && calendarByDateRef.current[dateStr]) return;
      if (calendarLoadingDatesRef.current[dateStr]) return;

      calendarLoadingDatesRef.current = { ...calendarLoadingDatesRef.current, [dateStr]: true };
      setCalendarLoadingDates((prev) => ({ ...prev, [dateStr]: true }));
      try {
        const res = await getDentistScheduleAction(dateStr);
        if (res?.success && res.data) {
          const rows = ((res.data as Appointment[]) || [])
            .filter((a) => String((a as any).patientId || "").trim())
            .sort((a, b) => {
              const ta = parseTimeToSortable((a as any).time);
              const tb = parseTimeToSortable((b as any).time);
              return ta.localeCompare(tb);
            });
          calendarByDateRef.current = { ...calendarByDateRef.current, [dateStr]: rows };
          setCalendarByDate((prev) => ({ ...prev, [dateStr]: rows }));
        } else {
          calendarByDateRef.current = { ...calendarByDateRef.current, [dateStr]: [] };
          setCalendarByDate((prev) => ({ ...prev, [dateStr]: [] }));
        }
      } finally {
        calendarLoadingDatesRef.current = { ...calendarLoadingDatesRef.current, [dateStr]: false };
        setCalendarLoadingDates((prev) => ({ ...prev, [dateStr]: false }));
      }
    },
    []
  );

  useEffect(() => {
    calendarByDateRef.current = calendarByDate;
  }, [calendarByDate]);

  useEffect(() => {
    calendarLoadingDatesRef.current = calendarLoadingDates;
  }, [calendarLoadingDates]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    let active = true;
    const ids = Array.from(
      new Set(
        schedule
          .map((a) => String((a as any).patientId || "").trim())
          .filter(Boolean)
      )
    ).filter((id) => !patientNameMap[id]);

    if (ids.length === 0) return () => {};

    (async () => {
      const pairs = await Promise.all(
        ids.map(async (id) => {
          const name = await getUserDisplayNameByUid(id);
          return [id, name] as const;
        })
      );
      if (!active) return;
      setPatientNameMap((prev) => {
        const next = { ...prev };
        for (const [id, name] of pairs) {
          if (name) next[id] = name;
        }
        return next;
      });
    })();

    return () => {
      active = false;
    };
  }, [schedule, patientNameMap]);

  useEffect(() => {
    let active = true;
    const ids = Array.from(
      new Set(
        schedule
          .map((a) => String((a as any).patientId || "").trim())
          .filter(Boolean)
      )
    ).filter((id) => !patientCodeMap[id]);

    if (ids.length === 0) return () => {};

    (async () => {
      const pairs = await Promise.all(
        ids.map(async (id) => {
          const rec = await getPatientRecord(id);
          const code = rec?.success ? String((rec as any)?.data?.patientId || "").trim() : "";
          return [id, code] as const;
        })
      );
      if (!active) return;
      setPatientCodeMap((prev) => {
        const next = { ...prev };
        for (const [id, code] of pairs) {
          if (code) next[id] = code;
        }
        return next;
      });
    })();

    return () => {
      active = false;
    };
  }, [schedule, patientCodeMap]);

  useEffect(() => {
    if (!calendarOpen) return;
    setCalendarLoadingSelected(true);
    fetchDentistCalendarDate(calendarSelectedDate, true).finally(() =>
      setCalendarLoadingSelected(false)
    );
  }, [calendarOpen, calendarSelectedDate, fetchDentistCalendarDate]);

  useEffect(() => {
    if (!calendarOpen) return;
    const d = parseLocalYMD(calendarSelectedDate);
    if (!Number.isNaN(d.getTime())) {
      setCalendarCursorMonth(new Date(d.getFullYear(), d.getMonth(), 1));
    }
  }, [calendarOpen, calendarSelectedDate]);

  useEffect(() => {
    if (!calendarOpen) return;

    const year = calendarCursorMonth.getFullYear();
    const month = calendarCursorMonth.getMonth();
    const last = new Date(year, month + 1, 0).getDate();

    const dates: string[] = [];
    for (let day = 1; day <= last; day++) {
      dates.push(formatLocalYMD(new Date(year, month, day)));
    }

    const concurrency = 6;
    let idx = 0;
    const workers = new Array(concurrency).fill(0).map(async () => {
      while (idx < dates.length) {
        const i = idx++;
        await fetchDentistCalendarDate(dates[i]);
      }
    });

    Promise.all(workers).catch(() => {});
  }, [calendarOpen, calendarCursorMonth, fetchDentistCalendarDate]);

  const subtitle = useMemo(() => {
    const label = formatRangeLabel(startDate, rangeDays);
    return `Showing: ${label}`;
  }, [startDate, rangeDays]);

  const visibleSchedule = useMemo(() => {
    const filtered = schedule.filter((app) => {
      const status = String((app as any).status || "").toLowerCase();
      if (scheduleView === "completed") return status === "completed";
      if (scheduleView === "cancelled") return status === "cancelled";
      return status !== "completed" && status !== "cancelled";
    });

    return [...filtered].sort((a, b) => {
      const da = String((a as any).date || "");
      const db = String((b as any).date || "");
      if (da && db && da !== db) return da.localeCompare(db);
      const ta = parseTimeToSortable((a as any).time);
      const tb = parseTimeToSortable((b as any).time);
      return ta.localeCompare(tb);
    });
  }, [schedule, scheduleView]);

  const calendarDays = useMemo(() => {
    const start = new Date(calendarCursorMonth);
    const dayOfWeek = start.getDay();
    start.setDate(start.getDate() - dayOfWeek);

    const out: Date[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      out.push(d);
    }
    return out;
  }, [calendarCursorMonth]);

  const selectedCalendarSchedule = calendarByDate[calendarSelectedDate] || [];

  const upcomingScheduleRows = useMemo(() => {
    const endDate = addDays(startDate, rangeDays - 1);
    const rows = schedule.filter((app) => {
      const status = String((app as any).status || "").toLowerCase();
      const patientUid = String((app as any).patientId || "").trim();
      const date = String((app as any).date || "");
      return (
        Boolean(patientUid) &&
        Boolean(date) &&
        date >= startDate &&
        date <= endDate &&
        status !== "completed" &&
        status !== "cancelled"
      );
    });

    return [...rows]
      .sort((a, b) => {
        const da = String((a as any).date || "");
        const db = String((b as any).date || "");
        if (da && db && da !== db) return da.localeCompare(db);
        const ta = parseTimeToSortable((a as any).time);
        const tb = parseTimeToSortable((b as any).time);
        return ta.localeCompare(tb);
      })
      .slice(0, 50);
  }, [schedule, startDate, rangeDays]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setPatientScheduleOpen(true)}
          className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-extrabold text-slate-700 hover:bg-slate-50"
        >
          Patient Schedule
        </button>
        <button
          type="button"
          onClick={() => setCalendarOpen(true)}
          className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-extrabold text-slate-700 hover:bg-slate-50"
        >
          Calendar
        </button>
      </div>
      <Card
        title="Upcoming Schedule"
        subtitle="Upcoming bookings here"
      >
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <label className="text-xs font-extrabold text-slate-600 uppercase tracking-widest">
            Start Date
          </label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className={`${inputBase} max-w-[180px]`}
          />
          <button
            type="button"
            onClick={() => setRangeDays(7)}
            className={`px-3 py-2 rounded-xl text-xs font-extrabold border ${
              rangeDays === 7
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
            }`}
          >
            7 days
          </button>
          <button
            type="button"
            onClick={() => setRangeDays(30)}
            className={`px-3 py-2 rounded-xl text-xs font-extrabold border ${
              rangeDays === 30
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
            }`}
          >
            30 days
          </button>
        </div>
        {loading ? (
          <p className="text-sm text-slate-500">Loading upcoming schedule...</p>
        ) : upcomingScheduleRows.length === 0 ? (
          <p className="text-sm text-slate-500">No upcoming bookings for this date range.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-extrabold uppercase tracking-widest text-slate-600">
                  <th className="py-2 pr-4">Patient ID</th>
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Service</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Date</th>
                  <th className="py-2 pr-4">Action</th>
                </tr>
              </thead>
              <tbody>
                {upcomingScheduleRows.map((app) => {
                  const patientUid = String((app as any).patientId || "").trim();
                  const patientId = patientCodeMap[patientUid] || patientUid || "N/A";
                  const patientName =
                    (app as any).patientName ||
                    (app as any).patientFullName ||
                    (app as any).patientEmail ||
                    (patientUid && patientNameMap[patientUid]) ||
                    "Patient";
                  const service = String((app as any).serviceType || "").trim() || "N/A";
                  const status = String((app as any).status || "").trim() || "N/A";
                  const statusLower = status.toLowerCase();
                  const date = formatNiceDate(String((app as any).date || ""));
                  const canTreat = statusLower !== "completed" && statusLower !== "cancelled";

                  return (
                    <tr key={app.id} className="border-b border-slate-100 last:border-0 text-slate-700">
                      <td className="py-2 pr-4 font-mono text-xs text-slate-900">{patientId}</td>
                      <td className="py-2 pr-4">{patientName}</td>
                      <td className="py-2 pr-4">{service}</td>
                      <td className="py-2 pr-4">
                        <StatusPill status={status} />
                      </td>
                      <td className="py-2 pr-4">{date}</td>
                      <td className="py-2 pr-4">
                        {canTreat ? (
                          <button
                            onClick={() => setActiveTreatment(app)}
                            className="px-3 py-1.5 rounded-lg bg-teal-700 text-white text-xs font-extrabold hover:bg-teal-800"
                          >
                            Treat Patient
                          </button>
                        ) : (
                          <span className="text-xs font-extrabold text-slate-500">Done</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {patientScheduleOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-5xl rounded-2xl bg-white shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-extrabold text-slate-900">Patient Schedule</h3>
                <p className="text-sm text-slate-500">{subtitle}</p>
              </div>
              <button
                onClick={() => setPatientScheduleOpen(false)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-extrabold text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                  <div className="flex items-center gap-3">
                    <label className="text-xs font-extrabold text-slate-600 uppercase tracking-widest">
                      Start
                    </label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className={`${inputBase} max-w-[180px]`}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-extrabold text-slate-600 uppercase tracking-widest">
                      Range
                    </label>
                    <select
                      value={rangeDays}
                      onChange={(e) => setRangeDays((e.target.value === "30" ? 30 : 7) as 7 | 30)}
                      className={`${inputBase} max-w-[220px]`}
                    >
                      <option value={7}>Next 7 days</option>
                      <option value={30}>Next 30 days</option>
                    </select>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setScheduleView("upcoming")}
                    className={`px-3 py-2 rounded-xl text-xs font-extrabold border ${
                      scheduleView === "upcoming"
                        ? "bg-slate-900 text-white border-slate-900"
                        : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    Upcoming
                  </button>
                  <button
                    type="button"
                    onClick={() => setScheduleView("completed")}
                    className={`px-3 py-2 rounded-xl text-xs font-extrabold border ${
                      scheduleView === "completed"
                        ? "bg-slate-900 text-white border-slate-900"
                        : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    Completed
                  </button>
                  <button
                    type="button"
                    onClick={() => setScheduleView("cancelled")}
                    className={`px-3 py-2 rounded-xl text-xs font-extrabold border ${
                      scheduleView === "cancelled"
                        ? "bg-slate-900 text-white border-slate-900"
                        : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    Cancelled
                  </button>
                  <button
                    onClick={refresh}
                    className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-sm font-extrabold hover:bg-slate-50"
                  >
                    Refresh
                  </button>
                </div>
              </div>

              {loading ? (
                <p className="text-sm text-slate-500">Loading schedule...</p>
              ) : visibleSchedule.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                  <p className="text-sm font-extrabold text-slate-900">
                    {scheduleView === "completed"
                      ? "No completed appointments"
                      : scheduleView === "cancelled"
                        ? "No cancelled appointments"
                        : "No upcoming appointments"}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    No assigned appointments for the selected range.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {visibleSchedule.map((app) => {
                    const patientUid = String((app as any).patientId || "").trim();
                    const patientLabel =
                      (app as any).patientName ||
                      (app as any).patientFullName ||
                      (app as any).patientEmail ||
                      (patientUid && patientNameMap[patientUid]) ||
                      patientUid ||
                      "Patient";

                    const dateLabel = formatNiceDate(String((app as any).date || ""));

                    return (
                      <div
                        key={app.id}
                        className="border border-slate-200 rounded-2xl p-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between"
                      >
                        <div className="min-w-0">
                          <p className="text-base font-extrabold text-slate-900">
                            {formatTime12h((app as any).time)} - {patientLabel} - {(app as any).serviceType}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <StatusPill status={(app as any).status} />
                            <span className="text-xs text-slate-500">{dateLabel}</span>
                          </div>
                        </div>

                        {(() => {
                          const status = String((app as any).status || "").toLowerCase();
                          return status !== "completed" && status !== "cancelled";
                        })() ? (
                          <button
                            onClick={() => {
                              setPatientScheduleOpen(false);
                              setActiveTreatment(app);
                            }}
                            className="px-4 py-2 rounded-xl bg-teal-700 text-white font-extrabold text-sm hover:bg-teal-800"
                          >
                            Treat Patient
                          </button>
                        ) : (
                          <span className="text-xs font-extrabold text-slate-500">Completed</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {calendarOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-4xl rounded-2xl bg-white shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-extrabold text-slate-900">Calendar</h3>
                <p className="text-sm text-slate-500">Assigned patients only</p>
              </div>
              <button
                onClick={() => setCalendarOpen(false)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-extrabold text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
            </div>

            <div className="p-5 max-h-[70vh] overflow-y-auto">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-xl font-extrabold text-slate-900">
                    {calendarCursorMonth.toLocaleString(undefined, { month: "long", year: "numeric" })}
                  </h2>
                  <p className="text-sm text-slate-500">Grid calendar view</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() =>
                      setCalendarCursorMonth(
                        new Date(calendarCursorMonth.getFullYear(), calendarCursorMonth.getMonth() - 1, 1)
                      )
                    }
                    className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Prev
                  </button>
                  <button
                    onClick={() => {
                      const now = new Date();
                      const ymd = formatLocalYMD(now);
                      setCalendarCursorMonth(new Date(now.getFullYear(), now.getMonth(), 1));
                      setCalendarSelectedDate(ymd);
                      fetchDentistCalendarDate(ymd, true);
                    }}
                    className="px-3 py-2 rounded-lg bg-teal-600 text-sm font-semibold text-white hover:bg-teal-700"
                  >
                    Today
                  </button>
                  <button
                    onClick={() =>
                      setCalendarCursorMonth(
                        new Date(calendarCursorMonth.getFullYear(), calendarCursorMonth.getMonth() + 1, 1)
                      )
                    }
                    className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Next
                  </button>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-slate-200 overflow-hidden">
                <div className="grid grid-cols-7 bg-slate-50 border-b border-slate-200">
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                    <div
                      key={d}
                      className="px-3 py-2 text-xs font-extrabold text-slate-600 uppercase tracking-wider"
                    >
                      {d}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7">
                  {calendarDays.map((d) => {
                    const ds = formatLocalYMD(d);
                    const inMonth = d.getMonth() === calendarCursorMonth.getMonth();
                    const isSelected = ds === calendarSelectedDate;
                    const isToday = ds === todayISO;
                    const items = calendarByDate[ds] || [];
                    const count = items.length;
                    const isLoadingCell = !!calendarLoadingDates[ds];

                    return (
                      <button
                        key={ds}
                        type="button"
                        onClick={() => {
                          setCalendarSelectedDate(ds);
                          fetchDentistCalendarDate(ds);
                        }}
                        className={
                          "min-h-[92px] border-b border-r border-slate-200 p-3 text-left hover:bg-slate-50 transition " +
                          (inMonth ? "bg-white" : "bg-slate-50") +
                          (isSelected ? " ring-2 ring-teal-500/30 bg-teal-50/30" : "")
                        }
                      >
                        <div className="flex items-center justify-between">
                          <span
                            className={
                              "text-sm font-extrabold " + (inMonth ? "text-slate-900" : "text-slate-400")
                            }
                          >
                            {d.getDate()}
                          </span>
                          {count > 0 ? (
                            <span className="text-[11px] font-extrabold px-2 py-0.5 rounded-full bg-slate-900 text-white">
                              {count}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-2">
                          {isToday ? <p className="text-[11px] font-bold text-teal-700">Today</p> : null}
                          {isLoadingCell ? (
                            <p className="text-xs text-slate-400">Loading...</p>
                          ) : count === 0 ? (
                            <p className="text-xs text-slate-400">No bookings</p>
                          ) : (
                            <p className="text-xs text-slate-600 font-bold">{count} assigned</p>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-6">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <p className="text-sm font-extrabold text-slate-900">
                    Selected:{" "}
                    {parseLocalYMD(calendarSelectedDate).toLocaleDateString(undefined, {
                      month: "short",
                      day: "2-digit",
                      year: "numeric",
                    })}
                  </p>
                  <span className="text-xs font-extrabold px-3 py-1 rounded-full bg-slate-100 border border-slate-200 text-slate-700">
                    {selectedCalendarSchedule.length} item(s)
                  </span>
                </div>

                {calendarLoadingSelected || calendarLoadingDates[calendarSelectedDate] ? (
                  <p className="text-sm text-slate-500">Loading schedule...</p>
                ) : selectedCalendarSchedule.length === 0 ? (
                  <p className="text-sm text-slate-500 italic">No assigned appointments for this date.</p>
                ) : (
                  <div className="space-y-2">
                    {selectedCalendarSchedule.map((app) => {
                      const patientUid = String((app as any).patientId || "").trim();
                      const patientId = patientCodeMap[patientUid] || patientUid || "N/A";
                      const patientName =
                        (app as any).patientName ||
                        (app as any).patientFullName ||
                        (app as any).patientEmail ||
                        (patientUid && patientNameMap[patientUid]) ||
                        "Patient";

                      return (
                        <div
                          key={app.id}
                          className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4"
                        >
                          <div className="min-w-0">
                            <p className="font-extrabold text-slate-900 truncate">{patientName}</p>
                            <p className="text-xs text-slate-500 mt-1">
                              {patientId} - {formatTime12h((app as any).time)} - {(app as any).serviceType}
                            </p>
                          </div>
                          <button
                            onClick={() => {
                              setCalendarOpen(false);
                              setActiveTreatment(app);
                            }}
                            className="px-3 py-1.5 rounded-lg bg-teal-700 text-white text-xs font-extrabold hover:bg-teal-800"
                          >
                            Treat Patient
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTreatment && (
        <TreatmentModal
          appointment={activeTreatment}
          onClose={() => setActiveTreatment(null)}
          onComplete={refresh}
        />
      )}
    </>
  );
}
