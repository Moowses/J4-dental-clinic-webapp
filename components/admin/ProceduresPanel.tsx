"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useActionState } from "react";

import {
  createProcedureAction,
  updateProcedureAction,
  deleteProcedureAction,
} from "@/app/actions/clinic-actions";

import {
  getAllServicesAction,
  createServiceAction,
  updateServiceAction,
  toggleServiceStatusAction,
} from "@/app/actions/service-actions";

import {
  getDentistListAction,
  updateDentistServicesAction,
} from "@/app/actions/dentist-actions";

import { getAllProcedures } from "@/lib/services/clinic-service";
import { getInventory } from "@/lib/services/inventory-service";
import { getDentistProfile } from "@/lib/services/dentist-service";
import {
  ConfirmActionModal,
  ProcessingModal,
  ResultModal,
} from "@/components/admin/ActionFeedbackModals";

import type { DentalProcedure } from "@/lib/types/clinic";
import type { DentalService } from "@/lib/types/service";

// Keep types lightweight here to avoid repo-wide mismatches
type InventoryItemLite = {
  id: string;
  name: string;
  category?: string;
  tag?: string;
};

type DentistLite = {
  uid: string;
  email?: string;
  displayName?: string;
};

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

const pillBase =
  "inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[11px] font-extrabold";

type SectionKey = "blueprints" | "catalog" | "dentist";

