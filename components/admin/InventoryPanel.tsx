"use client";

import React, { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useActionState } from "react";

import {
  addInventoryItemAction,
  adjustStockAction,
  updateInventoryItemAction,
  deleteInventoryItemAction,
} from "@/app/actions/inventory-actions";
import {
  ConfirmActionModal,
  ProcessingModal,
  ResultModal,
} from "@/components/admin/ActionFeedbackModals";
import { getInventory } from "@/lib/services/inventory-service";

import type { InventoryItem } from "@/lib/types/inventory";

const inputBase =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-300";

const categoryOptions = [
  { value: "supplies", label: "Supplies" },
  { value: "consumables", label: "Consumables" },
  { value: "medicines", label: "Medicines" },
  { value: "instruments", label: "Instruments" },
  { value: "tools", label: "Tools" },
  { value: "equipment", label: "Equipment" },
  { value: "sterilization", label: "Sterilization" },
  { value: "anesthetics", label: "Anesthetics" },
  { value: "impression", label: "Impression" },
  { value: "restorative", label: "Restorative" },
  { value: "endodontic", label: "Endodontic" },
  { value: "orthodontic", label: "Orthodontic" },
  { value: "prosthodontic", label: "Prosthodontic" },
  { value: "surgical", label: "Surgical" },
  { value: "ppe", label: "PPE" },
  { value: "syringes-needles", label: "Syringes & Needles" },
  { value: "other", label: "Other" },
];

const categoryLabelMap = new Map(categoryOptions.map((opt) => [opt.value, opt.label]));

function getCategoryLabel(value?: string) {
  if (!value) return "--";
  return categoryLabelMap.get(value) || value.replace(/-/g, " ");
}

function getTagLabel(value?: string) {
  if (value === "consumable") return "Consumable";
  if (value === "material") return "Material";
  return "--";
}

function fmtMoney(n: any) {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return "PHP 0.00";
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(v);
}

