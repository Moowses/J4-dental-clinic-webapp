"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChatbotQuestionRow } from "@/app/actions/chatbot-analytics-actions";
import { useAuth } from "@/lib/hooks/useAuth";

export default function ChatbotTopQuestionsPanel() {
  const { user, role, loading: authLoading } = useAuth();
  const [rows, setRows] = useState<ChatbotQuestionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const editingRow = useMemo(
    () => rows.find((r) => r.id === editingId) || null,
    [rows, editingId]
  );

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setErr(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/admin/chatbot-questions?limit=50", {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Failed to load top questions.");
      setRows(Array.isArray(data?.data) ? data.data : []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to load top questions.";
      setErr(msg);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setRows([]);
      setErr("Not authenticated.");
      setLoading(false);
      return;
    }
    if (role !== "admin") {
      setRows([]);
      setErr("Unauthorized: Admin only.");
      setLoading(false);
      return;
    }
    load();
  }, [authLoading, user, role, load]);

  async function saveEdit() {
    if (!editingRow) return;
    if (!user) {
      setErr("Not authenticated.");
      return;
    }
    const label = draftLabel.trim();
    if (!label) {
      setErr("Question label is required.");
      return;
    }

    setSavingId(editingRow.id);
    setErr(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/admin/chatbot-questions", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ id: editingRow.id, label }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Failed to save question.");
      setRows((prev) =>
        prev.map((r) => (r.id === editingRow.id ? { ...r, label } : r))
      );
      setEditingId(null);
      setDraftLabel("");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to save question.";
      setErr(msg);
    } finally {
      setSavingId(null);
    }
  }

  async function deleteRow(id: string) {
    if (!user) {
      setErr("Not authenticated.");
      return;
    }
    const target = rows.find((r) => r.id === id);
    if (!target) return;
    const ok = window.confirm(`Delete this question?\n\n${target.label}`);
    if (!ok) return;

    setDeletingId(id);
    setErr(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/admin/chatbot-questions", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ id }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Failed to delete question.");
      setRows((prev) => prev.filter((r) => r.id !== id));
      if (editingId === id) {
        setEditingId(null);
        setDraftLabel("");
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to delete question.";
      setErr(msg);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
        <div>
          <p className="text-lg font-extrabold text-slate-900">Top 3 Chatbot Questions</p>
          <p className="text-sm text-slate-500">Most asked by patients/customers (from Firebase).</p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading || !!savingId || !!deletingId}
          className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-sm font-extrabold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          Refresh
        </button>
      </div>

      <div className="p-5 space-y-3">
        {err ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {err}
          </div>
        ) : null}

        {loading ? (
          <div className="text-sm text-slate-600">Loading top questions...</div>
        ) : !rows.length ? (
          <div className="text-sm text-slate-600">
            No chatbot question data yet. Once patients ask questions, top 3 will appear here.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {rows.slice(0, 3).map((row, idx) => (
                <div key={`top-${row.id}`} className="rounded-2xl border border-slate-200 bg-slate-900 text-white p-4">
                  <div className="text-xs font-extrabold text-white/70 uppercase">Top #{idx + 1}</div>
                  <p className="mt-2 text-sm font-extrabold leading-snug">{row.label || "—"}</p>
                  <div className="mt-3 text-xs font-bold text-white/85">
                    Asked {Number(row.count || 0).toLocaleString()} time{row.count === 1 ? "" : "s"}
                  </div>
                </div>
              ))}
            </div>

            <div>
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="text-sm font-extrabold text-slate-900">All Tracked Questions</div>
                <div className="text-xs font-bold text-slate-500">
                  Showing {rows.length} item{rows.length === 1 ? "" : "s"}
                </div>
              </div>

              <div className="max-h-[360px] overflow-y-auto space-y-2 pr-1">
                {rows.map((row, idx) => {
                  const isEditing = editingId === row.id;
                  const isSaving = savingId === row.id;
                  const isDeleting = deletingId === row.id;
                  return (
                    <div
                      key={row.id}
                      className="rounded-xl border border-slate-200 bg-slate-50 p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-extrabold text-slate-500">
                          #{idx + 1} • Asked {Number(row.count || 0).toLocaleString()} time
                          {row.count === 1 ? "" : "s"}
                        </div>
                        {!isEditing ? (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingId(row.id);
                                setDraftLabel(row.label);
                                setErr(null);
                              }}
                              disabled={isDeleting}
                              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-extrabold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteRow(row.id)}
                              disabled={isDeleting || !!savingId}
                              className="px-3 py-1.5 rounded-lg border border-red-200 bg-red-50 text-xs font-extrabold text-red-700 hover:bg-red-100 disabled:opacity-60"
                            >
                              {isDeleting ? "Deleting..." : "Delete"}
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={saveEdit}
                              disabled={isSaving || isDeleting}
                              className="px-3 py-1.5 rounded-lg bg-slate-900 text-xs font-extrabold text-white hover:bg-slate-800 disabled:opacity-60"
                            >
                              {isSaving ? "Saving..." : "Save"}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingId(null);
                                setDraftLabel("");
                              }}
                              disabled={isSaving || isDeleting}
                              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-extrabold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                      </div>

                      {!isEditing ? (
                        <p className="mt-2 text-sm font-semibold text-slate-900">{row.label || "—"}</p>
                      ) : (
                        <input
                          value={draftLabel}
                          onChange={(e) => setDraftLabel(e.target.value)}
                          className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                          placeholder="Edit question..."
                          maxLength={180}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