export default function ProceduresPanel() {
  const [section, setSection] = useState<SectionKey>("blueprints");

  return (
    <Card
      title="Procedures & Services"
      subtitle="Manage procedure blueprints, public service catalog, and dentist capabilities"
    >
      <div className="space-y-5">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setSection("blueprints")}
            className={`px-4 py-2 rounded-xl font-extrabold text-sm transition ${
              section === "blueprints"
                ? "bg-slate-900 text-white"
                : "bg-white border border-slate-200 hover:bg-slate-50 text-slate-900"
            }`}
          >
            Procedures (Blueprints)
          </button>

          <button
            type="button"
            onClick={() => setSection("catalog")}
            className={`px-4 py-2 rounded-xl font-extrabold text-sm transition ${
              section === "catalog"
                ? "bg-slate-900 text-white"
                : "bg-white border border-slate-200 hover:bg-slate-50 text-slate-900"
            }`}
          >
            Service Catalog (Website)
          </button>

          <button
            type="button"
            onClick={() => setSection("dentist")}
            className={`px-4 py-2 rounded-xl font-extrabold text-sm transition ${
              section === "dentist"
                ? "bg-slate-900 text-white"
                : "bg-white border border-slate-200 hover:bg-slate-50 text-slate-900"
            }`}
          >
            Dentist Service Manager
          </button>
        </div>

        {section === "blueprints" ? <ProceduresBlueprintsSection /> : null}
        {section === "catalog" ? <ServiceCatalogSection /> : null}
        {section === "dentist" ? <DentistServiceManager /> : null}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*                                BLUEPRINTS                                  */
/* -------------------------------------------------------------------------- */

function ProceduresBlueprintsSection() {
  const [procedures, setProcedures] = useState<DentalProcedure[]>([]);
  const [inventory, setInventory] = useState<InventoryItemLite[]>([]);

  const [recipe, setRecipe] = useState<
    { inventoryItemId: string; quantity: number; name: string }[]
  >([]);

  const [editingProc, setEditingProc] = useState<DentalProcedure | null>(null);
  const [pendingUpdateForm, setPendingUpdateForm] = useState<FormData | null>(null);
  const [processing, setProcessing] = useState(false);
  const [resultModal, setResultModal] = useState<{
    tone: "success" | "error";
    title: string;
    message: string;
  } | null>(null);

  const [createState, createAction, creating] = useActionState(
    createProcedureAction,
    { success: false },
  );

  const requiredInventoryJson = useMemo(() => {
    return JSON.stringify(
      recipe.map((r) => ({
        inventoryItemId: r.inventoryItemId,
        quantity: r.quantity,
      })),
    );
  }, [recipe]);

  const fetchProcedures = async () => {
    const res = await (getAllProcedures as any)(false); // include inactive
    if (res?.success) setProcedures(res.data || []);
  };

  const fetchInventory = async () => {
    const res = await getInventory();
    if (res?.success) {
      const consumables = (res.data || []).filter(
        (i: any) => String(i?.tag || "").toLowerCase() === "consumable",
      );
      setInventory(consumables);
    }
  };

  useEffect(() => {
    fetchProcedures();
    fetchInventory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createState.success]);

  const startEdit = (p: DentalProcedure) => {
    setEditingProc(p);

    const existingRecipe = ((p as any).requiredInventory || []).map((item: any) => ({
      inventoryItemId: item.inventoryItemId,
      quantity: item.quantity,
      name: inventory.find((i) => i.id === item.inventoryItemId)?.name || "Unknown Item",
    }));

    setRecipe(existingRecipe);
  };

  const cancelEdit = () => {
    setEditingProc(null);
    setRecipe([]);
  };

  const addToRecipe = (itemId: string) => {
    const item = inventory.find((i) => i.id === itemId);
    if (!item) return;
    if (recipe.some((r) => r.inventoryItemId === itemId)) return;
    setRecipe([...recipe, { inventoryItemId: itemId, quantity: 1, name: item.name }]);
  };

  const updateRecipeQty = (id: string, qty: number) => {
    setRecipe(
      recipe.map((r) =>
        r.inventoryItemId === id ? { ...r, quantity: Math.max(1, qty) } : r,
      ),
    );
  };

  const removeFromRecipe = (id: string) => {
    setRecipe(recipe.filter((r) => r.inventoryItemId !== id));
  };

  const handleUpdateSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingProc) return;

    const formData = new FormData(e.currentTarget);
    formData.set("requiredInventory", requiredInventoryJson);
    setPendingUpdateForm(formData);
  };

  const confirmProcedureUpdate = async () => {
    if (!editingProc || !pendingUpdateForm) return;
    setProcessing(true);
    const res = await updateProcedureAction((editingProc as any).id, pendingUpdateForm);
    setProcessing(false);
    setPendingUpdateForm(null);
    if (res?.success) {
      cancelEdit();
      setResultModal({
        tone: "success",
        title: "Success",
        message: "Procedure updated successfully.",
      });
      fetchProcedures();
    } else {
      setResultModal({
        tone: "error",
        title: "Update Failed",
        message: res?.error || "Unknown error",
      });
    }
  };

  const handleDelete = async (id: string) => {
    const ok = confirm("Delete this procedure? This cannot be undone.");
    if (!ok) return;

    const res = await deleteProcedureAction(id);
    if (res?.success) {
      alert("Deleted.");
      if (editingProc?.id === id) cancelEdit();
      fetchProcedures();
    } else {
      alert("Error: " + (res?.error || "Unknown error"));
    }
  };

  return (
    <div className="space-y-4">
      {processing ? <ProcessingModal title="Processing" message="Saving procedure changes..." /> : null}
      {pendingUpdateForm ? (
        <ConfirmActionModal
          title="Confirm action"
          message="Are you sure you want to save these procedure changes?"
          confirmLabel="Update Procedure"
          onCancel={() => setPendingUpdateForm(null)}
          onConfirm={confirmProcedureUpdate}
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
      <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white">
        <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
          {procedures.length === 0 ? (
            <div className="p-4 text-sm text-slate-500 italic">
              No procedures defined yet. Add your first blueprint below.
            </div>
          ) : (
            procedures.map((p: any) => {
              const active = p?.isActive !== false;
              return (
                <div
                  key={p.id}
                  className="p-4 flex items-start justify-between gap-4"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p
                        className={`font-extrabold text-slate-900 truncate ${
                          !active ? "line-through text-slate-400" : ""
                        }`}
                      >
                        {p.code} — {p.name}
                      </p>

                      <span
                        className={`${pillBase} ${
                          active
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-100"
                            : "bg-rose-50 text-rose-700 border border-rose-100"
                        }`}
                      >
                        {active ? "ACTIVE" : "INACTIVE"}
                      </span>
                    </div>

                    <p className="text-xs text-slate-500">ID: {p.id}</p>

                    {Array.isArray(p.requiredInventory) &&
                    p.requiredInventory.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {p.requiredInventory.map((ri: any, idx: number) => {
                          const invName =
                            inventory.find((i) => i.id === ri.inventoryItemId)?.name ||
                            "Item";
                          return (
                            <span
                              key={`${p.id}-${idx}`}
                              className="text-[11px] font-bold rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-slate-700"
                              title={ri.inventoryItemId}
                            >
                              {invName} ×{ri.quantity}
                            </span>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <div className="font-extrabold text-slate-900">
                      ₱{Number(p.basePrice || 0).toLocaleString()}
                    </div>

                    <button
                      type="button"
                      onClick={() => startEdit(p)}
                      className="px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-900 font-extrabold text-sm"
                    >
                      Edit
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDelete(p.id)}
                      className="px-3 py-2 rounded-xl bg-rose-50 text-rose-700 font-extrabold text-sm hover:bg-rose-100"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-extrabold text-slate-900">
              {editingProc ? "Edit Procedure Blueprint" : "Add New Procedure Blueprint"}
            </p>
            <p className="text-xs text-slate-500">
              Define code, price, active state, and consumable requirements.
            </p>
          </div>

          {editingProc ? (
            <button
              type="button"
              onClick={cancelEdit}
              className="text-xs font-extrabold text-rose-600 hover:underline"
            >
              Cancel
            </button>
          ) : null}
        </div>

        <form
          className="mt-4 space-y-3"
          action={editingProc ? undefined : createAction}
          onSubmit={editingProc ? handleUpdateSubmit : undefined}
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <input
              name="code"
              placeholder="Code"
              className={inputBase}
              required
              defaultValue={(editingProc as any)?.code || ""}
              key={`code-${(editingProc as any)?.id || "new"}`}
            />
            <input
              name="name"
              placeholder="Procedure name"
              className={`${inputBase} md:col-span-2`}
              required
              defaultValue={(editingProc as any)?.name || ""}
              key={`name-${(editingProc as any)?.id || "new"}`}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <input
              name="basePrice"
              type="number"
              placeholder="Base price"
              className={inputBase}
              required
              defaultValue={(editingProc as any)?.basePrice ?? ""}
              key={`price-${(editingProc as any)?.id || "new"}`}
            />

            <label className="md:col-span-2 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
              <input
                type="checkbox"
                name="isActive"
                defaultChecked={(editingProc as any)?.isActive !== false}
                key={`active-${(editingProc as any)?.id || "new"}`}
              />
              <span className="text-sm font-bold text-slate-700">Active</span>
            </label>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
              <div>
                <p className="text-xs font-extrabold text-slate-900">Consumable Requirements</p>
                <p className="text-xs text-slate-500">
                  Add consumables that should be deducted when this procedure is completed.
                </p>
              </div>

              <select
                className={`${inputBase} md:w-72`}
                defaultValue=""
                onChange={(e) => {
                  const id = e.target.value;
                  if (!id) return;
                  addToRecipe(id);
                  e.currentTarget.value = "";
                }}
              >
                <option value="">+ Add consumable…</option>
                {inventory.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            </div>

            {recipe.length === 0 ? (
              <div className="mt-3 text-sm text-slate-500 italic">
                No consumables assigned yet.
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                {recipe.map((r) => (
                  <div
                    key={r.inventoryItemId}
                    className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="font-extrabold text-slate-900 text-sm truncate">{r.name}</p>
                      <p className="text-xs text-slate-500 font-mono truncate">
                        {r.inventoryItemId}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <input
                        type="number"
                        min={1}
                        className="w-20 rounded-xl border border-slate-200 px-3 py-2 text-sm font-extrabold text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-300"
                        value={r.quantity}
                        onChange={(e) => updateRecipeQty(r.inventoryItemId, Number(e.target.value))}
                      />

                      <button
                        type="button"
                        onClick={() => removeFromRecipe(r.inventoryItemId)}
                        className="px-3 py-2 rounded-xl bg-rose-50 text-rose-700 font-extrabold text-sm hover:bg-rose-100"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <input type="hidden" name="requiredInventory" value={requiredInventoryJson} readOnly />
          </div>

          <button
            type="submit"
            disabled={creating}
            className={`w-full rounded-xl py-2.5 font-extrabold text-sm transition ${
              creating
                ? "bg-slate-200 text-slate-500 cursor-not-allowed"
                : "bg-teal-700 text-white hover:bg-teal-800"
            }`}
          >
            {creating
              ? editingProc
                ? "Updating…"
                : "Saving…"
              : editingProc
                ? "Update Procedure"
                : "Add Procedure"}
          </button>

          {createState?.error ? (
            <div className="text-sm font-bold text-rose-700">{createState.error}</div>
          ) : null}
        </form>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                              SERVICE CATALOG                               */
/* -------------------------------------------------------------------------- */

function ServiceCatalogSection() {
  const [services, setServices] = useState<DentalService[]>([]);
  const [editingService, setEditingService] = useState<DentalService | null>(null);
  const [imageUrl, setImageUrl] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [pendingUpdateForm, setPendingUpdateForm] = useState<FormData | null>(null);
  const [processing, setProcessing] = useState(false);
  const [resultModal, setResultModal] = useState<{
    tone: "success" | "error";
    title: string;
    message: string;
  } | null>(null);

  const [createState, createAction, creating] = useActionState(createServiceAction, {
    success: false,
  });

  const fetchServices = async () => {
    const res = await getAllServicesAction(false); // Fetch all including inactive for admin
    if (res?.success && res.data) setServices((res.data as DentalService[]) || []);
  };

  useEffect(() => {
    fetchServices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createState.success]);

  useEffect(() => {
    if (editingService) {
      setImageUrl(editingService.imageUrl || "");
    } else {
      setImageUrl("");
    }
  }, [editingService]);

  const handleUpdateSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingService) return;

    const formData = new FormData(e.currentTarget);
    formData.set("imageUrl", imageUrl);
    setPendingUpdateForm(formData);
  };

  const confirmServiceUpdate = async () => {
    if (!editingService || !pendingUpdateForm) return;
    setProcessing(true);
    const res = await updateServiceAction(editingService.id, pendingUpdateForm);
    setProcessing(false);
    setPendingUpdateForm(null);
    if (res?.success) {
      setEditingService(null);
      setImageUrl("");
      setResultModal({
        tone: "success",
        title: "Success",
        message: "Service updated successfully.",
      });
      fetchServices();
    } else {
      setResultModal({
        tone: "error",
        title: "Update Failed",
        message: res?.error || "Unknown error",
      });
    }
  };

  const toggleStatus = async (s: DentalService) => {
    await toggleServiceStatusAction(s.id, Boolean(s.isActive));
    fetchServices();
  };

  const uploadServiceImage = async (file: File | null) => {
    if (!file) return;
    const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;
    if (!cloudName || !uploadPreset) {
      setResultModal({
        tone: "error",
        title: "Upload Failed",
        message: "Cloudinary configuration missing.",
      });
      return;
    }

    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("upload_preset", uploadPreset);

      const res = await fetch(
        `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
        { method: "POST", body: form }
      );
      const data = await res.json();
      if (res.ok && data?.secure_url) {
        setImageUrl(String(data.secure_url));
      } else {
        throw new Error(data?.error?.message || "Upload failed");
      }
    } catch (err: any) {
      setResultModal({
        tone: "error",
        title: "Upload Failed",
        message: "Error uploading image: " + err.message,
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      {processing ? <ProcessingModal title="Processing" message="Saving service changes..." /> : null}
      {pendingUpdateForm ? (
        <ConfirmActionModal
          title="Confirm action"
          message="Are you sure you want to save these service changes?"
          confirmLabel="Update Service"
          onCancel={() => setPendingUpdateForm(null)}
          onConfirm={confirmServiceUpdate}
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
      <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white">
        <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
          {services.length === 0 ? (
            <div className="p-4 text-sm text-slate-500 italic">No services found.</div>
          ) : (
            services.map((s) => (
              <div key={s.id} className="p-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-12 w-12 rounded-lg bg-slate-100 border border-slate-200 overflow-hidden shrink-0">
                    {s.imageUrl ? (
                      <img src={s.imageUrl} alt={s.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center text-slate-400 text-[10px] font-bold">No Img</div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="font-extrabold text-slate-900 truncate">{s.name}</p>
                    <p className="text-xs text-slate-500">
                      ₱{Number((s as any).price || 0).toLocaleString()} •{" "}
                      <span className={s.isActive ? "text-emerald-700" : "text-rose-700"}>
                        {s.isActive ? "Active" : "Inactive"}
                      </span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => toggleStatus(s)}
                    className={`px-3 py-2 rounded-xl font-extrabold text-sm ${
                      s.isActive
                        ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                        : "bg-rose-50 text-rose-700 hover:bg-rose-100"
                    }`}
                  >
                    {s.isActive ? "Set Inactive" : "Set Active"}
                  </button>

                  <button
                    type="button"
                    onClick={() => setEditingService(s)}
                    className="px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-900 font-extrabold text-sm"
                  >
                    Edit
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-extrabold text-slate-900">
              {editingService ? "Edit Catalog Service" : "Add New Catalog Service"}
            </p>
            <p className="text-xs text-slate-500">
              These are public-facing services (website).
            </p>
          </div>

          {editingService ? (
            <button
              type="button"
              onClick={() => {
                setEditingService(null);
                setImageUrl("");
              }}
              className="text-xs font-extrabold text-rose-600 hover:underline"
            >
              Cancel
            </button>
          ) : null}
        </div>

        <form
          className="mt-4 space-y-3"
          action={editingService ? undefined : createAction}
          onSubmit={editingService ? handleUpdateSubmit : undefined}
        >
          <div className="flex flex-col md:flex-row gap-4">
            {/* Image Preview & Upload */}
            <div className="shrink-0 space-y-2">
              <div className="h-32 w-32 md:h-40 md:w-40 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden relative group">
                {imageUrl ? (
                  <>
                    <img src={imageUrl} alt="Preview" className="h-full w-full object-cover" />
                    <button 
                      type="button"
                      onClick={() => setImageUrl("")}
                      className="absolute inset-0 bg-black/40 text-white opacity-0 group-hover:opacity-100 transition flex items-center justify-center font-bold text-xs"
                    >
                      Remove
                    </button>
                  </>
                ) : (
                  <div className="text-center p-4">
                    <span className="text-2xl">🖼️</span>
                    <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase">No Image</p>
                  </div>
                )}
                {uploading && (
                  <div className="absolute inset-0 bg-white/80 flex items-center justify-center">
                    <div className="h-5 w-5 border-2 border-teal-600 border-t-transparent rounded-full animate-spin"></div>
                  </div>
                )}
              </div>
              <label className="block">
                <span className="sr-only">Choose service photo</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => uploadServiceImage(e.target.files?.[0] || null)}
                  className="block w-full text-[10px] text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-[10px] file:font-black file:bg-teal-50 file:text-teal-700 hover:file:bg-teal-100 cursor-pointer"
                />
              </label>
              <input type="hidden" name="imageUrl" value={imageUrl} />
            </div>

            <div className="flex-1 space-y-3">
              <input
                name="name"
                placeholder="Service Name (e.g. Braces)"
                className={inputBase}
                required
                defaultValue={editingService?.name || ""}
                key={`svc-name-${editingService?.id || "new"}`}
              />

              <input
                name="price"
                type="number"
                placeholder="Starting Price"
                className={inputBase}
                required
                defaultValue={(editingService as any)?.price ?? ""}
                key={`svc-price-${editingService?.id || "new"}`}
              />

              <textarea
                name="description"
                placeholder="Public description"
                className={`${inputBase} h-20`}
                defaultValue={(editingService as any)?.description || ""}
                key={`svc-desc-${editingService?.id || "new"}`}
              />
            </div>
          </div>

          <input
            type="hidden"
            name="isActive"
            value={editingService ? String(Boolean(editingService.isActive)) : "true"}
          />

          <button
            type="submit"
            disabled={creating || uploading}
            className={`w-full rounded-xl py-2.5 font-extrabold text-sm transition ${
              creating || uploading
                ? "bg-slate-200 text-slate-500 cursor-not-allowed"
                : "bg-teal-700 text-white hover:bg-teal-800"
            }`}
          >
            {uploading ? "Uploading Image..." : creating
              ? editingService
                ? "Updating…"
                : "Saving…"
              : editingService
                ? "Update Service"
                : "Add Service"}
          </button>

          {createState?.error ? (
            <div className="text-sm font-bold text-rose-700">{createState.error}</div>
          ) : null}
        </form>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                         DENTIST SERVICE MANAGER                             */
/* -------------------------------------------------------------------------- */

function DentistServiceManager() {
  const [dentists, setDentists] = useState<DentistLite[]>([]);
  const [services, setServices] = useState<DentalService[]>([]);
  const [selectedDentist, setSelectedDentist] = useState<string>("");

  const [supportedIds, setSupportedIds] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [confirmSaveOpen, setConfirmSaveOpen] = useState(false);
  const [resultModal, setResultModal] = useState<{
    tone: "success" | "error";
    title: string;
    message: string;
  } | null>(null);

  const fetchData = async () => {
    setLoading(true);
    const [dRes, sRes] = await Promise.all([
      getDentistListAction(),
      getAllServicesAction(),
    ]);

    if (dRes?.success) setDentists((dRes.data as DentistLite[]) || []);
    if (sRes?.success) setServices((sRes.data as DentalService[]) || []);

    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (!selectedDentist) {
      setSupportedIds([]);
      return;
    }

    getDentistProfile(selectedDentist).then((res: any) => {
      if (res?.success && res.data) {
        setSupportedIds(res.data.supportedServiceIds || []);
      } else {
        setSupportedIds([]);
      }
    });
  }, [selectedDentist]);

  const handleToggle = (serviceId: string) => {
    setSupportedIds((prev) =>
      prev.includes(serviceId) ? prev.filter((id) => id !== serviceId) : [...prev, serviceId],
    );
  };

  const executeSave = async () => {
    if (!selectedDentist) return;
    setIsSaving(true);
    const res = await updateDentistServicesAction(selectedDentist, supportedIds);
    setIsSaving(false);

    if (res?.success) {
      setResultModal({
        tone: "success",
        title: "Success",
        message: "Dentist capabilities updated successfully.",
      });
    } else {
      setResultModal({
        tone: "error",
        title: "Save Failed",
        message: res?.error || "Unknown error",
      });
    }
  };

  const handleSave = async () => {
    if (!selectedDentist) return;
    setConfirmSaveOpen(true);
  };

  return (
    <div className="space-y-4">
      {isSaving ? <ProcessingModal title="Processing" message="Saving dentist capabilities..." /> : null}
      {confirmSaveOpen ? (
        <ConfirmActionModal
          title="Confirm action"
          message="Are you sure you want to save these dentist capability changes?"
          confirmLabel="Save Capabilities"
          onCancel={() => setConfirmSaveOpen(false)}
          onConfirm={async () => {
            setConfirmSaveOpen(false);
            await executeSave();
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
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <p className="text-sm font-extrabold text-slate-900">Provider Capabilities</p>
        <p className="text-xs text-slate-500">
          Assign which services each dentist can perform.
        </p>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-2">
            <label className="text-xs font-extrabold text-slate-600">Select Dentist</label>
            <select
              className={inputBase}
              value={selectedDentist}
              onChange={(e) => setSelectedDentist(e.target.value)}
            >
              <option value="">Choose dentist…</option>
              {dentists.map((d) => (
                <option key={d.uid} value={d.uid}>
                  {d.displayName || d.email || d.uid}
                </option>
              ))}
            </select>

            {loading ? (
              <div className="text-sm text-slate-500 italic">Loading…</div>
            ) : null}
          </div>

          <div className="space-y-2">
            <label className="text-xs font-extrabold text-slate-600">Supported Services</label>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 max-h-64 overflow-y-auto">
              {!selectedDentist ? (
                <div className="text-sm text-slate-500 italic">
                  Select a dentist to manage capabilities.
                </div>
              ) : services.length === 0 ? (
                <div className="text-sm text-slate-500 italic">No services found.</div>
              ) : (
                <div className="space-y-2">
                  {services.map((s) => (
                    <label
                      key={s.id}
                      className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 cursor-pointer hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        checked={supportedIds.includes(s.id)}
                        onChange={() => handleToggle(s.id)}
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-extrabold text-slate-900 truncate">
                          {s.name}
                        </p>
                        <p className="text-xs text-slate-500">
                          ₱{Number((s as any).price || 0).toLocaleString()}
                          {s.isActive ? "" : " • Inactive in catalog"}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={handleSave}
              disabled={!selectedDentist || isSaving}
              className={`w-full rounded-xl py-2.5 font-extrabold text-sm transition ${
                !selectedDentist || isSaving
                  ? "bg-slate-200 text-slate-500 cursor-not-allowed"
                  : "bg-teal-700 text-white hover:bg-teal-800"
              }`}
            >
              {isSaving ? "Saving…" : "Save Capabilities"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