function Modal({
  title,
  subtitle,
  children,
  onClose,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-4xl rounded-2xl bg-white shadow-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-extrabold text-slate-900">{title}</h3>
            {subtitle ? <p className="mt-1 text-sm text-slate-600">{subtitle}</p> : null}
          </div>
          <button
            onClick={onClose}
            className="rounded-xl px-3 py-2 text-sm font-extrabold text-slate-700 hover:bg-slate-100"
          >
            X
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

export default function InventoryPanel() {
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [activeOnly, setActiveOnly] = useState(true);
  const [q, setQ] = useState("");

  const [pending, startTransition] = useTransition();

  // Add item server action (FormData-based)
  const [addState, addFormAction, addPending] = useActionState(addInventoryItemAction, { success: false });

  // Modals
  const [openAdd, setOpenAdd] = useState(false);
  const [openEdit, setOpenEdit] = useState<InventoryItem | null>(null);
  const [adjustingStock, setAdjustingStock] = useState<{ item: InventoryItem; mode: "in" | "out" } | null>(null);
  const [customQty, setCustomQty] = useState("");
  const [processingMessage, setProcessingMessage] = useState<string | null>(null);
  const [resultModal, setResultModal] = useState<{
    tone: "success" | "error";
    title: string;
    message: string;
  } | null>(null);
  const [pendingEditForm, setPendingEditForm] = useState<FormData | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const res = await getInventory(activeOnly);
    if (res.success) setInventory(res.data || []);
    setLoading(false);
  }, [activeOnly]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // if add succeeded, close modal and refresh
  useEffect(() => {
    if (addState?.success) {
      setOpenAdd(false);
      refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addState?.success]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return inventory;

    return inventory.filter((it) => {
      return (
        (it.name || "").toLowerCase().includes(needle) ||
        (it.category || "").toLowerCase().includes(needle) ||
        (it.tag || "").toLowerCase().includes(needle) ||
        (it.unit || "").toLowerCase().includes(needle) ||
        (it.batchNumber || "").toLowerCase().includes(needle) ||
        (it.itemCode || "").toLowerCase().includes(needle)
      );
    });
  }, [inventory, q]);

  async function performAdjustment(amount: number) {
    if (!adjustingStock || amount <= 0) return;
    
    const finalAmount = adjustingStock.mode === "in" ? amount : -amount;
    const actionLabel = adjustingStock.mode === "in" ? "stock in" : "stock out";
    
    startTransition(async () => {
      setProcessingMessage(`Saving ${actionLabel} adjustment...`);
      const res = await adjustStockAction(adjustingStock.item.id, finalAmount);
      setProcessingMessage(null);
      if (!res.success) {
        setResultModal({
          tone: "error",
          title: "Update Failed",
          message: res.error || "Failed to adjust stock",
        });
        return;
      }
      setAdjustingStock(null);
      setCustomQty("");
      setResultModal({
        tone: "success",
        title: "Success",
        message: "Inventory stock updated successfully.",
      });
      await refresh();
    });
  }

  async function onDeactivate(item: InventoryItem) {
    const ok = confirm(`Deactivate "${item.name}"? This will hide it from Active inventory.`);
    if (!ok) return;

    startTransition(async () => {
      const res = await deleteInventoryItemAction(item.id);
      if (!res.success) {
        setResultModal({
          tone: "error",
          title: "Deactivate Failed",
          message: res.error || "Failed to deactivate item",
        });
        return;
      }
      await refresh();
    });
  }

  async function onSubmitEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!openEdit) return;

    const fd = new FormData(e.currentTarget);
    setPendingEditForm(fd);
  }

  async function confirmEditSave() {
    if (!openEdit || !pendingEditForm) return;
    startTransition(async () => {
      setProcessingMessage("Saving inventory changes...");
      const res = await updateInventoryItemAction(openEdit.id, pendingEditForm);
      setProcessingMessage(null);
      setPendingEditForm(null);
      if (!res.success) {
        setResultModal({
          tone: "error",
          title: "Save Failed",
          message: res.error || "Failed to update item",
        });
        return;
      }
      setOpenEdit(null);
      setResultModal({
        tone: "success",
        title: "Success",
        message: "Inventory item updated successfully.",
      });
      await refresh();
    });
  }

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden flex flex-col w-full">
      {processingMessage ? <ProcessingModal title="Processing" message={processingMessage} /> : null}
      {pendingEditForm ? (
        <ConfirmActionModal
          title="Confirm action"
          message="Are you sure you want to save these inventory changes?"
          confirmLabel="Save Changes"
          onCancel={() => setPendingEditForm(null)}
          onConfirm={confirmEditSave}
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
      <div className="px-6 py-4 border-b border-slate-100 flex flex-col gap-3 md:flex-row md:items-center md:justify-between bg-white z-10">
        <div>
          <h3 className="text-lg font-extrabold text-slate-900">Inventory</h3>
          <p className="text-sm text-slate-500">Track consumables and adjust stock</p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm focus-within:ring-2 focus:ring-teal-500/20 transition-all">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search items..."
              className="w-[180px] lg:w-[260px] bg-transparent text-sm outline-none placeholder:text-slate-400"
            />
          </div>

          <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm cursor-pointer hover:bg-slate-50 transition-colors">
            <input
              type="checkbox"
              checked={activeOnly}
              onChange={(e) => setActiveOnly(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
            />
            <span className="font-medium text-slate-700">Active only</span>
          </label>

          <button
            onClick={() => setOpenAdd(true)}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-extrabold text-white hover:bg-black disabled:opacity-60 transition-all shadow-sm"
            disabled={pending || addPending}
          >
            + Add Item
          </button>
        </div>
      </div>

      <div className="p-4 md:p-6 overflow-hidden flex flex-col">
        <div className="rounded-2xl border border-slate-200 overflow-hidden bg-white shadow-inner flex flex-col">
          <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-slate-200 scrollbar-track-transparent">
            <table className="w-full text-left border-collapse min-w-[800px]">
              <thead className="bg-slate-50 sticky top-0 z-10">
                <tr className="text-[10px] font-black uppercase tracking-widest text-slate-500 border-b border-slate-200">
                  <th className="px-4 py-4">Item</th>
                  <th className="px-4 py-4">Category</th>
                  <th className="px-4 py-4">Stock</th>
                  <th className="px-4 py-4">Min Threshold</th>
                  <th className="px-4 py-4">Status</th>
                  <th className="px-4 py-4 text-right">Actions</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td className="px-4 py-12 text-sm text-slate-400 text-center font-medium" colSpan={6}>
                      <div className="flex flex-col items-center gap-2">
                        <div className="h-5 w-5 border-2 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
                        Loading inventory...
                      </div>
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td className="px-4 py-12 text-sm text-slate-400 text-center italic" colSpan={6}>
                      No inventory items found matching your search.
                    </td>
                  </tr>
                ) : (
                  filtered.map((item) => {
                    const low = Number(item.stock ?? 0) <= Number(item.minThreshold ?? 0);
                    const out = Number(item.stock ?? 0) <= 0;
                    const status = out ? "Out of stock" : low ? "Low stock" : "In stock";
                    const statusClass = out
                      ? "bg-rose-50 text-rose-700 border-rose-100"
                      : low
                      ? "bg-amber-50 text-amber-700 border-amber-100"
                      : "bg-emerald-50 text-emerald-700 border-emerald-100";
                    return (
                      <tr key={item.id} className="text-sm text-slate-800 hover:bg-slate-50/50 transition-colors group">
                        <td className="px-4 py-3">
                          <span className="font-extrabold text-slate-900">{item.name || "--"}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs font-bold text-slate-600">{getCategoryLabel(item.category)}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-baseline gap-1">
                            <span className={low ? "font-black text-rose-600" : "font-black text-slate-900"}>
                              {Number(item.stock ?? 0)}
                            </span>
                            <span className="text-[10px] text-slate-400 font-bold uppercase">{item.unit}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs font-medium text-slate-500">
                          {Number(item.minThreshold ?? 0)}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={[
                              "inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase border",
                              statusClass,
                            ].join(" ")}
                          >
                            {status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-1.5">
                            <button
                              onClick={() => setAdjustingStock({ item, mode: "out" })}
                              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-[10px] font-black text-slate-600 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 transition-all uppercase tracking-tight"
                              disabled={pending}
                            >
                              Out
                            </button>
                            <button
                              onClick={() => setAdjustingStock({ item, mode: "in" })}
                              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-[10px] font-black text-slate-600 hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-200 transition-all uppercase tracking-tight"
                              disabled={pending}
                            >
                              In
                            </button>
                            <button
                              onClick={() => setOpenEdit(item)}
                              className="h-8 px-3 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-[10px] font-black text-slate-700 hover:bg-slate-50 transition-all uppercase"
                              disabled={pending}
                            >
                              EDIT
                            </button>
                            <button
                              onClick={() => onDeactivate(item)}
                              className="h-8 w-8 flex items-center justify-center rounded-lg border border-rose-100 bg-rose-50 text-rose-600 hover:bg-rose-600 hover:text-white transition-all"
                              disabled={pending}
                              title="Archive"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                                <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" />
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest bg-slate-50/50 border-t border-slate-100">
            <span>{filtered.length} item(s) listed</span>
            {pending ? (
              <span className="flex items-center gap-2 text-teal-600">
                <div className="h-2 w-2 bg-teal-600 rounded-full animate-pulse"></div>
                Syncing changes...
              </span>
            ) : <span>Verified Stock</span>}
          </div>
        </div>
      </div>

      {/* ADJUSTMENT MODAL */}
      {adjustingStock && (
        <Modal
          title={adjustingStock.mode === "in" ? "Stock In" : "Stock Out"}
          subtitle={`Adjust inventory for: ${adjustingStock.item.name}`}
          onClose={() => {
            setAdjustingStock(null);
            setCustomQty("");
          }}
        >
          <div className="space-y-6">
            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 flex justify-between items-center">
              <div>
                <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Current Level</p>
                <p className="text-2xl font-black text-slate-900">{adjustingStock.item.stock} <span className="text-sm font-bold text-slate-500">{adjustingStock.item.unit}</span></p>
              </div>
              <div className="h-12 w-12 rounded-full bg-white border border-slate-200 flex items-center justify-center text-xl">
                {adjustingStock.mode === "in" ? "📥" : "📤"}
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-xs font-black text-slate-600 uppercase tracking-widest">Select Quantity</p>
              <div className="grid grid-cols-3 gap-2">
                {[1, 5, 10].map((num) => (
                  <button
                    key={num}
                    onClick={() => performAdjustment(num)}
                    disabled={pending}
                    className="py-4 rounded-xl border-2 border-slate-200 font-black text-lg hover:border-slate-900 hover:bg-slate-900 hover:text-white transition-all disabled:opacity-50"
                  >
                    {num}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-xs font-black text-slate-600 uppercase tracking-widest">Or Custom Amount</p>
              <div className="flex gap-2">
                <input
                  type="number"
                  placeholder="Enter amount..."
                  value={customQty}
                  onChange={(e) => setCustomQty(e.target.value)}
                  className="flex-1 rounded-xl border-2 border-slate-200 px-4 py-3 font-bold focus:border-slate-900 outline-none transition-all"
                />
                <button
                  onClick={() => performAdjustment(Number(customQty))}
                  disabled={pending || !customQty || Number(customQty) <= 0}
                  className="px-8 rounded-xl bg-slate-900 text-white font-black hover:bg-black transition-all disabled:opacity-50 uppercase text-xs"
                >
                  Apply
                </button>
              </div>
            </div>

            <button
              onClick={() => {
                setAdjustingStock(null);
                setCustomQty("");
              }}
              className="w-full py-3 text-sm font-bold text-slate-400 hover:text-slate-600 transition-colors"
            >
              Cancel Adjustment
            </button>
          </div>
        </Modal>
      )}

      {/* ADD MODAL */}
      {openAdd && (
        <Modal
          title="Add Inventory Item"
          subtitle="Add a new supply/consumable to track. Stock can be adjusted anytime."
          onClose={() => setOpenAdd(false)}
        >
          <form action={addFormAction} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Item name</label>
                <input name="name" placeholder="e.g., Disposable Gloves (Medium)" className={inputBase} required />
              </div>

              <div>
                <label className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Unit</label>
                <input name="unit" placeholder="box, bottle, pcs..." className={inputBase} required />
              </div>

              <div>
                <label className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Category</label>
                <select name="category" className={inputBase}>
                  {categoryOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Tag</label>
                <select name="tag" defaultValue="consumable" className={inputBase}>
                  <option value="consumable">Consumable</option>
                  <option value="material">Material</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Batch number</label>
                <input name="batchNumber" placeholder="e.g., BATCH-2026-01" className={inputBase} />
              </div>

              <div>
                <label className="text-xs font-extrabold uppercase tracking-wide text-slate-600">
                  Expiration date
                </label>
                <input name="expirationDate" type="date" className={inputBase} />
              </div>

              <div>
                <label className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Initial stock</label>
                <input name="stock" type="number" min={0} step={1} placeholder="0" className={inputBase} required />
              </div>

              <div>
                <label className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Min threshold</label>
                <input
                  name="minThreshold"
                  type="number"
                  min={0}
                  step={1}
                  placeholder="0"
                  className={inputBase}
                  required
                />
              </div>

              <div>
                <label className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Cost per unit</label>
                <input
                  name="costPerUnit"
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="0.00"
                  className={inputBase}
                  required
                />
              </div>
            </div>

            {addState?.success === false && addState?.error ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 font-bold">
                {addState.error}
              </div>
            ) : null}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpenAdd(false)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold text-slate-800 hover:bg-slate-50"
                disabled={addPending}
              >
                Cancel
              </button>
              <button
                disabled={addPending}
                className="rounded-xl bg-teal-700 text-white px-4 py-2 text-sm font-extrabold hover:bg-teal-800 disabled:opacity-60"
              >
                {addPending ? "Adding..." : "Add Item"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* EDIT MODAL */}
      {openEdit && (
        <Modal
          title="Edit Inventory Item"
          subtitle="Update details, stock, and status. (Stock can also be changed via +/- on the table.)"
          onClose={() => setOpenEdit(null)}
        >
          <form onSubmit={onSubmitEdit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Item name</label>
                <input name="name" defaultValue={openEdit.name || ""} className={inputBase} required />
              </div>

              <div>
                <label className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Unit</label>
                <input name="unit" defaultValue={openEdit.unit || ""} className={inputBase} required />
              </div>

              <div>
                <label className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Category</label>
                <select name="category" defaultValue={openEdit.category || "supplies"} className={inputBase}>
                  {categoryOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Tag</label>
                <select name="tag" defaultValue={openEdit.tag || "consumable"} className={inputBase}>
                  <option value="consumable">Consumable</option>
                  <option value="material">Material</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Batch number</label>
                <input name="batchNumber" defaultValue={openEdit.batchNumber || ""} className={inputBase} />
              </div>

              <div>
                <label className="text-xs font-extrabold uppercase tracking-wide text-slate-600">
                  Expiration date
                </label>
                <input
                  name="expirationDate"
                  type="date"
                  defaultValue={openEdit.expirationDate || ""}
                  className={inputBase}
                />
              </div>

              <div>
                <label className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Stock</label>
                <input
                  name="stock"
                  type="number"
                  min={0}
                  step={1}
                  defaultValue={String(Number(openEdit.stock ?? 0))}
                  className={inputBase}
                  required
                />
              </div>

              <div>
                <label className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Min threshold</label>
                <input
                  name="minThreshold"
                  type="number"
                  min={0}
                  step={1}
                  defaultValue={String(Number(openEdit.minThreshold ?? 0))}
                  className={inputBase}
                  required
                />
              </div>

              <div>
                <label className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Cost per unit</label>
                <input
                  name="costPerUnit"
                  type="number"
                  min={0}
                  step="0.01"
                  defaultValue={String(Number(openEdit.costPerUnit ?? 0))}
                  className={inputBase}
                  required
                />
              </div>

              <label className="flex items-center gap-2 text-sm font-bold text-slate-800 md:col-span-2">
                <input
                  type="checkbox"
                  name="isActive"
                  defaultChecked={openEdit.isActive === true}
                  className="h-4 w-4"
                />
                Active
              </label>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpenEdit(null)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold text-slate-800 hover:bg-slate-50"
                disabled={pending}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-xl bg-slate-900 text-white px-4 py-2 text-sm font-extrabold hover:bg-black disabled:opacity-60"
                disabled={pending}
              >
                {pending ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {openAdd && (
        <Modal
          title="Add Inventory Item"
          subtitle="Add a new supply/consumable to track. Stock can be adjusted anytime."
          onClose={() => setOpenAdd(false)}
        >
          <form action={addFormAction} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Item name</label>
                <input name="name" placeholder="e.g., Disposable Gloves (Medium)" className={inputBase} required />
              </div>

              <div>
                <label className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Unit</label>
                <input name="unit" placeholder="box, bottle, pcs..." className={inputBase} required />
              </div>

              <div>
                <label className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Category</label>
                <select name="category" className={inputBase}>
                  {categoryOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Tag</label>
                <select name="tag" defaultValue="consumable" className={inputBase}>
                  <option value="consumable">Consumable</option>
                  <option value="material">Material</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Batch number</label>
                <input name="batchNumber" placeholder="e.g., BATCH-2026-01" className={inputBase} />
              </div>

              <div>
                <label className="text-xs font-extrabold uppercase tracking-wide text-slate-600">
                  Expiration date
                </label>
                <input name="expirationDate" type="date" className={inputBase} />
              </div>

              <div>
                <label className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Initial stock</label>
                <input name="stock" type="number" min={0} step={1} placeholder="0" className={inputBase} required />
              </div>

              <div>
                <label className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Min threshold</label>
                <input
                  name="minThreshold"
                  type="number"
                  min={0}
                  step={1}
                  placeholder="0"
                  className={inputBase}
                  required
                />
              </div>

              <div>
                <label className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Cost per unit</label>
                <input
                  name="costPerUnit"
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="0.00"
                  className={inputBase}
                  required
                />
              </div>
            </div>

            {addState?.success === false && addState?.error ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 font-bold">
                {addState.error}
              </div>
            ) : null}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpenAdd(false)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold text-slate-800 hover:bg-slate-50"
                disabled={addPending}
              >
                Cancel
              </button>
              <button
                disabled={addPending}
                className="rounded-xl bg-teal-700 text-white px-4 py-2 text-sm font-extrabold hover:bg-teal-800 disabled:opacity-60"
              >
                {addPending ? "Adding..." : "Add Item"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* EDIT MODAL */}
      {openEdit && (
        <Modal
          title="Edit Inventory Item"
          subtitle="Update details, stock, and status. (Stock can also be changed via +/- on the table.)"
          onClose={() => setOpenEdit(null)}
        >
          <form onSubmit={onSubmitEdit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Item name</label>
                <input name="name" defaultValue={openEdit.name || ""} className={inputBase} required />
              </div>

              <div>
                <label className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Unit</label>
                <input name="unit" defaultValue={openEdit.unit || ""} className={inputBase} required />
              </div>

              <div>
                <label className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Category</label>
                <select name="category" defaultValue={openEdit.category || "supplies"} className={inputBase}>
                  {categoryOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Tag</label>
                <select name="tag" defaultValue={openEdit.tag || "consumable"} className={inputBase}>
                  <option value="consumable">Consumable</option>
                  <option value="material">Material</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Batch number</label>
                <input name="batchNumber" defaultValue={openEdit.batchNumber || ""} className={inputBase} />
              </div>

              <div>
                <label className="text-xs font-extrabold uppercase tracking-wide text-slate-600">
                  Expiration date
                </label>
                <input
                  name="expirationDate"
                  type="date"
                  defaultValue={openEdit.expirationDate || ""}
                  className={inputBase}
                />
              </div>

              <div>
                <label className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Stock</label>
                <input
                  name="stock"
                  type="number"
                  min={0}
                  step={1}
                  defaultValue={String(Number(openEdit.stock ?? 0))}
                  className={inputBase}
                  required
                />
              </div>

              <div>
                <label className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Min threshold</label>
                <input
                  name="minThreshold"
                  type="number"
                  min={0}
                  step={1}
                  defaultValue={String(Number(openEdit.minThreshold ?? 0))}
                  className={inputBase}
                  required
                />
              </div>

              <div>
                <label className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Cost per unit</label>
                <input
                  name="costPerUnit"
                  type="number"
                  min={0}
                  step="0.01"
                  defaultValue={String(Number(openEdit.costPerUnit ?? 0))}
                  className={inputBase}
                  required
                />
              </div>

              <label className="flex items-center gap-2 text-sm font-bold text-slate-800 md:col-span-2">
                <input
                  type="checkbox"
                  name="isActive"
                  defaultChecked={openEdit.isActive === true}
                  className="h-4 w-4"
                />
                Active
              </label>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpenEdit(null)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold text-slate-800 hover:bg-slate-50"
                disabled={pending}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-xl bg-slate-900 text-white px-4 py-2 text-sm font-extrabold hover:bg-black disabled:opacity-60"
                disabled={pending}
              >
                {pending ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
